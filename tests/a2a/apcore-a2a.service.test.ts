import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Executor, Registry } from 'apcore-js';
import { ApcoreExecutor } from '../../src/core/executor.js';
import { ApcoreRegistry } from '../../src/core/registry.js';
import { ApcoreA2aService } from '../../src/a2a/apcore-a2a.service.js';
import type { ApcoreA2aOptions } from '../../src/types.js';

const serve = vi.fn((..._args: unknown[]) => undefined);
const asyncServe = vi.fn(async (..._args: unknown[]) => ({ mounted: true }));

vi.mock('apcore-a2a', () => ({
  serve: (...args: unknown[]) => serve(...args),
  asyncServe: (...args: unknown[]) => asyncServe(...args),
}));

async function build(options: ApcoreA2aOptions = {}): Promise<ApcoreA2aService> {
  const raw = new Registry();
  const registry = new ApcoreRegistry(raw);
  await registry.registerTool({ id: 'demo.ping', description: 'd', handler: () => ({}) });
  return new ApcoreA2aService(registry, new ApcoreExecutor(new Executor({ registry: raw })), options);
}

beforeEach(() => {
  serve.mockClear();
  asyncServe.mockClear();
});

describe('ApcoreA2aService', () => {
  it('starts out stopped and counts the skills', async () => {
    const service = await build();
    expect(service.isRunning).toBe(false);
    expect(service.skillCount).toBe(1);
  });

  it('forwards the configured options to serve()', async () => {
    const service = await build({ name: 'agent', port: 9000, url: 'https://agent.example.com' });
    await service.start();

    expect(service.isRunning).toBe(true);
    expect(serve.mock.calls[0][1]).toEqual({
      name: 'agent',
      port: 9000,
      url: 'https://agent.example.com',
    });
  });

  it('drops undefined options rather than forwarding them', async () => {
    const service = await build({ name: 'agent' });
    await service.start();
    expect(serve.mock.calls[0][1]).toEqual({ name: 'agent' });
  });

  it('merges overrides into asyncServe()', async () => {
    const service = await build({ name: 'agent', explorer: false });
    await expect(service.asyncServe({ explorer: true })).resolves.toEqual({ mounted: true });
    expect(asyncServe.mock.calls[0][1]).toEqual({ name: 'agent', explorer: true });
  });

  it('marks itself stopped', async () => {
    const service = await build({ port: 9000 });
    await service.start();
    service.stop();
    expect(service.isRunning).toBe(false);
  });
});
