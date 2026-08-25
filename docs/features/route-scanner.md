# Route scanner

The scanner reads a Hono app's route table and registers each route as an apcore
module. Nothing in your handlers changes.

```ts
const ap = createApcore({
  routes: { excludePaths: ['/health', '/mcp*', '/explorer*'] },
});

await ap.init(app);   // -> todos.list, todos.get, todos.create, ...
```

## How a route becomes a module

`Hono.routes` is a public array of `{ basePath, path, method, handler }`. For
each entry the scanner:

1. skips `ALL` (that is `app.use()` middleware, not an endpoint) and any method
   in `excludeMethods` — `HEAD` and `OPTIONS` by default;
2. collapses duplicate `(method, path)` pairs, since several handlers on one
   route are still one endpoint;
3. applies `includePaths` / `excludePaths` (glob-style, via apcore's
   `matchPattern`) and any per-route `skip`;
4. derives the module ID with apcore-toolkit's `generateSuggestedAlias()`;
5. infers annotations from the HTTP method;
6. builds an input schema from the path parameters and the method;
7. builds an execute function that replays the route through `app.request()`.

Finally colliding IDs are deduplicated (`todos.list`, `todos.list_2`) and the
`include` / `exclude` module-ID regexes are applied.

## Module IDs

| Route | Module ID |
| --- | --- |
| `GET /todos` | `todos.list` |
| `GET /todos/:id` | `todos.get` |
| `POST /todos` | `todos.create` |
| `PUT /todos/:id` | `todos.update` |
| `PATCH /todos/:id` | `todos.patch` |
| `DELETE /todos/:id` | `todos.delete` |
| `GET /orgs/:orgId/members` | `orgs.members.list` |

The verb depends on whether the **last** segment is a parameter, so a nested
collection like `/orgs/:orgId/members` is correctly a `list` rather than a
`get`.

A path with no literal segments produces a bare verb: `GET /` becomes the module
`list`. That is legal but rarely what you want from an index route — exclude
`/` or give it an explicit `id`.

Reserved first segments (`system`, `internal`, `core`, `apcore`, `plugin`,
`schema`, `acl`) are rejected by the registry, so `GET /internal/debug` fails to
register. The error names the route and both remedies:

```
Cannot register route GET /internal/debug as module "internal.debug.list":
Module ID contains reserved word: 'internal'. Give it an explicit id via
routes.overrides, or drop it with routes.excludePaths.
```

## Inferred annotations

From apcore-toolkit's `BaseScanner.inferAnnotationsFromMethod()`, following
RFC 9110 safe-method semantics:

| Method | Annotations |
| --- | --- |
| `GET` | `readonly: true`, `cacheable: true` |
| `HEAD`, `OPTIONS` | `readonly: true` |
| `PUT` | `idempotent: true` |
| `DELETE` | `destructive: true` |
| others | all defaults (false) |

`HEAD` and `OPTIONS` are safe by spec but their responses are not generally
cacheable for application use, hence no `cacheable`.

## Generated input schema

One required string property per path parameter, plus:

- `query` — a free-form object of string values, for methods without a body
- `body` — a free-form JSON object, for `POST` / `PUT` / `PATCH`

```jsonc
// GET /todos/:id
{
  "type": "object",
  "required": ["id"],
  "properties": {
    "id": { "type": "string", "description": "Path parameter \"id\" of /todos/:id" },
    "query": { "type": "object", "additionalProperties": { "type": "string" } }
  }
}
```

This is honest but vague — a model has no idea which query keys exist. For any
route an AI will lean on, supply a real schema through an override.

## Overrides

Keyed by `"<METHOD> <path>"`, exactly as the route is declared:

```ts
routes: {
  overrides: {
    'GET /todos': {
      id: 'todo.all',
      description: 'Every todo, newest first',
      inputSchema: Type.Object({ done: Type.Optional(Type.Boolean()) }),
      outputSchema: Type.Object({ todos: Type.Array(TodoSchema) }),
      annotations: { readonly: true, idempotent: true },
      tags: ['todo'],
      documentation: 'Ordered by createdAt descending.',
    },
    'DELETE /admin/wipe': { skip: true },
  },
}
```

Override `tags` are merged with the scanner-level tags; everything else
replaces.

## Execution: replay, not reimplementation

A scanned module's execute function builds a URL, substitutes the path
parameters, appends the query string (or serialises the body), and calls
`app.request(url, init)`.

That means an AI call runs the **same** code path as an HTTP call: middleware,
validators, auth guards, and error handlers all execute. There is no second
implementation to keep in sync.

Identity and trace context travel with it — the apcore `Context`'s identity
becomes `x-user-id` and `x-roles` headers, and `TraceContext.inject()` supplies
`traceparent`, so a route that reads those headers sees the real caller.

The response is mapped back:

- 2xx JSON object → returned as-is
- 2xx JSON array or primitive → `{ result: value }`
- 2xx non-JSON → `{ result: text }`
- non-2xx → `ModuleExecuteError` naming the status and body

### What replay costs

The request is constructed and dispatched in-process — no socket, no network —
but it is not free. Body serialisation, header construction, and the full
middleware chain all run. For a hot path where that matters, declare the tool
with `defineTool()` and call the underlying function directly.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `modulePrefix` | `APCORE_MODULE_PREFIX` | Prefix prepended to every module ID |
| `includePaths` | `APCORE_INCLUDE_PATHS` | Glob patterns; empty means all |
| `excludePaths` | `APCORE_EXCLUDE_PATHS` | Glob patterns to drop |
| `excludeMethods` | `['HEAD', 'OPTIONS']` | HTTP methods to skip |
| `include` / `exclude` | — | Regexes applied to the generated module IDs |
| `tags` | `['http']` | Tags attached to every scanned module |
| `overrides` | `{}` | Per-route metadata, keyed `"<METHOD> <path>"` |
| `baseUrl` | `http://localhost` | Origin used when replaying |

Per-call options passed to `scanRoutes()` or `init()` win over the ones given to
`createApcore()`, which in turn win over the `APCORE_*` settings.

## Scanning without registering

`HonoRouteScanner.scan()` returns plain `ScannedModule` metadata — no closures,
fully serialisable. That is what the CLI uses:

```bash
hono-apcore scan ./src/app.ts --format yaml --out bindings.yaml
```

`scanWithExecutors()` returns each module paired with its execute function, for
when you want to register them yourself.

When the entry module exports a `HonoApcore` (under any name), the CLI reads its
`routeOptions` so the scan reports exactly what the app registers. A CLI flag —
`--prefix`, `--include`, `--exclude` — overrides that for the one invocation.
