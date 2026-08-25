import { describe, expect, it } from 'vitest';
import { Context as ApcoreContext, DEFAULT_ANNOTATIONS } from 'apcore-js';
import { createScannedModule } from 'apcore-toolkit';
import {
  EMPTY_OBJECT_SCHEMA,
  normalizeResult,
  scannedModuleToFunctionModule,
  toModuleAnnotations,
} from '../../src/utils/module-factory.js';

describe('normalizeResult', () => {
  it('turns nullish results into an empty object', () => {
    expect(normalizeResult(null)).toEqual({});
    expect(normalizeResult(undefined)).toEqual({});
  });

  it('passes plain objects through', () => {
    const value = { a: 1 };
    expect(normalizeResult(value)).toBe(value);
  });

  it('wraps arrays and primitives under "result"', () => {
    expect(normalizeResult([1, 2])).toEqual({ result: [1, 2] });
    expect(normalizeResult('hi')).toEqual({ result: 'hi' });
    expect(normalizeResult(0)).toEqual({ result: 0 });
  });
});

describe('toModuleAnnotations', () => {
  it('returns null for nullish input', () => {
    expect(toModuleAnnotations(null)).toBeNull();
    expect(toModuleAnnotations(undefined)).toBeNull();
  });

  it('spreads partial flags over the defaults', () => {
    const annotations = toModuleAnnotations({ readonly: true });
    expect(annotations).toEqual({ ...DEFAULT_ANNOTATIONS, readonly: true });
  });
});

describe('scannedModuleToFunctionModule', () => {
  const base = () =>
    createScannedModule({
      moduleId: 'demo.echo',
      description: 'Echo the input',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
      outputSchema: { ...EMPTY_OBJECT_SCHEMA },
      tags: ['demo'],
      target: 'demo.echo',
      annotations: toModuleAnnotations({ readonly: true }),
      metadata: { source: 'test', _internal: 'hidden' },
    });

  it('carries the descriptor fields across', () => {
    const module = scannedModuleToFunctionModule(base(), async (inputs) => inputs);
    expect(module.moduleId).toBe('demo.echo');
    expect(module.description).toBe('Echo the input');
    expect(module.tags).toEqual(['demo']);
  });

  it('strips underscore-prefixed metadata keys', () => {
    const module = scannedModuleToFunctionModule(base(), async () => ({}));
    expect(module.metadata).toEqual({ source: 'test' });
  });

  it('runs the bound execute function', async () => {
    const module = scannedModuleToFunctionModule(base(), async (inputs) => ({
      echoed: inputs.value,
    }));
    await expect(module.execute({ value: 'hi' }, ApcoreContext.create())).resolves.toEqual({
      echoed: 'hi',
    });
  });
});
