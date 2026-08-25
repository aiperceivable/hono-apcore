import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { z } from 'zod';
import {
  SchemaExtractionError,
  SchemaExtractor,
  defaultSchemaExtractor,
} from '../../src/schema/schema-extractor.js';
import type { SchemaAdapter } from '../../src/schema/adapters/schema-adapter.interface.js';

describe('SchemaExtractor', () => {
  const extractor = new SchemaExtractor();

  it('orders the built-in adapters by descending priority', () => {
    expect(extractor.adapterNames).toEqual(['typebox', 'zod', 'json-schema']);
  });

  it('detects each supported dialect', () => {
    expect(extractor.detect(Type.Object({}))).toBe('typebox');
    expect(extractor.detect(z.string())).toBe('zod');
    expect(extractor.detect({ type: 'string' })).toBe('json-schema');
    expect(extractor.detect(42)).toBeNull();
  });

  it('extracts JSON Schema from every dialect', () => {
    expect(extractor.extractJsonSchema(Type.String())).toEqual({ type: 'string' });
    expect(extractor.extractJsonSchema(z.string())).toEqual({ type: 'string' });
    expect(extractor.extractJsonSchema({ type: 'string' })).toEqual({ type: 'string' });
  });

  it('extracts a TSchema from every dialect', () => {
    expect(extractor.extract(Type.String())).toMatchObject({ type: 'string' });
    expect(extractor.extract(z.string())).toMatchObject({ type: 'string' });
    expect(extractor.extract({ type: 'string' })).toMatchObject({ type: 'string' });
  });

  it('throws SchemaExtractionError when nothing matches', () => {
    expect(() => extractor.extract(42)).toThrow(SchemaExtractionError);
    expect(() => extractor.extractJsonSchema(42)).toThrow(SchemaExtractionError);
    expect(() => extractor.extractJsonSchema(42)).toThrow(/No adapter matched/);
  });

  it('keeps SchemaExtractionError instanceof-checkable', () => {
    const error = new SchemaExtractionError('boom');
    expect(error).toBeInstanceOf(SchemaExtractionError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SchemaExtractionError');
  });

  it('inserts a registered adapter by priority', () => {
    const custom: SchemaAdapter = {
      name: 'custom',
      priority: 200,
      detect: (input) => input === 'custom',
      extract: () => ({ type: 'string' }) as never,
      extractJsonSchema: () => ({ type: 'string', title: 'custom' }),
    };

    const local = new SchemaExtractor();
    local.registerAdapter(custom);

    expect(local.adapterNames[0]).toBe('custom');
    expect(local.detect('custom')).toBe('custom');
    expect(local.extractJsonSchema('custom')).toEqual({ type: 'string', title: 'custom' });
  });

  it('accepts an explicit adapter list', () => {
    const local = new SchemaExtractor([
      {
        name: 'only',
        priority: 1,
        detect: () => true,
        extract: () => ({}) as never,
        extractJsonSchema: () => ({ ok: true }),
      },
    ]);
    expect(local.adapterNames).toEqual(['only']);
    expect(local.extractJsonSchema('anything')).toEqual({ ok: true });
  });

  it('exposes a shared default instance', () => {
    expect(defaultSchemaExtractor).toBeInstanceOf(SchemaExtractor);
    expect(defaultSchemaExtractor.detect(Type.String())).toBe('typebox');
  });
});
