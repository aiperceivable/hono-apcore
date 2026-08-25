import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodAdapter } from '../../src/schema/adapters/zod.adapter.js';

const adapter = new ZodAdapter();

/**
 * The installed Zod is v4; v3 is exercised through hand-built structural
 * doubles, which is exactly what the adapter itself inspects — it never
 * imports Zod, only reads `_def.typeName` / `_zod.def.type`.
 */
function v3(def: Record<string, unknown>): unknown {
  return { _def: def, safeParse: () => ({ success: true }) };
}

describe('ZodAdapter detection', () => {
  it('detects Zod 4 schemas', () => {
    expect(adapter.detect(z.string())).toBe(true);
    expect(adapter.detect(z.object({ a: z.number() }))).toBe(true);
  });

  it('detects Zod 3 schemas', () => {
    expect(adapter.detect(v3({ typeName: 'ZodString' }))).toBe(true);
  });

  it('rejects non-Zod values', () => {
    expect(adapter.detect(null)).toBe(false);
    expect(adapter.detect({ type: 'object' })).toBe(false);
    expect(adapter.detect({ _def: {}, safeParse: () => null })).toBe(false);
  });

  it('throws when asked to convert a non-Zod value', () => {
    expect(() => adapter.extractJsonSchema({ type: 'object' })).toThrow(/not a Zod schema/);
  });
});

describe('ZodAdapter — Zod 4', () => {
  it('converts an object with required and optional properties', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().int().min(0).optional(),
    });

    expect(adapter.extractJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer', minimum: 0 },
      },
      required: ['name'],
    });
  });

  it('carries .describe() through', () => {
    expect(adapter.extractJsonSchema(z.string().describe('a name'))).toEqual({
      type: 'string',
      description: 'a name',
    });
  });

  it('maps string constraints and formats', () => {
    expect(adapter.extractJsonSchema(z.string().min(2).max(5))).toEqual({
      type: 'string',
      minLength: 2,
      maxLength: 5,
    });
    expect(adapter.extractJsonSchema(z.email())).toMatchObject({
      type: 'string',
      format: 'email',
    });
  });

  it('maps exclusive numeric bounds and multipleOf', () => {
    expect(adapter.extractJsonSchema(z.number().gt(1).lt(9).multipleOf(3))).toEqual({
      type: 'number',
      exclusiveMinimum: 1,
      exclusiveMaximum: 9,
      multipleOf: 3,
    });
  });

  it('handles arrays, enums, and literals', () => {
    expect(adapter.extractJsonSchema(z.array(z.string()))).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
    expect(adapter.extractJsonSchema(z.enum(['a', 'b']))).toEqual({
      type: 'string',
      enum: ['a', 'b'],
    });
    expect(adapter.extractJsonSchema(z.literal(5))).toEqual({ type: 'number', const: 5 });
  });

  it('handles nullable, default, union, and record', () => {
    expect(adapter.extractJsonSchema(z.string().nullable())).toEqual({
      type: 'string',
      nullable: true,
    });
    expect(adapter.extractJsonSchema(z.string().default('x'))).toEqual({
      type: 'string',
      default: 'x',
    });
    expect(adapter.extractJsonSchema(z.union([z.string(), z.number()]))).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }],
    });
    expect(adapter.extractJsonSchema(z.record(z.string(), z.number()))).toEqual({
      type: 'object',
      additionalProperties: { type: 'number' },
    });
  });

  it('treats a defaulted property as optional', () => {
    const schema = z.object({ page: z.number().default(1), q: z.string() });
    expect(adapter.extractJsonSchema(schema)).toMatchObject({ required: ['q'] });
  });

  it('reads through a transform pipe to the input schema', () => {
    const schema = z.string().transform((value) => value.length);
    expect(adapter.extractJsonSchema(schema)).toEqual({ type: 'string' });
  });

  it('maps booleans, dates, bigints, and null', () => {
    expect(adapter.extractJsonSchema(z.boolean())).toEqual({ type: 'boolean' });
    expect(adapter.extractJsonSchema(z.date())).toEqual({
      type: 'string',
      format: 'date-time',
    });
    expect(adapter.extractJsonSchema(z.bigint())).toEqual({ type: 'integer' });
    expect(adapter.extractJsonSchema(z.null())).toEqual({ type: 'null' });
  });

  it('falls back to an empty schema for unmodelled types', () => {
    expect(adapter.extractJsonSchema(z.any())).toEqual({});
  });

  it('extract() produces the same shape as extractJsonSchema()', () => {
    const schema = z.object({ a: z.string() });
    expect(adapter.extract(schema)).toEqual(adapter.extractJsonSchema(schema));
  });
});

describe('ZodAdapter — Zod 3', () => {
  it('converts objects, marking optionals', () => {
    const schema = v3({
      typeName: 'ZodObject',
      shape: () => ({
        name: v3({ typeName: 'ZodString' }),
        age: v3({ typeName: 'ZodOptional', innerType: v3({ typeName: 'ZodNumber' }) }),
      }),
    });

    expect(adapter.extractJsonSchema(schema)).toEqual({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
      required: ['name'],
    });
  });

  it('maps int / min / max number checks', () => {
    const schema = v3({
      typeName: 'ZodNumber',
      checks: [{ kind: 'int' }, { kind: 'min', value: 1 }, { kind: 'max', value: 9 }],
    });
    expect(adapter.extractJsonSchema(schema)).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 9,
    });
  });

  it('handles arrays, enums, literals, unions, and records', () => {
    expect(
      adapter.extractJsonSchema(v3({ typeName: 'ZodArray', type: v3({ typeName: 'ZodString' }) })),
    ).toEqual({ type: 'array', items: { type: 'string' } });

    expect(adapter.extractJsonSchema(v3({ typeName: 'ZodEnum', values: ['a', 'b'] }))).toEqual({
      type: 'string',
      enum: ['a', 'b'],
    });

    expect(adapter.extractJsonSchema(v3({ typeName: 'ZodLiteral', value: 'x' }))).toEqual({
      type: 'string',
      const: 'x',
    });

    expect(
      adapter.extractJsonSchema(
        v3({
          typeName: 'ZodUnion',
          options: [v3({ typeName: 'ZodString' }), v3({ typeName: 'ZodBoolean' })],
        }),
      ),
    ).toEqual({ anyOf: [{ type: 'string' }, { type: 'boolean' }] });

    expect(
      adapter.extractJsonSchema(
        v3({ typeName: 'ZodRecord', valueType: v3({ typeName: 'ZodNumber' }) }),
      ),
    ).toEqual({ type: 'object', additionalProperties: { type: 'number' } });
  });

  it('unwraps nullable, default, and effects', () => {
    expect(
      adapter.extractJsonSchema(
        v3({ typeName: 'ZodNullable', innerType: v3({ typeName: 'ZodString' }) }),
      ),
    ).toEqual({ type: 'string', nullable: true });

    expect(
      adapter.extractJsonSchema(
        v3({
          typeName: 'ZodDefault',
          innerType: v3({ typeName: 'ZodString' }),
          defaultValue: () => 'x',
        }),
      ),
    ).toEqual({ type: 'string', default: 'x' });

    expect(
      adapter.extractJsonSchema(
        v3({ typeName: 'ZodEffects', schema: v3({ typeName: 'ZodBoolean' }) }),
      ),
    ).toEqual({ type: 'boolean' });
  });

  it('keeps only the forward entries of a numeric native enum', () => {
    const schema = v3({ typeName: 'ZodNativeEnum', values: { 0: 'Red', 1: 'Green', Red: 0, Green: 1 } });
    expect(adapter.extractJsonSchema(schema)).toEqual({ type: 'number', enum: [0, 1] });
  });

  it('keeps string native enum values as-is', () => {
    const schema = v3({ typeName: 'ZodNativeEnum', values: { Red: 'red', Green: 'green' } });
    expect(adapter.extractJsonSchema(schema)).toEqual({
      type: 'string',
      enum: ['red', 'green'],
    });
  });

  it('omits "type" for a mixed enum', () => {
    const schema = v3({ typeName: 'ZodNativeEnum', values: { A: 0, B: 'b' } });
    expect(adapter.extractJsonSchema(schema)).toEqual({ enum: [0, 'b'] });
  });

  it('reads a description off the def', () => {
    expect(
      adapter.extractJsonSchema(v3({ typeName: 'ZodString', description: 'hi' })),
    ).toEqual({ type: 'string', description: 'hi' });
  });

  it('returns an empty schema for an object with no shape', () => {
    expect(adapter.extractJsonSchema(v3({ typeName: 'ZodObject' }))).toEqual({ type: 'object' });
  });

  it('falls back to an empty schema for unknown type names', () => {
    expect(adapter.extractJsonSchema(v3({ typeName: 'ZodMystery' }))).toEqual({});
  });
});
