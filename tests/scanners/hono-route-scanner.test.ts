import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { HonoRouteScanner, buildRequestUrl } from '../../src/scanners/hono-route-scanner.js';
import { HonoContextFactory } from '../../src/context/hono-context.factory.js';

const scanner = new HonoRouteScanner();

function buildApp(): Hono {
  const app = new Hono();
  app.use('*', async (_c, next) => next());
  app.get('/todos', (c) => c.json({ todos: [{ id: 1 }], q: c.req.query('q') ?? null }));
  app.get('/todos/:id', (c) => c.json({ id: Number(c.req.param('id')) }));
  app.post('/todos', async (c) => c.json({ created: await c.req.json() }, 201));
  app.delete('/todos/:id', (c) => c.json({ deleted: c.req.param('id') }));
  app.get('/internal/debug', (c) => c.json({ ok: true }));
  return app;
}

describe('HonoRouteScanner metadata', () => {
  it('names the source', () => {
    expect(scanner.getSourceName()).toBe('hono-routes');
  });

  it('derives module IDs from the route table', () => {
    const ids = scanner.scan(buildApp()).map((m) => m.moduleId);
    expect(ids).toEqual([
      'todos.list',
      'todos.get',
      'todos.create',
      'todos.delete',
      'internal.debug.list',
    ]);
  });

  it('skips middleware registered with app.use()', () => {
    expect(scanner.scan(buildApp()).some((m) => m.target.startsWith('ALL '))).toBe(false);
  });

  it('infers annotations from the HTTP method', () => {
    const modules = scanner.scan(buildApp());
    const byId = Object.fromEntries(modules.map((m) => [m.moduleId, m]));

    expect(byId['todos.list'].annotations).toMatchObject({ readonly: true, cacheable: true });
    expect(byId['todos.delete'].annotations).toMatchObject({ destructive: true });
    expect(byId['todos.create'].annotations).toMatchObject({ readonly: false });
  });

  it('builds a path-parameter input schema for parameterised routes', () => {
    const module = scanner.scan(buildApp()).find((m) => m.moduleId === 'todos.get')!;
    expect(module.inputSchema).toMatchObject({
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    });
    expect(module.inputSchema.properties).toHaveProperty('query');
  });

  it('offers a body property for body-carrying methods', () => {
    const module = scanner.scan(buildApp()).find((m) => m.moduleId === 'todos.create')!;
    expect(module.inputSchema.properties).toHaveProperty('body');
    expect(module.inputSchema.properties).not.toHaveProperty('query');
  });

  it('records the route on the module', () => {
    const module = scanner.scan(buildApp()).find((m) => m.moduleId === 'todos.get')!;
    expect(module.target).toBe('GET /todos/:id');
    expect(module.metadata).toEqual({ http_method: 'GET', http_path: '/todos/:id' });
    expect(module.suggestedAlias).toBe('todos.get');
    expect(module.tags).toEqual(['http']);
  });
});

describe('HonoRouteScanner filtering', () => {
  it('applies includePaths', () => {
    const ids = scanner.scan(buildApp(), { includePaths: ['/todos*'] }).map((m) => m.moduleId);
    expect(ids).not.toContain('internal.debug.list');
    expect(ids).toContain('todos.list');
  });

  it('applies excludePaths', () => {
    const ids = scanner.scan(buildApp(), { excludePaths: ['/internal/*'] }).map((m) => m.moduleId);
    expect(ids).not.toContain('internal.debug.list');
  });

  it('applies include / exclude regexes to module IDs', () => {
    expect(scanner.scan(buildApp(), { include: '^todos\\.' }).every((m) => m.moduleId.startsWith('todos.'))).toBe(true);
    expect(scanner.scan(buildApp(), { exclude: 'delete' }).map((m) => m.moduleId)).not.toContain(
      'todos.delete',
    );
  });

  it('excludes HEAD and OPTIONS by default and honours excludeMethods', () => {
    const app = new Hono();
    app.on('OPTIONS', '/todos', (c) => c.body(null, 204));
    app.get('/todos', (c) => c.json({}));

    expect(scanner.scan(app)).toHaveLength(1);
    expect(scanner.scan(app, { excludeMethods: ['GET'] })).toHaveLength(1);
    expect(scanner.scan(app, { excludeMethods: [] })).toHaveLength(2);
  });

  it('applies a module prefix and extra tags', () => {
    const modules = scanner.scan(buildApp(), { modulePrefix: 'svc', tags: ['api'] });
    expect(modules[0].moduleId).toBe('svc.todos.list');
    expect(modules[0].tags).toEqual(['api']);
  });

  it('deduplicates colliding module IDs', () => {
    const app = new Hono();
    app.get('/todos', (c) => c.json({}));
    app.get('/todos/', (c) => c.json({}));

    const ids = scanner.scan(app).map((m) => m.moduleId);
    expect(ids).toEqual(['todos.list', 'todos.list_2']);
  });

  it('collapses several handlers on one route into one module', () => {
    const app = new Hono();
    app.get('/todos', async (_c, next) => next());
    app.get('/todos', (c) => c.json({}));

    expect(scanner.scan(app)).toHaveLength(1);
  });
});

describe('HonoRouteScanner overrides', () => {
  it('replaces the id, description, tags, and schemas', () => {
    const modules = scanner.scan(buildApp(), {
      overrides: {
        'GET /todos': {
          id: 'todo.all',
          description: 'Every todo',
          tags: ['todo'],
          inputSchema: { type: 'object', properties: { done: { type: 'boolean' } } },
          outputSchema: { type: 'object', properties: { todos: { type: 'array' } } },
          annotations: { readonly: true, idempotent: true },
          documentation: 'Long form',
        },
      },
    });

    const module = modules.find((m) => m.moduleId === 'todo.all')!;
    expect(module.description).toBe('Every todo');
    expect(module.tags).toEqual(['http', 'todo']);
    expect(module.inputSchema.properties).toHaveProperty('done');
    expect(module.documentation).toBe('Long form');
    expect(module.annotations).toMatchObject({ idempotent: true });
  });

  it('skips a route on request', () => {
    const ids = scanner
      .scan(buildApp(), { overrides: { 'DELETE /todos/:id': { skip: true } } })
      .map((m) => m.moduleId);
    expect(ids).not.toContain('todos.delete');
  });
});

describe('HonoRouteScanner execution', () => {
  it('replays a GET route in-process', async () => {
    const app = buildApp();
    const entry = scanner
      .scanWithExecutors(app)
      .find((e) => e.module.moduleId === 'todos.list')!;

    await expect(entry.execute({}, null)).resolves.toEqual({ todos: [{ id: 1 }], q: null });
  });

  it('substitutes path parameters', async () => {
    const app = buildApp();
    const entry = scanner.scanWithExecutors(app).find((e) => e.module.moduleId === 'todos.get')!;
    await expect(entry.execute({ id: '7' }, null)).resolves.toEqual({ id: 7 });
  });

  it('forwards query parameters', async () => {
    const app = buildApp();
    const entry = scanner.scanWithExecutors(app).find((e) => e.module.moduleId === 'todos.list')!;
    await expect(entry.execute({ query: { q: 'milk' } }, null)).resolves.toMatchObject({
      q: 'milk',
    });
  });

  it('sends a JSON body for POST', async () => {
    const app = buildApp();
    const entry = scanner.scanWithExecutors(app).find((e) => e.module.moduleId === 'todos.create')!;
    await expect(entry.execute({ body: { title: 'milk' } }, null)).resolves.toEqual({
      created: { title: 'milk' },
    });
  });

  it('propagates identity and trace headers from the apcore Context', async () => {
    const app = new Hono();
    app.get('/whoami', (c) =>
      c.json({
        user: c.req.header('x-user-id') ?? null,
        roles: c.req.header('x-roles') ?? null,
        traced: c.req.header('traceparent') !== undefined,
      }),
    );

    const context = new HonoContextFactory().createContext(
      new Headers({ 'x-user-id': 'alice', 'x-roles': 'admin,ops' }),
    );
    const entry = scanner.scanWithExecutors(app)[0];

    await expect(entry.execute({}, context)).resolves.toEqual({
      user: 'alice',
      roles: 'admin,ops',
      traced: true,
    });
  });

  it('works without a context', async () => {
    const app = new Hono();
    app.get('/whoami', (c) => c.json({ user: c.req.header('x-user-id') ?? null }));
    const entry = scanner.scanWithExecutors(app)[0];
    await expect(entry.execute({}, undefined)).resolves.toEqual({ user: null });
  });

  it('wraps a non-object JSON response under "result"', async () => {
    const app = new Hono();
    app.get('/count', (c) => c.json(42));
    const entry = scanner.scanWithExecutors(app)[0];
    await expect(entry.execute({}, null)).resolves.toEqual({ result: 42 });
  });

  it('returns text responses under "result"', async () => {
    const app = new Hono();
    app.get('/ping', (c) => c.text('pong'));
    const entry = scanner.scanWithExecutors(app)[0];
    await expect(entry.execute({}, null)).resolves.toEqual({ result: 'pong' });
  });

  it('raises ModuleExecuteError for a non-2xx response', async () => {
    const app = new Hono();
    app.get('/boom', (c) => c.json({ error: 'nope' }, 500));
    const entry = scanner.scanWithExecutors(app)[0];
    await expect(entry.execute({}, null)).rejects.toThrow(/responded 500/);
  });
});

describe('buildRequestUrl', () => {
  it('substitutes colon-style parameters', () => {
    expect(buildRequestUrl('/todos/:id', 'GET', { id: '7' }, 'http://localhost')).toBe(
      'http://localhost/todos/7',
    );
  });

  it('appends query parameters for non-body methods', () => {
    expect(
      buildRequestUrl('/todos', 'GET', { query: { q: 'a b', page: 2 } }, 'http://localhost'),
    ).toBe('http://localhost/todos?q=a+b&page=2');
  });

  it('ignores the query object for body methods', () => {
    expect(buildRequestUrl('/todos', 'POST', { query: { q: 'x' } }, 'http://localhost')).toBe(
      'http://localhost/todos',
    );
  });

  it('skips null and undefined query values', () => {
    expect(
      buildRequestUrl('/todos', 'GET', { query: { a: null, b: undefined, c: 1 } }, 'http://x'),
    ).toBe('http://x/todos?c=1');
  });

  it('ignores a non-object query input', () => {
    expect(buildRequestUrl('/todos', 'GET', { query: 'nope' }, 'http://x')).toBe('http://x/todos');
  });
});
