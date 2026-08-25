import { beforeEach, describe, expect, it } from 'vitest';
import { Registry } from 'apcore-js';
import { ApcoreRegistry } from '../../src/core/registry.js';

class TodoService {
  private items = [{ id: 1, title: 'first' }];

  list(): Record<string, unknown> {
    return { todos: this.items };
  }

  add(inputs: Record<string, unknown>): Record<string, unknown> {
    const todo = { id: this.items.length + 1, title: String(inputs.title) };
    this.items.push(todo);
    return { todo };
  }

  secret(): string {
    return 'nope';
  }
}

let registry: ApcoreRegistry;

beforeEach(() => {
  registry = new ApcoreRegistry(new Registry());
});

describe('ApcoreRegistry delegation', () => {
  it('exposes the raw registry', () => {
    expect(registry.raw).toBeInstanceOf(Registry);
  });

  it('registers, lists, reads, and unregisters', async () => {
    await registry.registerTool({
      id: 'demo.ping',
      description: 'Ping',
      tags: ['demo'],
      handler: () => ({ pong: true }),
    });

    expect(registry.count).toBe(1);
    expect(registry.has('demo.ping')).toBe(true);
    expect(registry.list()).toEqual(['demo.ping']);
    expect(registry.list({ tags: ['demo'] })).toEqual(['demo.ping']);
    expect(registry.list({ prefix: 'other' })).toEqual([]);
    expect(registry.get('demo.ping')).not.toBeNull();
    expect(registry.getDefinition('demo.ping')?.description).toBe('Ping');

    expect(registry.unregister('demo.ping')).toBe(true);
    expect(registry.has('demo.ping')).toBe(false);
  });

  it('forwards registration events', async () => {
    const seen: string[] = [];
    registry.on('register', (moduleId) => seen.push(moduleId));

    await registry.registerTool({ id: 'demo.ping', description: 'Ping', handler: () => ({}) });
    expect(seen).toContain('demo.ping');
  });

  it('delegates discover(), surfacing the upstream error for a missing directory', async () => {
    await expect(registry.discover()).rejects.toThrow(/Configuration file not found/);
  });
});

describe('ApcoreRegistry serialisation', () => {
  it('converts a registered module to a ScannedModule', async () => {
    await registry.registerTool({
      id: 'demo.ping',
      description: 'Ping',
      tags: ['demo'],
      handler: () => ({}),
    });

    const scanned = registry.toScannedModule('demo.ping');
    expect(scanned?.moduleId).toBe('demo.ping');
    expect(scanned?.tags).toEqual(['demo']);
  });

  it('returns null for an unknown module', () => {
    expect(registry.toScannedModule('nope')).toBeNull();
    expect(registry.toDict('nope')).toBeNull();
  });

  it('serialises one module and all modules to snake_case dicts', async () => {
    await registry.registerTool({ id: 'demo.a', description: 'A', handler: () => ({}) });
    await registry.registerTool({ id: 'demo.b', description: 'B', handler: () => ({}) });

    expect(registry.toDict('demo.a')).toMatchObject({ module_id: 'demo.a' });
    expect(registry.toDicts().map((d) => d.module_id)).toEqual(['demo.a', 'demo.b']);
    expect(registry.toDicts({ prefix: 'demo.a' }).map((d) => d.module_id)).toEqual(['demo.a']);
  });
});

describe('ApcoreRegistry tool registration', () => {
  it('registers several tools in order', async () => {
    const ids = await registry.registerTools([
      { id: 'demo.a', description: 'A', handler: () => ({}) },
      { id: 'demo.b', description: 'B', handler: () => ({}) },
    ]);
    expect(ids).toEqual(['demo.a', 'demo.b']);
  });

  it('applies a module prefix', async () => {
    const id = await registry.registerTool(
      { namespace: 'todo', name: 'list', description: 'd', handler: () => ({}) },
      { modulePrefix: 'svc' },
    );
    expect(id).toBe('svc.todo.list');
  });
});

describe('ApcoreRegistry.registerMethod', () => {
  it('derives the module ID from the class and method names', async () => {
    const id = await registry.registerMethod({
      instance: new TodoService(),
      method: 'list',
      description: 'List todos',
    });
    expect(id).toBe('todo.list');
  });

  it('honours an explicit id', async () => {
    const id = await registry.registerMethod({
      instance: new TodoService(),
      method: 'list',
      description: 'List todos',
      id: 'custom.list',
    });
    expect(id).toBe('custom.list');
  });

  it('binds the method to its instance', async () => {
    const service = new TodoService();
    await registry.registerMethod({ instance: service, method: 'list', description: 'd' });

    const module = registry.get('todo.list') as { execute: (i: unknown, c: unknown) => unknown };
    await expect(module.execute({}, null)).resolves.toEqual({ todos: [{ id: 1, title: 'first' }] });
  });

  it('rejects a method that does not exist', async () => {
    await expect(
      registry.registerMethod({ instance: new TodoService(), method: 'missing', description: 'd' }),
    ).rejects.toThrow(/does not exist on TodoService/);
  });
});

describe('ApcoreRegistry.registerObject', () => {
  it('registers a named subset', async () => {
    const ids = await registry.registerObject({
      instance: new TodoService(),
      methods: ['list', 'add'],
      description: 'Todo operations',
    });
    expect(ids).toEqual(['todo.list', 'todo.add']);
  });

  it('discovers every prototype method with "*"', async () => {
    const ids = await registry.registerObject({ instance: new TodoService(), methods: '*' });
    expect(ids.sort()).toEqual(['todo.add', 'todo.list', 'todo.secret']);
  });

  it('honours the exclude list', async () => {
    const ids = await registry.registerObject({
      instance: new TodoService(),
      methods: '*',
      exclude: ['secret'],
    });
    expect(ids.sort()).toEqual(['todo.add', 'todo.list']);
  });

  it('registers the methods of a plain object literal', async () => {
    const ids = await registry.registerObject({
      instance: { ping: () => ({ pong: true }), value: 1 },
      methods: '*',
      namespace: 'demo',
    });
    expect(ids).toEqual(['demo.ping']);
  });

  it('applies per-method options', async () => {
    const ids = await registry.registerObject({
      instance: new TodoService(),
      methods: ['list'],
      description: 'shared',
      tags: ['todo'],
      methodOptions: { list: { id: 'todo.all', description: 'All todos' } },
    });

    expect(ids).toEqual(['todo.all']);
    expect(registry.getDefinition('todo.all')?.description).toBe('All todos');
    expect(registry.getDefinition('todo.all')?.tags).toEqual(['todo']);
  });

  it('falls back to the method name when nothing describes it', async () => {
    await registry.registerObject({ instance: new TodoService(), methods: ['list'] });
    expect(registry.getDefinition('todo.list')?.description).toBe('list');
  });
});
