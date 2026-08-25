import type { TSchema } from '@sinclair/typebox';
import type { SchemaAdapter } from './schema-adapter.interface.js';

// ---------------------------------------------------------------------------
// Structural probes — introspect Zod without importing it at runtime
// ---------------------------------------------------------------------------

/** Loose shape of a Zod 3 schema's `_def` object. */
interface ZodV3Def {
  typeName?: string;
  description?: string;
  [key: string]: unknown;
}

/** Loose shape of a Zod 4 schema's `_zod.def` object. */
interface ZodV4Def {
  type?: string;
  [key: string]: unknown;
}

interface ZodV3Like {
  _def: ZodV3Def;
  description?: string;
  safeParse: (input: unknown) => unknown;
}

interface ZodV4Like {
  _zod: { def: ZodV4Def };
  description?: string;
  safeParse: (input: unknown) => unknown;
}

function hasSafeParse(input: unknown): input is { safeParse: (v: unknown) => unknown } {
  return (
    input !== null &&
    typeof input === 'object' &&
    'safeParse' in (input as object) &&
    typeof (input as Record<string, unknown>)['safeParse'] === 'function'
  );
}

function isZodV3(input: unknown): input is ZodV3Like {
  if (!hasSafeParse(input)) return false;
  const def = (input as Record<string, unknown>)['_def'];
  return (
    def !== null &&
    typeof def === 'object' &&
    typeof (def as ZodV3Def).typeName === 'string'
  );
}

function isZodV4(input: unknown): input is ZodV4Like {
  if (!hasSafeParse(input)) return false;
  const internals = (input as Record<string, unknown>)['_zod'];
  if (internals === null || typeof internals !== 'object') return false;
  const def = (internals as Record<string, unknown>)['def'];
  return def !== null && typeof def === 'object' && typeof (def as ZodV4Def).type === 'string';
}

/** A `.description` set via `.describe()` — available on both Zod 3 and 4. */
function describedAs(schema: { description?: string }): string | undefined {
  return typeof schema.description === 'string' && schema.description.length > 0
    ? schema.description
    : undefined;
}

function withDescription(
  result: Record<string, unknown>,
  schema: { description?: string },
): Record<string, unknown> {
  const description = describedAs(schema);
  if (description !== undefined && result['description'] === undefined) {
    result['description'] = description;
  }
  return result;
}


// ---------------------------------------------------------------------------
// Enum helpers (shared by both major versions)
// ---------------------------------------------------------------------------

/**
 * Build the JSON Schema fragment for an enum from its entries object.
 *
 * TypeScript numeric enums are emitted with a reverse mapping — `enum Color
 * { Red = 0 }` compiles to `{ 0: 'Red', Red: 0 }` — and only the forward
 * entries are values a caller may actually send. An entry is a reverse
 * mapping when its value is a string that is itself a key holding the number
 * this key spells.
 *
 * `type` is only emitted when every surviving value shares one JSON type;
 * a mixed enum carries `enum` alone.
 */
function enumFromEntries(entries: Record<string, string | number>): Record<string, unknown> {
  const values = Object.entries(entries)
    .filter(([key, value]) => {
      if (typeof value !== 'string') return true;
      const roundTrip = entries[value];
      return typeof roundTrip !== 'number' || String(roundTrip) !== key;
    })
    .map(([, value]) => value);

  const result: Record<string, unknown> = { enum: values };

  if (values.length > 0 && values.every((v) => typeof v === 'string')) {
    result['type'] = 'string';
  } else if (values.length > 0 && values.every((v) => typeof v === 'number')) {
    result['type'] = 'number';
  }

  return result;
}

// ---------------------------------------------------------------------------
// Zod 3 -> JSON Schema
// ---------------------------------------------------------------------------

function convertV3(schema: ZodV3Like): Record<string, unknown> {
  const def = schema._def;
  const typeName: string = def.typeName ?? '';
  let result: Record<string, unknown>;

  switch (typeName) {
    case 'ZodString':
      result = { type: 'string' };
      break;

    case 'ZodNumber':
      result = convertV3Number(def);
      break;

    case 'ZodBoolean':
      result = { type: 'boolean' };
      break;

    case 'ZodObject':
      result = convertV3Object(def);
      break;

    case 'ZodArray':
      result = { type: 'array', items: convertV3(def['type'] as ZodV3Like) };
      break;

    case 'ZodEnum':
      result = { type: 'string', enum: [...(def['values'] as string[])] };
      break;

    case 'ZodNativeEnum':
      result = enumFromEntries(def['values'] as Record<string, string | number>);
      break;

    case 'ZodOptional':
      result = convertV3(def['innerType'] as ZodV3Like);
      break;

    case 'ZodNullable':
      result = { ...convertV3(def['innerType'] as ZodV3Like), nullable: true };
      break;

    case 'ZodDefault':
      result = {
        ...convertV3(def['innerType'] as ZodV3Like),
        default: (def['defaultValue'] as () => unknown)(),
      };
      break;

    case 'ZodLiteral': {
      const value = def['value'] as string | number | boolean;
      result = { type: typeof value, const: value };
      break;
    }

    case 'ZodUnion':
      result = { anyOf: (def['options'] as ZodV3Like[]).map(convertV3) };
      break;

    case 'ZodRecord':
      result = {
        type: 'object',
        additionalProperties: convertV3(def['valueType'] as ZodV3Like),
      };
      break;

    case 'ZodEffects':
      result = convertV3(def['schema'] as ZodV3Like);
      break;

    default:
      result = {};
      break;
  }

  if (typeof def.description === 'string' && def.description.length > 0) {
    result['description'] = def.description;
  }

  return withDescription(result, schema);
}

function convertV3Number(def: ZodV3Def): Record<string, unknown> {
  const checks: Array<{ kind: string; value?: number }> = (def['checks'] as never) ?? [];
  const result: Record<string, unknown> = {};
  let type = 'number';

  for (const check of checks) {
    switch (check.kind) {
      case 'int':
        type = 'integer';
        break;
      case 'min':
        result['minimum'] = check.value;
        break;
      case 'max':
        result['maximum'] = check.value;
        break;
    }
  }

  result['type'] = type;
  return result;
}

function convertV3Object(def: ZodV3Def): Record<string, unknown> {
  const shapeFn = def['shape'] as (() => Record<string, ZodV3Like>) | undefined;
  const shape = typeof shapeFn === 'function' ? shapeFn() : undefined;
  if (!shape) return { type: 'object' };

  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(shape)) {
    properties[key] = convertV3(field);
    const fieldType = field._def.typeName;
    if (fieldType !== 'ZodOptional' && fieldType !== 'ZodDefault') {
      required.push(key);
    }
  }

  const result: Record<string, unknown> = { type: 'object', properties };
  if (required.length > 0) result['required'] = required;
  return result;
}

// ---------------------------------------------------------------------------
// Zod 4 -> JSON Schema
// ---------------------------------------------------------------------------

/** Type names that make an object property optional in Zod 4. */
const V4_OPTIONAL_TYPES = new Set(['optional', 'default', 'prefault']);

function v4Def(schema: ZodV4Like): ZodV4Def {
  return schema._zod.def;
}

function convertV4(schema: ZodV4Like): Record<string, unknown> {
  const def = v4Def(schema);
  let result: Record<string, unknown>;

  switch (def.type) {
    case 'string':
      result = convertV4String(def);
      break;

    case 'number':
    case 'int':
      result = convertV4Number(def);
      break;

    case 'bigint':
      result = { type: 'integer' };
      break;

    case 'boolean':
      result = { type: 'boolean' };
      break;

    case 'date':
      result = { type: 'string', format: 'date-time' };
      break;

    case 'null':
      result = { type: 'null' };
      break;

    case 'object':
      result = convertV4Object(def);
      break;

    case 'array':
      result = { type: 'array', items: convertV4(def['element'] as ZodV4Like) };
      break;

    case 'enum':
      result = enumFromEntries((def['entries'] as Record<string, string | number>) ?? {});
      break;

    case 'literal': {
      const values = (def['values'] as unknown[]) ?? [];
      result =
        values.length === 1
          ? { type: typeof values[0], const: values[0] }
          : { enum: [...values] };
      break;
    }

    case 'optional':
    case 'nonoptional':
    case 'readonly':
    case 'catch':
      result = convertV4(def['innerType'] as ZodV4Like);
      break;

    case 'nullable':
      result = { ...convertV4(def['innerType'] as ZodV4Like), nullable: true };
      break;

    case 'default':
    case 'prefault':
      result = {
        ...convertV4(def['innerType'] as ZodV4Like),
        default: def['defaultValue'],
      };
      break;

    case 'union':
      result = { anyOf: (def['options'] as ZodV4Like[]).map(convertV4) };
      break;

    case 'record':
      result = {
        type: 'object',
        additionalProperties: convertV4(def['valueType'] as ZodV4Like),
      };
      break;

    case 'pipe':
      // `.transform()` / `z.coerce.*` wrap the source schema in a pipe; the
      // input side is what a caller must supply.
      result = convertV4(def['in'] as ZodV4Like);
      break;

    default:
      result = {};
      break;
  }

  return withDescription(result, schema);
}

/** Read the `_zod.def` of a Zod 4 check object. */
function v4CheckDef(check: unknown): Record<string, unknown> {
  const internals = (check as Record<string, unknown> | null)?.['_zod'];
  if (internals === null || typeof internals !== 'object') return {};
  return ((internals as Record<string, unknown>)['def'] as Record<string, unknown>) ?? {};
}

function convertV4String(def: ZodV4Def): Record<string, unknown> {
  const result: Record<string, unknown> = { type: 'string' };

  for (const check of (def['checks'] as unknown[]) ?? []) {
    const cd = v4CheckDef(check);
    switch (cd['check']) {
      case 'min_length':
        result['minLength'] = cd['minimum'];
        break;
      case 'max_length':
        result['maxLength'] = cd['maximum'];
        break;
      case 'length_equals':
        result['minLength'] = cd['length'];
        result['maxLength'] = cd['length'];
        break;
      case 'string_format':
        if (typeof cd['format'] === 'string' && cd['format'] !== 'regex') {
          result['format'] = cd['format'];
        }
        break;
    }
  }

  // `z.email()` and friends put the format on the def itself, not in checks.
  if (typeof def['format'] === 'string' && result['format'] === undefined) {
    result['format'] = def['format'];
  }

  return result;
}

/** Zod 4 numeric formats that map to JSON Schema `integer`. */
const V4_INT_FORMATS = new Set(['safeint', 'int32', 'uint32', 'int64', 'uint64']);

function convertV4Number(def: ZodV4Def): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let type = def.type === 'int' ? 'integer' : 'number';

  for (const check of (def['checks'] as unknown[]) ?? []) {
    const cd = v4CheckDef(check);
    switch (cd['check']) {
      case 'number_format':
        if (typeof cd['format'] === 'string' && V4_INT_FORMATS.has(cd['format'])) {
          type = 'integer';
        }
        break;
      case 'greater_than':
        if (cd['inclusive']) result['minimum'] = cd['value'];
        else result['exclusiveMinimum'] = cd['value'];
        break;
      case 'less_than':
        if (cd['inclusive']) result['maximum'] = cd['value'];
        else result['exclusiveMaximum'] = cd['value'];
        break;
      case 'multiple_of':
        result['multipleOf'] = cd['value'];
        break;
    }
  }

  result['type'] = type;
  return result;
}

function convertV4Object(def: ZodV4Def): Record<string, unknown> {
  const shape = def['shape'] as Record<string, ZodV4Like> | undefined;
  if (!shape) return { type: 'object' };

  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(shape)) {
    properties[key] = convertV4(field);
    if (!V4_OPTIONAL_TYPES.has(v4Def(field).type ?? '')) {
      required.push(key);
    }
  }

  const result: Record<string, unknown> = { type: 'object', properties };
  if (required.length > 0) result['required'] = required;
  return result;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Schema adapter for Zod, supporting both Zod 3 and Zod 4.
 *
 * Detection and conversion are structural — Zod is never imported — so the
 * adapter works whichever major version (if any) the host app installs.
 * Zod 3 is recognised by `_def.typeName`, Zod 4 by `_zod.def.type`.
 */
export class ZodAdapter implements SchemaAdapter {
  readonly name = 'zod' as const;
  readonly priority = 50;

  detect(input: unknown): boolean {
    return isZodV3(input) || isZodV4(input);
  }

  extract(input: unknown): TSchema {
    return this.extractJsonSchema(input) as unknown as TSchema;
  }

  extractJsonSchema(input: unknown): Record<string, unknown> {
    if (isZodV4(input)) return convertV4(input);
    if (isZodV3(input)) return convertV3(input);
    throw new Error('ZodAdapter.extractJsonSchema: input is not a Zod schema');
  }
}
