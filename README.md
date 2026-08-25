# hono-apcore

Hono adapter for the [apcore](https://github.com/aiperceivable/apcore-typescript)
AI-Perceivable module ecosystem. Turn a Hono app into
[MCP](https://modelcontextprotocol.io/) tools and OpenAI-compatible function
definitions — either by declaring tools explicitly, or by scanning the routes
you already have.

## Features

- **Two ways in** — declare tools with `defineTool()` / `defineToolset()`, or scan your existing routes with zero code changes
- **Route replay** — a scanned route becomes a module that calls back through `app.request()`, so middleware, validators, and error handlers all still run
- **One port** — `mountMcp()` serves the MCP endpoint, the Tool Explorer, and `/health` from the same Hono app
- **Annotation inference** — `GET` → readonly + cacheable, `PUT` → idempotent, `DELETE` → destructive (RFC 9110 safe-method semantics)
- **Multi-schema** — TypeBox, Zod 3, Zod 4, and plain JSON Schema, auto-detected through a priority chain
- **Context, ACL, and identity** — the `apcore()` middleware builds a per-request apcore `Context` with W3C trace propagation, so ACL rules govern your routes too
- **Runtime-agnostic core** — `apcore-mcp`, `apcore-cli`, and `apcore-a2a` are optional peers loaded lazily, so importing `hono-apcore` never drags `node:http` into an edge build
- **CLI** — `hono-apcore scan | serve | export` works against a plain Hono app
- **YAML bindings** — register modules declaratively, without touching source

## Installation

```bash
npm install hono-apcore hono
```

Optional peers, installed only for the surfaces you use:

```bash
npm install apcore-mcp @modelcontextprotocol/sdk   # MCP server + Tool Explorer
npm install @hono/node-server                      # mountMcp() on the Node runtime
npm install apcore-cli                             # CLI surface
npm install apcore-a2a                             # A2A agent surface
npm install @sinclair/typebox                      # TypeBox schemas (recommended)
npm install zod                                    # Zod schemas
```

**Requirements:** Node.js >= 18, Hono >= 4 (tested with Hono 4.13).

## Quick start

### 1. Declare some tools

```ts
// todo.tools.ts
import { Type } from '@sinclair/typebox';
import { defineToolset } from 'hono-apcore';

export const todoTools = defineToolset({
  namespace: 'todo',
  description: 'Todo list management',
  tags: ['todo'],
  tools: {
    list: {
      description: 'List all todos, optionally filtered by status',
      inputSchema: Type.Object({ done: Type.Optional(Type.Boolean()) }),
      annotations: { readonly: true, idempotent: true },
      handler: (inputs) => ({ todos: store.list(inputs.done as boolean | undefined) }),
    },
    add: {
      description: 'Add a new todo item',
      inputSchema: Type.Object({ title: Type.String() }),
      annotations: { readonly: false },
      handler: (inputs) => ({ todo: store.add(String(inputs.title)) }),
    },
  },
});
```

### 2. Wire it into the app

```ts
// app.ts
import { Hono } from 'hono';
import { apcore, createApcore } from 'hono-apcore';
import { todoTools } from './todo.tools.js';

export const ap = createApcore({
  tools: todoTools,
  mcp: { name: 'my-app', explorer: true, allowExecute: true },
});

export const app = new Hono();
app.use('*', apcore(ap));
app.get('/todos', (c) => c.json(store.list()));
```

### 3. Boot

```ts
// main.ts
import { serve } from '@hono/node-server';
import { app, ap } from './app.js';

await ap.init(app);              // register tools + scan routes
await ap.mountMcp(app);          // mount /mcp, /explorer, /health

serve({ fetch: app.fetch, port: 3000 });
```

Your app now answers:

- **REST** at `http://localhost:3000/todos`
- **MCP** at `http://localhost:3000/mcp`
- **Tool Explorer** at `http://localhost:3000/explorer/`

## Two ways to expose a capability

### `defineTool()` — explicit tools

The Hono counterpart to NestJS's `@ApTool` decorator. Hono has no classes or DI
container to decorate, so a tool is a plain object that carries its own
metadata and handler.

```ts
import { defineTool } from 'hono-apcore';

const sendEmail = defineTool({
  namespace: 'email',
  name: 'send',                 // -> module id "email.send"
  description: 'Send an email',
  inputSchema: Type.Object({ to: Type.String(), body: Type.String() }),
  outputSchema: Type.Object({ messageId: Type.String() }),
  annotations: { readonly: false, destructive: false, requiresApproval: true },
  tags: ['email'],
  params: { to: 'Recipient address' },   // merged into the schema descriptions
  handler: async (inputs, context) => mailer.send(inputs, context),
});
```

| Field | Notes |
| --- | --- |
| `id` | Used verbatim. Otherwise `"<namespace>.<name>"`, with `name` snake-cased |
| `inputSchema` / `outputSchema` | TypeBox, Zod, or plain JSON Schema |
| `annotations` | `readonly`, `destructive`, `idempotent`, `requiresApproval`, `openWorld`, `streaming`, `cacheable`, … |
| `params` | Per-parameter prose merged into the input schema. JavaScript cannot read a function's leading comments at run time the way Python reads a docstring, so this is explicit |
| `handler` | `(inputs, context) => result`. A non-object result is wrapped as `{ result }` |

### Route scanning — zero-intrusion tools

Point the scanner at an app and every route becomes a module that replays it
in-process through `app.request()`:

```ts
const ap = createApcore({
  routes: {
    excludePaths: ['/health', '/mcp*', '/explorer*'],
    modulePrefix: 'api',
  },
});

await ap.init(app);   // -> api.todos.list, api.todos.get, api.todos.create, …
```

Module IDs come from the path and the HTTP verb:

| Route | Module ID | Inferred annotations |
| --- | --- | --- |
| `GET /todos` | `todos.list` | `readonly`, `cacheable` |
| `GET /todos/:id` | `todos.get` | `readonly`, `cacheable` |
| `POST /todos` | `todos.create` | — |
| `PUT /todos/:id` | `todos.update` | `idempotent` |
| `DELETE /todos/:id` | `todos.delete` | `destructive` |

The generated input schema carries one required string property per path
parameter, plus a free-form `query` object (GET/DELETE) or `body` object
(POST/PUT/PATCH). Override any of it per route:

```ts
routes: {
  overrides: {
    'GET /todos': {
      id: 'todo.all',
      description: 'Every todo, newest first',
      inputSchema: Type.Object({ done: Type.Optional(Type.Boolean()) }),
      annotations: { readonly: true, idempotent: true },
    },
    'DELETE /admin/wipe': { skip: true },
  },
}
```

Because execution goes back through `app.request()`, an AI call runs the *same*
code path as an HTTP call — auth middleware, validators, error handlers and all.
Identity and W3C trace headers from the apcore `Context` are forwarded onto the
replayed request.

## API reference

### `createApcore(options)`

Returns a `HonoApcore` — the Registry, the Executor, and every surface hang off
it.

```ts
createApcore({
  extensionsDir?: string | null,   // scanned by Registry.discover()
  acl?: ACL,                       // enforced by the Executor on every call
  middleware?: Middleware[],       // apcore middleware installed on the Executor
  bindings?: string,               // YAML bindings file loaded during init()
  tools?: ApToolDefinition[],      // registered during init()
  routes?: RouteScanOptions,       // route-scanner configuration
  settings?: Partial<ApcoreSettings>,  // overrides for the APCORE_* settings
  mcp?: ApcoreMcpOptions,          // presence enables the MCP surface
  cli?: ApcoreCliOptions,          // presence enables the CLI surface
  a2a?: ApcoreA2aOptions,          // presence enables the A2A surface
})
```

| Method | Description |
| --- | --- |
| `init(app?, routeOptions?)` | Discover, register tools and bindings, scan routes, start standalone surfaces. Idempotent |
| `ready()` | Await an in-flight `init()` |
| `registerTool(tool)` / `registerTools(tools)` | Register tool definitions at run time |
| `registerMethod(opts)` / `registerObject(opts)` | Register the methods of a plain service object |
| `scanRoutes(app, opts?)` | Scan and register an app's routes |
| `routeOptions` | The merged route-scan options this instance would use |
| `loadBindings(path?, resolver?)` | Load a YAML bindings file |
| `mountMcp(app, opts?)` | Mount `/mcp`, the Explorer, and `/health` into the app |
| `toOpenaiTools(opts?)` | OpenAI-compatible function definitions |
| `close()` | Shut down the MCP and A2A surfaces |

### `apcore(instance | options, middlewareOptions?)`

Hono middleware that puts the instance and a per-request apcore `Context` on the
Hono context.

```ts
app.use('*', apcore(ap));

app.get('/orders', async (c) =>
  c.json(await getApcore(c).executor.call('orders.list', {}, getApcoreContext(c))),
);
```

The variable map is augmented, so `c.get('apcore')` and `c.get('apcoreContext')`
are typed too. Pass `{ skipContext: true }` on routes that never call modules,
or `{ contextFactory }` to plug in real authentication.

### `HonoContextFactory`

Builds the apcore `Context` from a Hono context, a `Request`, or bare `Headers`.

Identity resolution, in order: `x-user-id` → `Authorization: Bearer …` (identity
id `"bearer"`) → a bare `x-roles` header (a demo shortcut) → anonymous. A
`traceparent` header supplies the trace id; `x-correlation-id` (or
`x-request-id`) lands in `context.data`.

```ts
new HonoContextFactory({
  resolveIdentity: (headers) => identityFromSession(headers),  // wins over the above
  data: (headers) => ({ tenant: headers.get('x-tenant') }),
});
```

### MCP

`ApcoreMcpService` runs the MCP server two ways.

**Embedded** — one process, one port:

```ts
await ap.mountMcp(app, { endpoint: '/mcp', explorer: true, allowExecute: true });
```

This needs the raw Node request and response objects that `@hono/node-server`
exposes on `c.env`, so it is Node-only; a mounted handler on another runtime
answers `501` with that explanation. `endpoint` must be the path as the HTTP
server sees it — include the prefix if the app sits under a `basePath`.

**Standalone** — a separate port, or stdio for a CLI-launched server:

```ts
createApcore({ mcp: { transport: 'streamable-http', host: '0.0.0.0', port: 8000 } });
// init() starts it, because `transport` was set explicitly
```

Key MCP options:

| Field | Type | Description |
| --- | --- | --- |
| `transport` | `'stdio' \| 'streamable-http' \| 'sse'` | Standalone transport. Setting it makes `init()` start the server |
| `host` / `port` | `string` / `number` | Bind address for HTTP transports |
| `name` / `version` | `string` | Server identity |
| `explorer` / `explorerPrefix` / `allowExecute` | | Tool Explorer web UI |
| `authenticator` / `requireAuth` / `exemptPaths` | | JWT or custom auth |
| `tags` / `prefix` | | Expose only matching modules |
| `validateInputs` | `boolean` | Enforce input schemas on every call |
| `observability` | | Metrics + usage middleware and their endpoints |
| `outputFormat` / `outputFormatter` / `redactOutput` / `trace` | | Result serialisation |
| `approvalHandler` / `approvalStore` / `approvalNotify` | | Approval gate for destructive tools |
| `mcpMiddleware` / `mcpAcl` | | Extra apcore middleware / ACL for the MCP executor |

### Schema adapters

Schemas are auto-detected and converted through a priority chain:

| Adapter | Priority | Input |
| --- | --- | --- |
| `TypeBoxAdapter` | 100 | `@sinclair/typebox` schemas |
| `ZodAdapter` | 50 | Zod 3 (`_def.typeName`) and Zod 4 (`_zod.def.type`) |
| `JsonSchemaAdapter` | 30 | Plain JSON Schema objects |

Detection is structural — neither TypeBox nor Zod is imported at run time — so
whichever the host app installs (or neither) is fine. Register your own with
`SchemaExtractor.registerAdapter()`.

### YAML bindings

Register modules without touching source:

```yaml
bindings:
  - module_id: email.send
    target: EmailService.send
    description: Send an email
    input_schema:
      type: object
      properties:
        to: { type: string }
    tags: [email, mutate]
    annotations:
      readonly: false
```

```ts
import { resolverFromObjects } from 'hono-apcore';

await ap.loadBindings('./bindings.yaml', resolverFromObjects({ EmailService: mailer }));
```

Going the other way, `writeBindingsFile()` serialises scanned modules back out —
which is what `hono-apcore scan --format yaml` does.

### CLI

```bash
hono-apcore scan   ./src/app.ts            # print the modules a scan would produce
hono-apcore scan   ./src/app.ts --format yaml --out bindings.yaml
hono-apcore serve  ./src/app.ts --transport http --port 8000 --explorer
hono-apcore export ./src/app.ts --out tools.json
```

The entry is `path[:export]`; the export defaults to `default`, then `app`. If
the module exports a `HonoApcore` under **any** name, its configuration — route
filters, module prefix, MCP options — is honoured, so `scan` reports exactly the
modules the app itself registers; CLI flags override it. An entry with no
instance still works, so `serve` runs against an app that has never heard of
apcore. TypeScript entries need a loader:

```bash
npx tsx node_modules/.bin/hono-apcore scan ./src/app.ts
```

### Configuration (`APCORE_*`)

The canonical settings every apcore integration implements, read from the
environment and overridable via `settings`:

| Variable | Type | Default | Purpose |
| --- | --- | --- | --- |
| `APCORE_ENABLED` | bool | `true` | Master switch — `false` makes `init()` a no-op |
| `APCORE_DEBUG` | bool | `false` | Verbose logging / introspection |
| `APCORE_SCANNERS` | list | `["auto"]` | Enabled scanner identifiers |
| `APCORE_INCLUDE_PATHS` | list | `[]` | Route patterns to include (empty = all) |
| `APCORE_EXCLUDE_PATHS` | list | `[]` | Route patterns to exclude |
| `APCORE_MODULE_PREFIX` | str | `""` | Prefix prepended to generated module IDs |
| `APCORE_AUTH_ENABLED` | bool | `false` | Require auth for MCP/A2A endpoints |
| `APCORE_AUTH_STRATEGY` | str | `"bearer"` | `bearer` / `session` / `custom` |
| `APCORE_TRANSPORT` | str | `"stdio"` | MCP transport: `stdio` / `http` / `sse` |
| `APCORE_HOST` | str | `"0.0.0.0"` | Bind address when the transport is not stdio |
| `APCORE_PORT` | int | `8808` | Bind port when the transport is not stdio |

### Optional peers are not re-exported

Unlike the NestJS adapter, `hono-apcore` does **not** re-export the `apcore-mcp`
/ `apcore-cli` / `apcore-a2a` surfaces. Doing so would make them load eagerly,
and `apcore-mcp` pulls in `node:http` — which breaks a Workers, Deno, or Bun
build of an app that never uses the MCP surface. Import those symbols from their
own packages:

```ts
import { JWTAuthenticator, getCurrentIdentity } from 'apcore-mcp';
import { createCli } from 'apcore-cli';
import { A2AClient } from 'apcore-a2a';
```

`apcore-js` and `apcore-toolkit` *are* hard dependencies, so their common
symbols (`ACL`, `Config`, `registerSysModules`, `TraceContext`, `BaseScanner`,
`formatModules`, …) re-export from `hono-apcore` directly.

## Examples

| Example | Shows |
| --- | --- |
| [`examples/demo`](./examples/demo) | Full app: hand-written tools *and* route scanning, JWT, ACL, system modules, Docker |
| [`examples/acl_demo`](./examples/acl_demo) | Routes governed by apcore ACL — `orders.delete` for admins only |

```bash
pnpm install && pnpm build
cd examples/demo && pnpm install && pnpm dev
```

## Detailed documentation

- [Feature overview](./docs/features/overview.md) — architecture and dependency graph
- [Tool definition](./docs/features/tool-definition.md) — `defineTool`, `defineToolset`, module IDs
- [Route scanner](./docs/features/route-scanner.md) — how routes become modules, and what replay costs
- [MCP integration](./docs/features/mcp-server-integration.md) — embedded vs standalone, the Node bridge
- [Schema extraction](./docs/features/schema-extraction.md) — the adapter chain and custom adapters
- [Context and ACL](./docs/features/context-and-acl.md) — identity, tracing, and governing routes

## Scripts

| Command | Description |
| --- | --- |
| `pnpm build` | Compile TypeScript |
| `pnpm dev` | Watch-mode compilation |
| `pnpm test` | Run the test suite (vitest) |
| `pnpm test:coverage` | Tests with coverage (90% thresholds) |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm lint` | Lint source and tests |

## License

Apache-2.0
