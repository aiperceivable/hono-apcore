import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { JsonSchemaAdapter } from '../../src/schema/adapters/json-schema.adapter.js';

const adapter = new JsonSchemaAdapter();

describe('JsonSchemaAdapter', () => {
  it('detects objects carrying a JSON Schema keyword', () => {
    expect(adapter.detect({ type: 'object' })).toBe(true);
    expect(adapter.detect({ properties: {} })).toBe(true);
    expect(adapter.detect({ anyOf: [] })).toBe(true);
    expect(adapter.detect({ oneOf: [] })).toBe(true);
    expect(adapter.detect({ $ref: '#/defs/A' })).toBe(true);
  });

  it('rejects non-schema values', () => {
    expect(adapter.detect(null)).toBe(false);
    expect(adapter.detect([])).toBe(false);
    expect(adapter.detect('x')).toBe(false);
    expect(adapter.detect({ nothing: true })).toBe(false);
  });

  it('leaves TypeBox schemas to the TypeBox adapter', () => {
    expect(adapter.detect(Type.Object({}))).toBe(false);
  });

  it('deep-clones rather than aliasing the input', () => {
    const input = { type: 'object', properties: { a: { type: 'string' } } };
    const clone = adapter.extractJsonSchema(input);
    expect(clone).toEqual(input);
    expect(clone).not.toBe(input);
    expect(adapter.extract(input)).not.toBe(input);
  });
});
