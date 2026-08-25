# Feature overview

`hono-apcore` connects a [Hono](https://hono.dev) application to the apcore
ecosystem: your handlers become apcore **modules**, and those modules are served
to AI clients over MCP, to humans over a CLI, and to other agents over A2A.

## Architecture

```
                        ┌──────────────────────────────────────┐
   defineTool()         │            HonoApcore                │
   defineToolset()  ───▶│                                      │
                        │   ApcoreRegistry  ──▶  Registry      │   apcore-js
   HonoRouteScanner ───▶│   ApcoreExecutor  ──▶  Executor      │
   (app.routes)         │                        │  ACL        │
                        │                        │  middleware │
   ApBindingLoader  ───▶│                        │  approval   │
   (bindings.yaml)      └────────────┬───────────┴─────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
      ApcoreMcpService        ApcoreCliService       ApcoreA2aService
        (apcore-mcp)            (apcore-cli)            (apcore-a2a)
              │
       mountMcp(app) ──▶  /mcp  /explorer  /health  on the Hono app itself
```

Three things feed the registry, one Executor governs every call, and the
surfaces are read-only consumers of what is registered.

## The pieces

| Module | Responsibility |
| --- | --- |
| `core/apcore.ts` | `HonoApcore` — construction, `init()`, surface wiring |
| `core/registry.ts` | `ApcoreRegistry` — registration and serialisation over the apcore `Registry` |
| `core/executor.ts` | `ApcoreExecutor` — `call()`, `stream()`, `validate()` |
| `core/middleware.ts` | The `apcore()` Hono middleware and its accessors |
| `tools/define-tool.ts` | `defineTool` / `defineToolset` and the conversion to `ScannedModule` |
| `scanners/hono-route-scanner.ts` | Route table → modules that replay through `app.request()` |
| `context/hono-context.factory.ts` | Request → apcore `Context` |
| `schema/` | The TypeBox / Zod / JSON Schema adapter chain |
| `bridge/binding-loader.ts` | YAML bindings → modules |
| `output/yaml-writer.ts` | Modules → YAML bindings |
| `mcp/`, `cli/`, `a2a/` | The three optional surfaces |
| `config.ts` | The canonical `APCORE_*` settings |
| `cli.ts` | The `hono-apcore` binary |

## Dependencies

**Hard** — always loaded:

- `apcore-js` — `Registry`, `Executor`, `Context`, `ACL`, `FunctionModule`, errors
- `apcore-toolkit` — `BaseScanner`, `ScannedModule`, formatting, HTTP-verb mapping
- `js-yaml` — bindings parsing
- `hono` (peer) — types only in the library; the app supplies the runtime

**Optional peers** — loaded lazily, only when the matching surface is used:

- `apcore-mcp` + `@modelcontextprotocol/sdk` — the MCP server and Tool Explorer
- `@hono/node-server` — `mountMcp()` needs its `HttpBindings`
- `apcore-cli` — the CLI surface
- `apcore-a2a` — the A2A surface
- `@sinclair/typebox`, `zod` — schema dialects (detected structurally; never imported)

That split is deliberate. `apcore-mcp` reaches for `node:http`, so a static
import would break a Workers, Deno, or Bun build of an app that never touches
the MCP surface. Everything optional sits behind `await import(...)` inside a
service method, and nothing optional is re-exported from `src/index.ts`.

## Lifecycle

```ts
const ap = createApcore({ tools, routes, mcp });   // 1. construct

app.use('*', apcore(ap));                          // 2. install the middleware

await ap.init(app);                                // 3. register + scan
await ap.mountMcp(app);                            // 4. mount MCP (optional)

serve({ fetch: app.fetch, port: 3000 });           // 5. listen
```

`init()` runs, in order:

1. `Registry.discover()` when `extensionsDir` is set
2. `options.tools` registered
3. `options.bindings` loaded
4. the app's routes scanned, if an app was passed
5. the A2A server started, if `a2a.port` was set
6. the MCP server started, if `mcp.transport` was set explicitly

Surfaces start last so that every module is registered before a client can list
the tools. `init()` is idempotent — a second call awaits the first rather than
registering twice — and `ready()` awaits an in-flight one. With
`APCORE_ENABLED=false` the whole sequence is skipped.

## Where to go next

- [Tool definition](./tool-definition.md)
- [Route scanner](./route-scanner.md)
- [MCP integration](./mcp-server-integration.md)
- [Schema extraction](./schema-extraction.md)
- [Context and ACL](./context-and-acl.md)
