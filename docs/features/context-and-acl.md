# Context and ACL

Every apcore module call carries a `Context`: who the caller is, the trace they
belong to, and any correlation data. That context is what apcore's ACL, approval
gate, and observability middleware read — so getting it right is what puts your
Hono routes under governance.

## The middleware

```ts
import { apcore, getApcore, getApcoreContext } from 'hono-apcore';

app.use('*', apcore(ap));

app.get('/orders', async (c) =>
  c.json(await getApcore(c).executor.call('orders.list', {}, getApcoreContext(c))),
);
```

`apcore()` sets two Hono context variables:

| Variable | Accessor | Contents |
| --- | --- | --- |
| `apcore` | `getApcore(c)` | The `HonoApcore` instance |
| `apcoreContext` | `getApcoreContext(c)` | The per-request apcore `Context` |

The `ContextVariableMap` is augmented, so `c.get('apcore')` is typed as well.
The accessors exist because they throw a sentence that names the fix when the
middleware has not run.

Pass `{ skipContext: true }` on routes that never call modules to skip building
the context, and `{ contextFactory }` to supply your own.

## `HonoContextFactory`

Accepts a Hono context, a raw `Request`, a `Headers` instance, or the plain
header record a Node handler sees — the same factory serves routes, middleware,
and tests.

### Identity resolution

In order:

1. **`x-user-id`** → `Identity(id, 'user', roles)`
2. **`Authorization: Bearer …`** → `Identity('bearer', 'api_key', roles)`
3. **a bare `x-roles` header** → `Identity('u1', 'user', roles)`
4. otherwise → `Identity('anonymous', 'anonymous')`

Roles come from a comma-separated `x-roles` header in every case.

Rules 1 and 3 are **demo shortcuts** — anyone can send those headers. In
production, resolve the caller from a verified JWT or session:

```ts
app.use(
  '*',
  apcore(ap, {
    contextFactory: new HonoContextFactory({
      resolveIdentity: (headers) => {
        const claims = verifyJwt(headers.get('authorization'));
        return claims ? createIdentity(claims.sub, 'user', claims.roles) : null;
      },
      data: (headers) => ({ tenant: headers.get('x-tenant') }),
    }),
  }),
);
```

Returning `null` falls through to the header heuristics; returning an `Identity`
wins outright.

### Trace propagation

A `traceparent` header supplies the trace id, via
`TraceContext.extract()` → `Context.create()`. Strict 32-hex validation and the
rejection of W3C-invalid ids happen inside the SDK (PROTOCOL_SPEC §10.5), not
here — an invalid inbound id starts a fresh trace rather than being adopted.

`x-correlation-id` (or `x-request-id`) is copied into
`context.data['x-correlation-id']` so existing log pipelines stay correlatable.

## Governing routes with ACL

An ACL only applies to calls that go **through the Executor**. A route calling
its service directly is not governed:

```ts
// NOT under ACL — the store is called directly
app.get('/orders', (c) => c.json(orderStore.list()));

// Under ACL — the module is called through the Executor
app.get('/orders', async (c) =>
  c.json(await getApcore(c).executor.call('orders.list', {}, getApcoreContext(c))),
);
```

A denied call raises `ACLDeniedError`, which you map to a status:

```ts
try {
  return c.json(await ap.executor.call(moduleId, inputs, getApcoreContext(c)));
} catch (err) {
  if (err instanceof ACLDeniedError) return c.json({ error: String(err.message) }, 403);
  throw err;
}
```

See [`examples/acl_demo`](../../examples/acl_demo) for the whole thing.

## Loading an ACL

```ts
import { ACL, Config } from 'apcore-js';

// Explicit path — independent of the working directory
const acl = ACL.load(join(here, 'acl.yaml'));

// Or discovery: apcore.yaml's acl.root, resolved from the process CWD
const acl = ACL.discover(Config.discover()) ?? undefined;

createApcore({ acl });
```

`apcore.yaml` requires `version` and `project.name` alongside whatever else it
declares:

```yaml
version: "1.0.0"
project:
  name: my-app
acl:
  root: ./acl.yaml
```

## Writing rules

```yaml
default_effect: deny

rules:
  - description: Admins may call any module
    callers: ["*"]
    targets: ["*"]
    effect: allow
    conditions:
      roles: ["admin"]

  - description: Anyone may read the order list
    callers: ["*"]
    targets: ["orders.list"]
    effect: allow
```

Rules are first-match-wins; anything matching none falls through to
`default_effect`. Built-in conditions: `identity_types`, `roles`,
`max_call_depth`, `$or`, `$not`. Register your own with
`ACL.registerCondition()`.

### The caller of an unauthenticated MCP call is `@external`

This trips people up. When a call reaches the Executor with **no identity at
all** — which is what an MCP request without an authenticator produces — the ACL
evaluates the caller as `@external`, *not* `"anonymous"`. A rule written as
`callers: ["anonymous"]` will not match it, and with `default_effect: deny`
every such call is denied.

`"anonymous"` is what `HonoContextFactory` produces for an unauthenticated
*HTTP route*, which is a different path.

To allow public reads over MCP, match on the target and gate the rest on
identity:

```yaml
default_effect: deny

rules:
  - description: Reads are public — no credentials required
    callers: ["*"]
    targets: ["todo.list", "todo.get", "weather.*"]
    effect: allow

  - description: Only an authenticated user may mutate
    callers: ["*"]
    targets: ["todo.*"]
    effect: allow
    conditions:
      identity_types: ["user"]
```

With `JWTAuthenticator` configured, the token's `sub` becomes `identity.id` and
its `type` claim becomes `identity.type`, so the second rule matches only real
callers.

## Scanned routes and identity

A scanned route module replays the route through `app.request()`, forwarding the
context's identity as `x-user-id` / `x-roles` and its trace as `traceparent`. A
route that reads those headers therefore sees the original caller even when the
call arrived over MCP — and `HonoContextFactory` on the replayed request rebuilds
an equivalent identity.
