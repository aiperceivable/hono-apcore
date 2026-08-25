# hono-apcore Demo

A Hono application showing how **hono-apcore** turns an ordinary Hono app into
an AI-perceivable one — MCP tools, a Tool Explorer, ACL, and JWT auth — without
rewriting the business logic.

It deliberately uses **both** ways of exposing a capability:

| Surface | How it becomes a tool | Example |
| --- | --- | --- |
| Todo | Hand-written `defineToolset()` — full schemas, explicit annotations | `todo.list`, `todo.add`, … |
| Weather | Route scanning — the Hono routes are replayed in-process | `weather.current.get`, `weather.forecast.get` |

## Quick start

```bash
# From the hono-apcore repo root
pnpm install
pnpm build

cd examples/demo
pnpm install
pnpm dev            # or: npx tsx src/main.ts
```

| | |
| --- | --- |
| REST API | http://localhost:3000/todos |
| MCP endpoint | http://localhost:3000/mcp |
| MCP Explorer | http://localhost:3000/explorer/ |
| Health | http://localhost:3000/health |

Everything is served from **one port** — `ap.mountMcp(app)` mounts the MCP
endpoint and the Explorer into the same Hono app. Set `PORT` to move it.

### Docker

```bash
cd examples/demo
docker compose up --build
```

## What this demo shows

### One store, two doorways

`TodoStore` is a plain class with no apcore imports. `todo.tools.ts` exposes it
as MCP tools; `todo.routes.ts` exposes it as REST. Neither knows about the
other, and the business logic exists once.

```
  REST client  ──▶  todoRoutes  ──┐
                                  ├──▶  TodoStore
  AI / MCP     ──▶  todoTools  ───┘
```

### Route scanning: zero-intrusion tools

`weather.routes.ts` contains nothing but Hono routes. `app.ts` scans them:

```ts
createApcore({
  routes: {
    excludePaths: ['/', '/todos*', '/health', '/mcp*', '/explorer*', '/metrics', '/usage'],
  },
});
```

Each surviving route becomes a module that replays it through `app.request()`,
so middleware, validators, and error handlers all still run. Annotations come
from the HTTP method — `GET` is `readonly + cacheable`, `DELETE` is
`destructive`.

The todo routes are excluded because `todoTools` already covers that surface;
registering both would give an AI client two ways to do one thing.

## Modules

| Module | Origin | Anonymous | Description |
| --- | --- | --- | --- |
| `todo.list` | `defineToolset` | allowed | List todos, filter by completion status |
| `todo.get` | `defineToolset` | allowed | Get a single todo by ID |
| `todo.add` | `defineToolset` | denied | Add a todo |
| `todo.update` | `defineToolset` | denied | Mark a todo done or undone |
| `todo.delete` | `defineToolset` | denied | Delete a todo |
| `weather.current.get` | route scan | allowed | Current weather (mock data) |
| `weather.forecast.get` | route scan | allowed | 3-day forecast (mock data) |
| `system.health.*`, `system.manifest.*`, `system.usage.*` | `registerSysModules` | allowed | apcore system tools |
| `system.control.*` | `registerSysModules` | denied | Feature toggles, reload, config |

## REST endpoints

```bash
curl http://localhost:3000/todos
curl -X POST http://localhost:3000/todos -H 'content-type: application/json' -d '{"title": "Buy milk"}'
curl -X DELETE http://localhost:3000/todos/1
curl http://localhost:3000/weather/current/Tokyo
```

> These routes call `TodoStore` directly, so they are **not** under apcore ACL.
> To place a route under ACL, call the module through the Executor instead —
> see [`examples/acl_demo`](../acl_demo).

## JWT authentication

JWT auth is optional, controlled by `JWT_SECRET`. When it is set, `/mcp`
requires a valid Bearer token; the Explorer UI and `/health` stay exempt.

```bash
JWT_SECRET=my-secret pnpm dev
```

Pre-generated token (secret `my-secret`, HS256, payload
`{"sub":"demo-user","type":"user","roles":["admin"]}`):

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZW1vLXVzZXIiLCJ0eXBlIjoidXNlciIsInJvbGVzIjpbImFkbWluIl19.yOFQMlZnMZwXg6KoJX61sCm2VbCzmqtT8dFRNsOhaZM
```

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZW1vLXVzZXIiLCJ0eXBlIjoidXNlciIsInJvbGVzIjpbImFkbWluIl19.yOFQMlZnMZwXg6KoJX61sCm2VbCzmqtT8dFRNsOhaZM"

curl http://localhost:3000/health                                  # always exempt
curl -X POST http://localhost:3000/mcp -d '{}'                     # 401 without a token
curl -X POST http://localhost:3000/mcp -H "Authorization: Bearer $TOKEN" -d '{}'
```

Every todo tool reports the caller, so the identity chain stays visible:

```json
{ "todos": [], "count": 0, "caller": "demo-user" }
```

Without a token (or with JWT disabled) `caller` is `"anonymous"`.

In the Explorer, paste the token into the **Authorization** field at the top of
the page to execute tools as that identity.

## ACL

`acl.yaml` is loaded through `apcore.yaml`'s `acl.root` and enforced by the
Executor on every module call.

```yaml
default_effect: deny

rules:
  - description: "Reads are public — no credentials required"
    callers: ["*"]
    targets: ["todo.list", "todo.get", "weather.*", "system.health.*", "system.manifest.*", "system.usage.*"]
    effect: allow

  - description: "Only an authenticated user may mutate todos or toggle features"
    callers: ["*"]
    targets: ["todo.*", "system.control.*"]
    effect: allow
    conditions:
      identity_types: ["user"]
```

An MCP client with no credentials reaches the Executor with no identity, which
the ACL evaluates as the caller `@external` — hence the `callers: ["*"]` plus an
`identity_types` condition rather than a caller name. With `JWT_SECRET` set,
`JWTAuthenticator` maps the token's `sub` to `identity.id` and its `type` claim
to `identity.type`, so the second rule matches only real callers.

### Try it

```bash
# Anonymous: reads succeed, writes are denied
pnpm dev
# ... call todo.list  -> ok
# ... call todo.add   -> "Access denied"

# Authenticated: both succeed
JWT_SECRET=my-secret pnpm dev
```

Delete `acl.yaml` to run without enforcement.

## System modules

With `apcore.yaml` present, `registerSysModules()` adds:

| Tool | Description |
| --- | --- |
| `system.health.summary` | Health check |
| `system.usage.summary` | Runtime metrics |
| `system.manifest.full` | List every registered tool |
| `system.control.toggle_feature` | Enable or disable a tool at run time |
| `system.control.reload_module` | Reload a module without restarting |

Remove `apcore.yaml` to drop them.

## CLI

The same app works with the `hono-apcore` CLI, no code changes:

```bash
pnpm scan                     # print the scanned routes as a table
pnpm export                   # OpenAI-compatible tool definitions
```

## Project structure

```
examples/demo/
├── acl.yaml                     # ACL rules (delete to disable enforcement)
├── apcore.yaml                  # apcore config (sys_modules, log level, acl.root)
├── src/
│   ├── main.ts                  # bootstrap: init, mountMcp, listen
│   ├── app.ts                   # Hono app + apcore instance
│   ├── todo/
│   │   ├── todo.store.ts        # plain state, no apcore imports
│   │   ├── todo.tools.ts        # defineToolset() — hand-written tools
│   │   └── todo.routes.ts       # REST over the same store
│   └── weather/
│       ├── geo.ts               # plain helper
│       └── weather.routes.ts    # plain routes, scanned into tools
├── Dockerfile
└── docker-compose.yml
```

## Key takeaway

Declaring a `defineToolset()` — or just letting the route scanner read your
existing routes — is all it takes. Your handlers stay ordinary Hono handlers,
testable with `app.request()`, and every apcore middleware, ACL rule, and
observability hook applies to both doorways.
