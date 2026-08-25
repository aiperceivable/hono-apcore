# Tool definition

`defineTool()` is the Hono counterpart to the NestJS adapter's `@ApTool`
decorator. NestJS has classes and a DI container to decorate; Hono has neither,
so a tool here is a plain object that carries its own metadata and its handler.

## `defineTool()`

```ts
import { Type } from '@sinclair/typebox';
import { defineTool } from 'hono-apcore';

export const sendEmail = defineTool({
  namespace: 'email',
  name: 'send',
  description: 'Send an email',
  inputSchema: Type.Object({
    to: Type.String({ format: 'email' }),
    subject: Type.String(),
    body: Type.String(),
  }),
  outputSchema: Type.Object({ messageId: Type.String() }),
  annotations: { readonly: false, destructive: false, requiresApproval: true },
  tags: ['email', 'mutate'],
  documentation: 'Delivers through the configured SMTP relay.',
  params: { to: 'Recipient address' },
  examples: [
    {
      title: 'Simple send',
      inputs: { to: 'a@b.c', subject: 'Hi', body: 'Hello' },
      output: { messageId: 'abc123' },
    },
  ],
  handler: async (inputs, context) => mailer.send(inputs, context),
});
```

The function is an identity helper — it exists for type inference and for a
single obvious place to look up the shape.

### Fields

| Field | Required | Notes |
| --- | --- | --- |
| `description` | yes | Surfaced to AI clients; the main thing a model reads |
| `handler` | yes | `(inputs, context) => result` |
| `id` | | Used verbatim, bypassing `namespace`/`name` |
| `namespace` / `name` | | Joined as `"<namespace>.<name>"`, `name` snake-cased |
| `inputSchema` / `outputSchema` | | TypeBox, Zod, or plain JSON Schema |
| `annotations` | | Behavioural flags, see below |
| `tags` | | Used by MCP `tags` filtering and by grouping |
| `documentation` | | Long-form prose |
| `params` | | Per-parameter prose merged into the input schema |
| `examples` | | `{ title, inputs, output, description? }` |

### Module IDs

`resolveToolId()` decides, in order:

1. `id`, verbatim
2. `"<namespace>.<name>"` with `name` snake-cased — `listAll` → `list_all`
3. the handler's function name, snake-cased

A handler written inline picks up the property key as its name — `{ handler:
() => {} }` yields the name `"handler"` — so that value is *not* used as a
fallback; it would silently produce a module called `<namespace>.handler`.
Give the tool an `id`, a `name`, or a named function.

`APCORE_MODULE_PREFIX` (or `settings.modulePrefix`) is prepended to whatever
comes out.

### Annotations

| Flag | Meaning |
| --- | --- |
| `readonly` | Makes no observable change |
| `destructive` | Removes or overwrites data |
| `idempotent` | Repeating the call has the same effect as making it once |
| `requiresApproval` | Routed through the approval gate before executing |
| `openWorld` | Reaches systems outside this process |
| `streaming` | Yields incremental results |
| `cacheable`, `cacheTtl`, `cacheKeyFields` | Cacheability of the result |
| `paginated`, `paginationStyle` | `cursor` / `offset` / `page` |

Anything you leave out takes its value from apcore's `DEFAULT_ANNOTATIONS`.

### Handler contract

```ts
handler: (inputs: Record<string, unknown>, context?: unknown) => unknown
```

`inputs` is the argument object; `context` is the apcore `Context` when the
caller supplied one. A non-object return is wrapped as `{ result: value }`, and
`null` / `undefined` become `{}`, so every module honours the object-output
contract.

### Why `params` instead of JSDoc

The Python integrations read a function's docstring at run time. JavaScript
cannot: `Function.prototype.toString()` returns the source from the `function`
keyword onward, so a leading `/** ... */` comment is simply not there. A
JSDoc-scanning implementation would compile, look plausible, and never once
fire. `params` states the same information explicitly:

```ts
defineTool({
  id: 'weather.current',
  description: 'Current weather for a city',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
  params: { city: 'City name, e.g. "Tokyo"' },
  handler: (inputs) => forecast(inputs.city),
});
```

It is merged into the input schema's property descriptions with
apcore-toolkit's `enrichSchemaDescriptions()`.

## `defineToolset()`

Groups several tools under one namespace, applying shared tags and annotations.
The record key becomes each tool's name.

```ts
export const todoTools = defineToolset({
  namespace: 'todo',
  description: 'Todo list management',
  tags: ['todo'],
  annotations: { readonly: true },
  tools: {
    list:   { description: 'List todos', handler: list },
    add:    { description: 'Add a todo', annotations: { readonly: false }, handler: add },
    remove: { name: 'delete', description: 'Delete a todo', handler: remove },
  },
});
// -> todo.list, todo.add, todo.delete
```

A tool's own `tags` / `annotations` replace the shared ones rather than merging
with them. `description` falls back to the toolset description, then the record
key.

## Registering

```ts
const ap = createApcore({ tools: todoTools });   // registered during init()

await ap.registerTool(sendEmail);                // or at run time
await ap.registerTools([a, b, c]);
```

### From a service object

For an existing class or object literal, skip the per-method definitions:

```ts
await ap.registerObject({
  instance: new TodoService(),
  methods: '*',              // or ['list', 'add']
  exclude: ['internalHelper'],
  namespace: 'todo',         // default: the class name, suffix-stripped and snake-cased
  tags: ['todo'],
  methodOptions: {
    list: { description: 'List todos', inputSchema: ListSchema },
  },
});
```

`'*'` walks the prototype chain and own enumerable function properties, so both
class instances and object literals of arrow functions work. Without schemas the
modules get an empty object schema, which is enough to call them but tells a
model very little — prefer `methodOptions` or `defineTool` for anything an AI
will actually use.
