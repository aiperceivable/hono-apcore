import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context as ApcoreContext, DEFAULT_ANNOTATIONS } from 'apcore-js';
import { cloneModule, createScannedModule, DisplayResolver } from 'apcore-toolkit';
import {
  EMPTY_OBJECT_SCHEMA,
  normalizeResult,
  scannedModuleToFunctionModule,
  toModuleAnnotations,
} from '../../src/utils/module-factory.js';

afterEach(() => { vi.restoreAllMocks(); });

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

  it.each([
    { display: {} },
    { display: { alias: 'friendly', description: 'Override', guidance: 'Guide', documentation: 'Docs' } },
    { display: { tags: ['valid', 1, null], cli: { alias: 'run' }, mcp: { description: 'MCP' }, a2a: { guidance: 'A2A' } } },
    { display: { alias: '9 hello.world' } },
    { display: { alias: 'fallback', cli: { alias: 'INVALID ALIAS' } } },
    { display: { alias: '', description: false, documentation: [], guidance: '', tags: 'invalid', cli: 'invalid' } },
    { display: {}, suggestedAlias: 'suggested', metadata: { suggested_alias: 'legacy' } },
    { display: {}, metadata: { suggested_alias: 'legacy' } },
    { display: { mcp: { alias: 'a'.repeat(64) } } },
  ])('matches SDK in-memory display semantics: %j', (options) => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scanned = cloneModule(base(), options);
    const expected = new DisplayResolver().resolve([scanned], {
      bindingData: { [scanned.moduleId]: { display: scanned.display } },
    })[0]!.metadata.display;
    const actual = scannedModuleToFunctionModule(scanned, () => ({}));
    expect(actual.metadata?.display).toEqual(expected);
    expect(actual.display).toEqual(scanned.display);
  });

  it('does not emit stdout diagnostics or change console methods during display resolution', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    scannedModuleToFunctionModule(cloneModule(base(), {
      display: { alias: '9 hello.world' },
    }), () => ({}));
    expect(console.info).toBe(info);
    expect(console.debug).toBe(debug);
    expect(info).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });

  it('retains the MCP alias length limit', () => {
    expect(() => scannedModuleToFunctionModule(cloneModule(base(), {
      display: { mcp: { alias: 'a'.repeat(65) } },
    }), () => ({}))).toThrow(/64-character hard limit/);
  });
});
