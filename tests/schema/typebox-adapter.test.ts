import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { TypeBoxAdapter } from '../../src/schema/adapters/typebox.adapter.js';

const adapter = new TypeBoxAdapter();

describe('TypeBoxAdapter', () => {
  it('detects TypeBox schemas', () => {
    expect(adapter.detect(Type.Object({ a: Type.String() }))).toBe(true);
  });

  it('rejects everything else', () => {
    expect(adapter.detect(null)).toBe(false);
    expect(adapter.detect(undefined)).toBe(false);
    expect(adapter.detect('string')).toBe(false);
    expect(adapter.detect({ type: 'object' })).toBe(false);
  });

  it('returns the schema itself from extract(), symbols intact', () => {
    const schema = Type.Object({ a: Type.String() });
    expect(adapter.extract(schema)).toBe(schema);
    expect(Symbol.for('TypeBox.Kind') in adapter.extract(schema)).toBe(true);
  });

  it('drops the symbols in extractJsonSchema()', () => {
    const json = adapter.extractJsonSchema(Type.Object({ a: Type.String() }));
    expect(json).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    });
    expect(Symbol.for('TypeBox.Kind') in json).toBe(false);
  });
});
