# MCP server integration

`hono-apcore` serves the registered modules as [MCP](https://modelcontextprotocol.io/)
tools two ways: **embedded** into the Hono app, or **standalone** on its own
port or over stdio.

`apcore-mcp` is an optional peer dependency loaded lazily, so importing
`hono-apcore` never pulls it — or `node:http` — into a build that does not use
the MCP surface.

## Embedded — one process, one port

```ts
import { serve } from '@hono/node-server';
import { apcore, createApcore } from 'hono-apcore';

const ap = createApcore({
  tools: todoTools,
  mcp: { name: 'my-app', explorer: true, allowExecute: true },
});

const app = new Hono();
app.use('*', apcore(ap));
app.get('/todos', (c) => c.json(store.list()));

await ap.init(app);
await ap.mountMcp(app, { endpoint: '/mcp' });

serve({ fetch: app.fetch, port: 3000 });
```

`mountMcp()` registers:

| Path | Serves |
| --- | --- |
| `endpoint` (default `/mcp`) | The Streamable HTTP MCP transport |
| `explorerPrefix` and its subtree | The Tool Explorer UI, when `explorer` is on |
| `/health`, `/metrics`, `/usage` | Built-in endpoints, unless `builtinRoutes: false` |

It returns the embedded `McpApp`; call `close()` on shutdown (or `ap.close()`,
which does it for you).

### How the bridge works

MCP's Streamable HTTP transport speaks SSE and needs direct control of the
response stream, which Hono's `Response`-returning model does not give it.
`apcore-mcp` hands back a Node `(req, res)` handler instead.

On the Node runtime, `@hono/node-server` exposes the raw objects as
`HttpBindings` on `c.env`, so the mounted handler writes to the Node
`ServerResponse` and returns the already-sent sentinel — a `Response` carrying
`x-hono-already-sent: true`, which the adapter recognises as "the handler
already wrote this one".

The package constructs that sentinel itself rather than importing
`RESPONSE_ALREADY_SENT` from `@hono/node-server/utils/response`, so mounting
never makes the Node adapter a hard dependency; the header name is the contract.

**This is Node-only.** On Workers, Deno, or Bun there are no such bindings and
the mounted route answers `501` saying so. Use a standalone server there.

### Path prefixes

The MCP handler routes on `req.url` as the HTTP server sees it. If the Hono app
sits under a `basePath`, include the prefix:

```ts
const app = new Hono().basePath('/api');
await ap.mountMcp(app, { endpoint: '/api/mcp' });
```

## Standalone — its own port, or stdio

Set a transport explicitly and `init()` starts the server:

```ts
createApcore({
  mcp: {
    transport: 'streamable-http',
    host: '0.0.0.0',
    port: 8000,
    explorer: true,
  },
});
```

`transport: 'stdio'` takes over the process's stdio, which is right for a
CLI-launched MCP server and wrong for a web process — use `mountMcp()` there.

`APCORE_TRANSPORT`, `APCORE_HOST`, and `APCORE_PORT` supply the defaults for
`ApcoreMcpService.start()`, but they do **not** make `init()` start a server;
only an explicit `mcp.transport` does. Otherwise setting an environment variable
in an unrelated process would hijack stdio.

## Options

Everything is forwarded to `apcore-mcp`.

| Field | Type | Description |
| --- | --- | --- |
| `transport` | `'stdio' \| 'streamable-http' \| 'sse'` | Standalone transport |
| `host` / `port` | `string` / `number` | Bind address for HTTP transports |
| `name` / `version` | `string` | Server identity in the MCP handshake |
| `explorer` | `boolean` | Tool Explorer web UI |
| `explorerPrefix` | `string` | Default `/explorer` |
| `allowExecute` | `boolean` | Allow executing tools from the Explorer |
| `explorerTitle` / `explorerProjectName` / `explorerProjectUrl` | `string` | Explorer branding |
| `tags` / `prefix` | `string[]` / `string` | Expose only matching modules |
| `validateInputs` | `boolean` | Enforce input schemas on every call |
| `logLevel` | `'DEBUG' … 'CRITICAL'` | Suppress console output below this level |
| `authenticator` | `Authenticator` | JWT or a custom strategy |
| `requireAuth` | `boolean` | Reject unauthenticated requests (default true when an authenticator is set) |
| `exemptPaths` | `string[]` | Default `["/health", "/metrics"]` |
| `metricsCollector` | `MetricsExporter \| true` | Enables `/metrics` |
| `observability` | flag | Metrics **and** usage middleware, plus `/usage` |
| `outputFormat` | `'json' \| 'csv' \| 'jsonl'` | Built-in result serialisation |
| `outputFormatter` | function | Custom result-to-text formatting |
| `redactOutput` | `boolean` | Redact sensitive fields (default true) |
| `trace` | `boolean` | Attach the pipeline trace to responses |
| `strategy` | `string` | Execution strategy name |
| `approvalHandler` / `approvalStore` / `approvalNotify` | | The approval gate |
| `mcpMiddleware` / `mcpAcl` | | Extra apcore middleware / ACL for the MCP executor (forwarded as `middleware` / `acl`) |
| `dynamic` | `boolean` | Announce tool-list changes as modules are registered |
| `onStartup` / `onShutdown` | callbacks | Standalone lifecycle hooks |

## JWT authentication

```ts
import { JWTAuthenticator, getCurrentIdentity } from 'apcore-mcp';

createApcore({
  mcp: {
    authenticator: process.env.JWT_SECRET
      ? new JWTAuthenticator({ secret: process.env.JWT_SECRET })
      : undefined,
  },
});
```

Inside a tool handler, `getCurrentIdentity()` returns the authenticated caller:

```ts
handler: () => ({ items: store.list(), caller: getCurrentIdentity()?.id ?? 'anonymous' })
```

The Explorer UI and `/health` stay exempt so the page still loads; paste a token
into the Explorer's **Authorization** field to execute tools as that identity.

An unauthenticated MCP call reaches the Executor with **no identity at all**,
which the ACL evaluates as the caller `@external` — not `"anonymous"`. Write ACL
rules accordingly; see [Context and ACL](./context-and-acl.md).

## OpenAI tools

```ts
const tools = await ap.toOpenaiTools({ tags: ['todo'] });
```

OpenAI function names cannot contain dots, so `apcore-mcp` normalises the module
ID separator: `todo.list` becomes `todo-list`.

## Service API

| Member | Description |
| --- | --- |
| `start(overrides?)` | Run a standalone server; overrides apply to this call |
| `asyncServe(options?)` | Build the embeddable app; repeated calls return the same one |
| `stop()` | Close the embedded app and mark the service stopped |
| `restart()` | `stop()` then `start()` |
| `toOpenaiTools(options?)` | OpenAI-compatible definitions |
| `isRunning` / `app` / `toolCount` | State, honouring the `tags` / `prefix` filters |
