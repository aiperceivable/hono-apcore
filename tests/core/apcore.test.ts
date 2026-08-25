import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { ACL, ACLDeniedError } from 'apcore-js';
import { HonoApcore, createApcore } from '../../src/core/apcore.js';
import { defineTool } from '../../src/tools/define-tool.js';

const serve = vi.fn(async (..._args: unknown[]) => undefined);
const asyncServe = vi.fn(async (..._args: unknown[]) => ({
  handler: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
}));
const toOpenaiTools = vi.fn((..._args: unknown[]) => [{ type: 'function' }]);
const a2aServe = vi.fn((..._args: unknown[]) => undefined);

vi.mock('apcore-mcp', () => ({
  serve: (...args: unknown[]) => serve(...args),
  asyncServe: (...args: unknown[]) => asyncServe(...args),
  toOpenaiTools: (...args: unknown[]) => toOpenaiTools(...args),
}));

vi.mock('apcore-a2a', () => ({
  serve: (...args: unknown[]) => a2aServe(...args),
  asyncServe: vi.fn(async () => ({})),
}));

const ping = defineTool({
  namespace: 'demo',
  name: 'ping',
  description: 'Ping',
  handler: () => ({ pong: true }),
});

function buildApp(): Hono {
  const app = new Hono();
  app.get('/todos', (c) => c.json({ todos: [] }));
  app.get('/admin/debug', (c) => c.json({ ok: true }));
  return app;
}

beforeEach(() => {
  serve.mockClear();
  asyncServe.mockClear();
  toOpenaiTools.mockClear();
  a2aServe.mockClear();
});

describe('createApcore', () => {
  it('builds a HonoApcore', () => {
    expect(createApcore()).toBeInstanceOf(HonoApcore);
  });

  it('leaves every optional surface null by default', () => {
    const ap = createApcore();
    expect(ap.mcp).toBeNull();
    expect(ap.cli).toBeNull();
    expect(ap.a2a).toBeNull();
  });

  it('creates the surfaces that were configured', () => {
    const ap = createApcore({ mcp: {}, cli: {}, a2a: {} });
    expect(ap.mcp).not.toBeNull();
    expect(ap.cli).not.toBeNull();
    expect(ap.a2a).not.toBeNull();
  });

  it('merges the APCORE_* settings with explicit overrides', () => {
    const ap = createApcore({ settings: { modulePrefix: 'svc', port: 1234 } });
    expect(ap.settings.modulePrefix).toBe('svc');
    expect(ap.settings.port).toBe(1234);
  });

  it('installs an ACL on the executor', async () => {
    const acl = new ACL(
      [
        {
          callers: ['*'],
          targets: ['demo.allowed'],
          effect: 'allow',
          description: 'Only demo.allowed is callable',
        },
      ],
      'deny',
    );
    const ap = createApcore({ acl, tools: [ping] });
    await ap.init();

    await expect(ap.executor.call('demo.ping', {})).rejects.toThrow(ACLDeniedError);
  });
});

describe('HonoApcore.init', () => {
  it('registers the configured tools', async () => {
    const ap = createApcore({ tools: [ping] });
    await ap.init();
    expect(ap.registry.list()).toEqual(['demo.ping']);
  });

  it('scans the routes of the app it is given', async () => {
    const ap = createApcore({ tools: [ping] });
    await ap.init(buildApp());
    expect(ap.registry.list().sort()).toEqual(['admin.debug.list', 'demo.ping', 'todos.list']);
  });

  it('applies the route options from the constructor', async () => {
    const ap = createApcore({ routes: { excludePaths: ['/admin/*'] } });
    await ap.init(buildApp());
    expect(ap.registry.list()).toEqual(['todos.list']);
  });

  it('exposes the merged route options it would scan with', () => {
    const ap = createApcore({
      routes: { excludePaths: ['/admin/*'], tags: ['api'] },
      settings: { modulePrefix: 'svc' },
    });

    expect(ap.routeOptions).toMatchObject({
      modulePrefix: 'svc',
      excludePaths: ['/admin/*'],
      tags: ['api'],
    });
  });

  it('lets per-call route options win', async () => {
    const ap = createApcore({ routes: { excludePaths: [] } });
    await ap.init(buildApp(), { excludePaths: ['/admin/*'] });
    expect(ap.registry.list()).toEqual(['todos.list']);
  });

  it('applies the module prefix from settings', async () => {
    const ap = createApcore({ tools: [ping], settings: { modulePrefix: 'svc' } });
    await ap.init(buildApp());
    expect(ap.registry.list()).toContain('svc.demo.ping');
    expect(ap.registry.list()).toContain('svc.todos.list');
  });

  it('is idempotent', async () => {
    const ap = createApcore({ tools: [ping] });
    await ap.init();
    await ap.init();
    expect(ap.registry.count).toBe(1);
  });

  it('does nothing when APCORE_ENABLED is false', async () => {
    const ap = createApcore({ tools: [ping], settings: { enabled: false } });
    await ap.init(buildApp());
    expect(ap.registry.count).toBe(0);
  });

  it('loads a YAML bindings file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hono-apcore-init-'));
    const file = join(dir, 'bindings.yaml');
    await writeFile(file, 'bindings:\n  - module_id: a.b\n    target: X.y\n    description: d\n');

    const ap = createApcore({ bindings: file });
    await ap.init();
    expect(ap.registry.list()).toEqual(['a.b']);
  });

  it('starts the MCP server only when a transport was configured', async () => {
    await createApcore({ mcp: { explorer: true } }).init();
    expect(serve).not.toHaveBeenCalled();

    await createApcore({ mcp: { transport: 'stdio' } }).init();
    expect(serve).toHaveBeenCalledTimes(1);
  });

  it('starts the A2A server only when a port was configured', async () => {
    await createApcore({ a2a: { name: 'agent' } }).init();
    expect(a2aServe).not.toHaveBeenCalled();

    await createApcore({ a2a: { name: 'agent', port: 9000 } }).init();
    expect(a2aServe).toHaveBeenCalledTimes(1);
  });

  it('resolves ready() before and after init', async () => {
    const ap = createApcore({ tools: [ping] });
    await expect(ap.ready()).resolves.toBeUndefined();
    const pending = ap.init();
    await expect(ap.ready()).resolves.toBeUndefined();
    await pending;
  });
});

describe('HonoApcore registration helpers', () => {
  it('registers a single tool and a batch', async () => {
    const ap = createApcore();
    await expect(ap.registerTool(ping)).resolves.toBe('demo.ping');
    await expect(
      ap.registerTools([{ id: 'demo.other', description: 'd', handler: () => ({}) }]),
    ).resolves.toEqual(['demo.other']);
  });

  it('registers object methods', async () => {
    const ap = createApcore();
    const service = { list: () => ({ items: [] }) };

    await expect(
      ap.registerMethod({ instance: service, method: 'list', description: 'd', id: 'x.list' }),
    ).resolves.toBe('x.list');

    await expect(
      ap.registerObject({ instance: service, methods: '*', namespace: 'y' }),
    ).resolves.toEqual(['y.list']);
  });

  it('returns an empty list when no bindings file is configured', async () => {
    await expect(createApcore().loadBindings()).resolves.toEqual([]);
  });

  it('names the offending route when a module ID is rejected', async () => {
    const hono = new Hono();
    hono.get('/internal/debug', (c) => c.json({}));

    await expect(createApcore().scanRoutes(hono)).rejects.toThrow(
      /Cannot register route GET \/internal\/debug as module "internal.debug.list"/,
    );
  });
});

describe('HonoApcore MCP integration', () => {
  it('mounts the MCP endpoint into a Hono app', async () => {
    const hono = new Hono();
    const ap = createApcore({ mcp: { explorer: true, allowExecute: true } });

    await ap.mountMcp(hono, { endpoint: '/mcp' });

    expect(hono.routes.map((r) => r.path)).toEqual(expect.arrayContaining(['/mcp', '/explorer']));
    expect(asyncServe.mock.calls[0][1]).toMatchObject({ explorer: true, allowExecute: true });
  });

  it('refuses to mount without an MCP surface', async () => {
    await expect(createApcore().mountMcp(new Hono())).rejects.toThrow(/requires the MCP surface/);
  });

  it('exports OpenAI tool definitions', async () => {
    const ap = createApcore({ mcp: {} });
    await expect(ap.toOpenaiTools()).resolves.toEqual([{ type: 'function' }]);
  });

  it('refuses to export without an MCP surface', async () => {
    await expect(createApcore().toOpenaiTools()).rejects.toThrow(/requires the MCP surface/);
  });

  it('closes both surfaces', async () => {
    const ap = createApcore({ mcp: {}, a2a: { port: 9000 } });
    const app = await ap.mcp!.asyncServe();
    await ap.a2a!.start();

    await ap.close();

    expect(app.close).toHaveBeenCalledTimes(1);
    expect(ap.a2a!.isRunning).toBe(false);
  });

  it('closes cleanly with no surfaces at all', async () => {
    await expect(createApcore().close()).resolves.toBeUndefined();
  });
});
