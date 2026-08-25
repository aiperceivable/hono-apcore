import { describe, expect, it } from 'vitest';
import { Type } from '@sinclair/typebox';
import { z } from 'zod';
import {
  defineTool,
  defineToolset,
  resolveToolId,
  toolToScannedModule,
} from '../../src/tools/define-tool.js';

describe('defineTool', () => {
  it('returns the definition unchanged', () => {
    const definition = { namespace: 'a', name: 'b', description: 'd', handler: () => ({}) };
    expect(defineTool(definition)).toBe(definition);
  });
});

describe('defineToolset', () => {
  it('applies the namespace, shared tags, and annotations', () => {
    const tools = defineToolset({
      namespace: 'todo',
      tags: ['todo'],
      annotations: { readonly: true },
      tools: {
        list: { description: 'List todos', handler: () => ({}) },
        add: { description: 'Add a todo', handler: () => ({}), tags: ['mutate'] },
      },
    });

    expect(tools.map((t) => resolveToolId(t))).toEqual(['todo.list', 'todo.add']);
    expect(tools[0].tags).toEqual(['todo']);
    expect(tools[0].annotations).toEqual({ readonly: true });
    expect(tools[1].tags).toEqual(['mutate']);
  });

  it('lets an entry override its derived name', () => {
    const [tool] = defineToolset({
      namespace: 'todo',
      tools: { list: { name: 'list_all', description: 'd', handler: () => ({}) } },
    });
    expect(resolveToolId(tool)).toBe('todo.list_all');
  });

  it('falls back to the toolset description, then the key', () => {
    const tools = defineToolset({
      namespace: 'todo',
      description: 'shared',
      tools: {
        a: { handler: () => ({}) },
        b: { description: 'own', handler: () => ({}) },
      },
    });
    expect(tools[0].description).toBe('shared');
    expect(tools[1].description).toBe('own');
  });

  it('falls back to the record key when nothing else describes the tool', () => {
    const [tool] = defineToolset({ namespace: 'todo', tools: { list: { handler: () => ({}) } } });
    expect(tool.description).toBe('list');
  });
});

describe('resolveToolId', () => {
  it('uses an explicit id verbatim', () => {
    expect(resolveToolId({ id: 'custom.id', description: 'd', handler: () => ({}) })).toBe(
      'custom.id',
    );
  });

  it('snake-cases the name', () => {
    expect(
      resolveToolId({ namespace: 'todo', name: 'listAll', description: 'd', handler: () => ({}) }),
    ).toBe('todo.list_all');
  });

  it('falls back to the handler function name', () => {
    function listTodos() {
      return {};
    }
    expect(resolveToolId({ namespace: 'todo', description: 'd', handler: listTodos })).toBe(
      'todo.list_todos',
    );
  });

  it('applies a module prefix', () => {
    expect(
      resolveToolId({ namespace: 'todo', name: 'list', description: 'd', handler: () => ({}) }, 'svc'),
    ).toBe('svc.todo.list');
    expect(resolveToolId({ id: 'todo.list', description: 'd', handler: () => ({}) }, 'svc')).toBe(
      'svc.todo.list',
    );
  });

  it('throws when no name can be derived', () => {
    expect(() => resolveToolId({ description: 'd', handler: () => ({}) })).toThrow(
      /needs an "id", a "name", or a named handler/,
    );
  });
});

describe('toolToScannedModule', () => {
  it('converts TypeBox schemas and defaults the missing ones', () => {
    const { module } = toolToScannedModule({
      namespace: 'todo',
      name: 'list',
      description: 'List todos',
      inputSchema: Type.Object({ done: Type.Optional(Type.Boolean()) }),
      tags: ['todo'],
      annotations: { readonly: true },
      handler: () => ({}),
    });

    expect(module.moduleId).toBe('todo.list');
    expect(module.inputSchema).toEqual({
      type: 'object',
      properties: { done: { type: 'boolean' } },
    });
    expect(module.outputSchema).toEqual({ type: 'object', properties: {} });
    expect(module.tags).toEqual(['todo']);
    expect(module.annotations?.readonly).toBe(true);
  });

  it('converts Zod schemas', () => {
    const { module } = toolToScannedModule({
      id: 'todo.add',
      description: 'Add a todo',
      inputSchema: z.object({ title: z.string() }),
      handler: () => ({}),
    });
    expect(module.inputSchema).toEqual({
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    });
  });

  it('merges extra tags without duplicating', () => {
    const { module } = toolToScannedModule(
      { id: 'a.b', description: 'd', tags: ['x'], handler: () => ({}) },
      { tags: ['x', 'y'] },
    );
    expect(module.tags).toEqual(['x', 'y']);
  });

  it('merges the params field into the input schema descriptions', () => {
    const { module } = toolToScannedModule({
      id: 'demo.doc',
      description: 'Short',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      params: { city: 'The city to look up' },
      handler: () => ({}),
    });

    expect(
      (module.inputSchema.properties as Record<string, { description?: string }>).city.description,
    ).toBe('The city to look up');
  });

  it('carries the documentation field through', () => {
    const { module } = toolToScannedModule({
      id: 'demo.doc2',
      description: 'Short',
      documentation: 'The long form.',
      handler: () => ({}),
    });
    expect(module.documentation).toBe('The long form.');
  });

  it('leaves the schema alone when params is empty', () => {
    const { module } = toolToScannedModule({
      id: 'demo.doc3',
      description: 'Short',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      params: {},
      handler: () => ({}),
    });
    expect(module.inputSchema).toEqual({
      type: 'object',
      properties: { city: { type: 'string' } },
    });
  });

  it('reports which schema failed to convert', () => {
    expect(() =>
      toolToScannedModule({
        id: 'demo.bad',
        description: 'd',
        inputSchema: 42,
        handler: () => ({}),
      }),
    ).toThrow(/Failed to extract inputSchema for tool "demo.bad"/);

    expect(() =>
      toolToScannedModule({
        id: 'demo.bad',
        description: 'd',
        outputSchema: 42,
        handler: () => ({}),
      }),
    ).toThrow(/Failed to extract outputSchema for tool "demo.bad"/);
  });

  it('normalises the handler result and forwards the context', async () => {
    const seen: unknown[] = [];
    const { execute } = toolToScannedModule({
      id: 'demo.echo',
      description: 'd',
      handler: (inputs, context) => {
        seen.push(context);
        return inputs.value;
      },
    });

    await expect(execute({ value: 'hi' }, { marker: true })).resolves.toEqual({ result: 'hi' });
    expect(seen).toEqual([{ marker: true }]);
  });
});
