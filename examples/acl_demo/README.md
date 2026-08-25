# hono-apcore ACL demo

Shows how a Hono application enforces apcore **Access Control Lists (ACL)** on
apcore module calls made from its own routes — the same `orders.delete`
(admins only) / `orders.list` (public read) contract used across every apcore
framework integration.

## What it shows

| Call | Roles | Result |
| --- | --- | --- |
| `DELETE /orders/1` | *(none — anonymous)* | **403** |
| `DELETE /orders/1` | `user` | **403** |
| `DELETE /orders/1` | `admin` | **200** `{"deleted": 1}` |
| `GET /orders` | *(any)* | **200** (read is public) |

## How it works

1. [`app.ts`](./app.ts) loads [`acl.yaml`](./acl.yaml) with `ACL.load(path)` and
   passes it to `createApcore({ acl })`, so the Executor enforces it on every
   module call.
2. [`orders.ts`](./orders.ts) declares `orders.delete` / `orders.list` with
   `defineToolset()`.
3. The `apcore()` middleware builds an apcore `Context` per request via
   `HonoContextFactory`, which turns a comma-separated `X-Roles` header into an
   `Identity(roles=...)`.
4. Each route calls the module through
   `getApcore(c).executor.call(moduleId, inputs, getApcoreContext(c))` — going
   *through* the Executor is what places the route under ACL. A denied call
   raises `ACLDeniedError`, which the handler maps to HTTP 403.

`acl.yaml` (first-match-wins, `default_effect: deny`):

- **admins** (`roles: [admin]`) may call any module;
- **anyone**, including anonymous callers, may call `orders.list`;
- everything else falls through to `deny`.

## Run it

From the repository root, after `pnpm install && pnpm build`:

```bash
npx tsx examples/acl_demo/main.ts     # PORT=3012 npx tsx ... to use another port

curl -X DELETE localhost:3000/orders/1                       # 403 (anonymous)
curl -X DELETE localhost:3000/orders/1 -H 'X-Roles: user'    # 403 (not admin)
curl -X DELETE localhost:3000/orders/1 -H 'X-Roles: admin'   # 200
curl localhost:3000/orders                                   # 200 (read is public)
```

> **NOTE:** The `X-Roles` header is a demo shortcut standing in for real
> authentication. In production, resolve the user and their roles from a JWT or
> session and hand them to the context factory:
>
> ```ts
> apcore(ap, {
>   contextFactory: new HonoContextFactory({
>     resolveIdentity: (headers) => identityFromSession(headers),
>   }),
> })
> ```
