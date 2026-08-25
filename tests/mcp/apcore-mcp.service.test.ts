import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Executor, Registry } from 'apcore-js';
import { ApcoreExecutor } from '../../src/core/executor.js';
import { ApcoreRegistry } from '../../src/core/registry.js';
import { ApcoreMcpService } from '../../src/mcp/apcore-mcp.service.js';
import type { ApcoreMcpOptions } from '../../src/types.js';

const serve = vi.fn(async (..._args: unknown[]) => undefined);
const asyncServe = vi.fn(async (..._args: unknown[]) => ({
  handler: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
}));
const toOpenaiTools = vi.fn((..._args: unknown[]) => [{ type: 'function' }]);

vi.mock('apcore-mcp', () => ({
  serve: (...args: unknown[]) => serve(...args),
  asyncServe: (...args: unknown[]) => asyncServe(...args),
  toOpenaiTools: (...args: unknown[]) => toOpenaiTools(...args),
}));

async function build(options: ApcoreMcpOptions = {}): Promise<{
  service: ApcoreMcpService;
  registry: ApcoreRegistry;
}> {
  const raw = new Registry();
  const registry = new ApcoreRegistry(raw);
  await registry.registerTool({
    id: 'demo.ping',
    description: 'Ping',
    tags: ['demo'],
    handler: () => ({ pong: true }),
  });
  const executor = new ApcoreExecutor(new Executor({ registry: raw }));
  return { service: new ApcoreMcpService(registry, executor, options), registry };
}

beforeEach(() => {
  serve.mockClear();
  asyncServe.mockClear();
  toOpenaiTools.mockClear();
});

describe('ApcoreMcpService', () => {
  it('starts out stopped with no embedded app', async () => {
    const { service } = await build();
    expect(service.isRunning).toBe(false);
    expect(service.app).toBeNull();
  });

  it('counts the tools honouring tags and prefix filters', async () => {
    const { service } = await build({ tags: ['demo'] });
    expect(service.toolCount).toBe(1);

    const { service: filtered } = await build({ prefix: 'other' });
    expect(filtered.toolCount).toBe(0);
  });

  it('forwards the shared and serve-only options', async () => {
    const { service } = await build({
      name: 'demo',
      transport: 'streamable-http',
      port: 8123,
      explorer: true,
      redactOutput: false,
    });

    await service.start();

    expect(service.isRunning).toBe(true);
    expect(serve).toHaveBeenCalledTimes(1);
    expect(serve.mock.calls[0][1]).toMatchObject({
      name: 'demo',
      transport: 'streamable-http',
      port: 8123,
      explorer: true,
      redactOutput: false,
    });
  });

  it('renames mcpMiddleware and mcpAcl on the way out', async () => {
    const middleware = [{ priority: 1 }];
    const acl = { rules: [] };
    const { service } = await build({ transport: 'stdio', mcpMiddleware: middleware, mcpAcl: acl });

    await service.start();

    expect(serve.mock.calls[0][1]).toMatchObject({ middleware, acl });
  });

  it('applies per-call start() overrides', async () => {
    const { service } = await build({ transport: 'stdio', port: 1 });
    await service.start({ transport: 'sse', port: 9999, host: undefined });

    expect(serve.mock.calls[0][1]).toMatchObject({ transport: 'sse', port: 9999 });
  });

  it('builds the embedded app once and reuses it', async () => {
    const { service } = await build({ explorer: true, allowExecute: true });

    const first = await service.asyncServe({ endpoint: '/mcp' });
    const second = await service.asyncServe();

    expect(first).toBe(second);
    expect(asyncServe).toHaveBeenCalledTimes(1);
    expect(asyncServe.mock.calls[0][1]).toMatchObject({
      endpoint: '/mcp',
      explorer: true,
      allowExecute: true,
    });
    expect(service.app).toBe(first);
  });

  it('drops undefined options rather than forwarding them', async () => {
    const { service } = await build();
    await service.asyncServe();
    expect(asyncServe.mock.calls[0][1]).not.toHaveProperty('explorer');
  });

  it('closes the embedded app on stop()', async () => {
    const { service } = await build();
    const app = await service.asyncServe();

    await service.stop();

    expect(app.close).toHaveBeenCalledTimes(1);
    expect(service.app).toBeNull();
    expect(service.isRunning).toBe(false);
  });

  it('restarts by stopping and starting again', async () => {
    const { service } = await build({ transport: 'stdio' });
    await service.start();
    await service.restart();
    expect(serve).toHaveBeenCalledTimes(2);
  });

  it('converts modules to OpenAI tools', async () => {
    const { service } = await build({ tags: ['demo'] });
    await expect(service.toOpenaiTools()).resolves.toEqual([{ type: 'function' }]);
    expect(toOpenaiTools.mock.calls[0][1]).toMatchObject({ tags: ['demo'] });

    await service.toOpenaiTools({ strict: true });
    expect(toOpenaiTools.mock.calls[1][1]).toEqual({ strict: true });
  });
});
