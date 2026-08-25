# Schema extraction

A tool's `inputSchema` and `outputSchema` may be a TypeBox schema, a Zod schema,
or a plain JSON Schema object. `SchemaExtractor` detects which and converts it
to the JSON Schema that apcore stores on the module descriptor.

## The chain

Adapters are tried in **descending** priority; the first whose `detect()`
returns true wins.

| Adapter | Priority | Detection |
| --- | --- | --- |
| `TypeBoxAdapter` | 100 | Carries `Symbol.for('TypeBox.Kind')` |
| `ZodAdapter` | 50 | Has `safeParse` plus `_def.typeName` (v3) or `_zod.def.type` (v4) |
| `JsonSchemaAdapter` | 30 | A plain object with `type`, `properties`, `anyOf`, `oneOf`, or `$ref` |

Detection is **structural**: neither TypeBox nor Zod is imported at run time. An
app that installs only one of them — or neither — still works, and the adapters
carry no version coupling beyond the shapes they read.

Both conversions are available:

```ts
extractor.extractJsonSchema(schema);   // plain JSON Schema — what apcore stores
extractor.extract(schema);             // TypeBox-compatible TSchema
```

Neither matching anything throws `SchemaExtractionError`.

## TypeBox

TypeBox schemas *are* JSON Schema, decorated with extra `Symbol` properties that
its runtime validator needs. `extract()` returns the schema untouched so those
symbols survive; `extractJsonSchema()` round-trips through JSON, which strips
them.

```ts
import { Type } from '@sinclair/typebox';

inputSchema: Type.Object({
  city: Type.String({ description: 'City name, e.g. "Tokyo"' }),
  days: Type.Optional(Type.Integer({ minimum: 1, maximum: 7 })),
});
```

TypeBox is the recommended dialect — apcore-js already depends on it, and the
mapping is lossless.

## Zod

Both major versions are supported by the same adapter, which reads the internal
definition rather than calling into Zod.

| Construct | Result |
| --- | --- |
| `z.string()`, `z.number()`, `z.boolean()`, `z.date()`, `z.bigint()`, `z.null()` | The matching JSON Schema type |
| `z.number().int()` | `{ type: 'integer' }` |
| `.min()` / `.max()` | `minimum` / `maximum`, or `minLength` / `maxLength` for strings |
| `.gt()` / `.lt()` (v4) | `exclusiveMinimum` / `exclusiveMaximum` |
| `.multipleOf()` (v4) | `multipleOf` |
| `z.email()`, `.url()` and friends (v4) | `format` |
| `z.object()` | `properties` + `required`; `.optional()` and `.default()` drop out of `required` |
| `z.array()` | `items` |
| `z.enum()` | `{ type: 'string', enum: [...] }` |
| `z.nativeEnum()` / v4 enum entries | See below |
| `z.literal()` | `{ type, const }` |
| `z.union()` | `anyOf` |
| `z.record()` | `additionalProperties` |
| `z.nullable()` | `nullable: true` |
| `z.default()` | `default` |
| `.transform()` / `z.coerce.*` (v4 pipes) | Reads through to the **input** side |
| `.describe()` | `description` |

Anything not modelled yields `{}` — permissive rather than wrong.

### Numeric enums

A TypeScript numeric enum compiles to a reverse-mapped object:

```ts
enum Color { Red = 0, Green = 1 }
// -> { 0: 'Red', 1: 'Green', Red: 0, Green: 1 }
```

Only `0` and `1` are values a caller may send; `'Red'` and `'Green'` are the
names. The adapter drops an entry whose value is a string that is itself a key
holding the number this key spells, leaving `{ type: 'number', enum: [0, 1] }`.

`type` is emitted only when every surviving value shares one JSON type; a mixed
enum carries `enum` alone.

> The NestJS adapter's Zod port keeps the *names* here. This is a deliberate
> divergence — see the CHANGELOG.

## JSON Schema

Passed through as a deep clone. Detection requires one recognisable keyword
(`type`, `properties`, `anyOf`, `oneOf`, or `$ref`), and a TypeBox schema is
explicitly excluded so the higher-priority adapter handles it.

```ts
inputSchema: {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
}
```

## Custom adapters

```ts
import { SchemaExtractor, defaultSchemaExtractor } from 'hono-apcore';
import type { SchemaAdapter } from 'hono-apcore';

const valibotAdapter: SchemaAdapter = {
  name: 'valibot',
  priority: 60,
  detect: (input) => isValibotSchema(input),
  extract: (input) => toJsonSchema(input) as never,
  extractJsonSchema: (input) => toJsonSchema(input),
};

defaultSchemaExtractor.registerAdapter(valibotAdapter);
```

`defaultSchemaExtractor` is the process-wide instance the tool registrar and the
route scanner use, so registering there affects both. Build a private
`new SchemaExtractor([...])` when you want an isolated chain.

## No schema at all

A tool without schemas gets `{ type: 'object', properties: {} }` for both. That
is enough to register and call, but it tells a model nothing about the
arguments — declare real schemas for anything an AI will actually use.
