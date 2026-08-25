import { describe, expect, it } from 'vitest';
import { Executor, Registry } from 'apcore-js';
import { ApcoreExecutor } from '../../src/core/executor.js';
import { ApcoreRegistry } from '../../src/core/registry.js';

async function buildExecutor(): Promise<ApcoreExecutor> {
  const registry = new Registry();

  await new ApcoreRegistry(registry).registerTool({
    id: 'demo.echo',
    description: 'Echo the value back',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    },
    outputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    handler: (inputs) => ({ value: inputs.value }),
  });

  return new ApcoreExecutor(new Executor({ registry }));
}

describe('ApcoreExecutor', () => {
  it('exposes the underlying executor', async () => {
    const executor = await buildExecutor();
    expect(executor.raw).toBeInstanceOf(Executor);
  });

  it('calls a module', async () => {
    const executor = await buildExecutor();
    await expect(executor.call('demo.echo', { value: 'hi' })).resolves.toEqual({ value: 'hi' });
  });

  it('normalises nullish inputs to an empty object', async () => {
    const executor = await buildExecutor();
    await expect(executor.call('demo.echo', null)).rejects.toThrow();
    await expect(executor.call('demo.echo')).rejects.toThrow();
  });

  it('validates without executing', async () => {
    const executor = await buildExecutor();
    const ok = await executor.validate('demo.echo', { value: 'hi' });
    expect(ok.valid).toBe(true);

    const bad = await executor.validate('demo.echo', {});
    expect(bad.valid).toBe(false);
  });

  it('streams a non-streaming module as a single chunk', async () => {
    const executor = await buildExecutor();
    const chunks: Record<string, unknown>[] = [];
    for await (const chunk of executor.stream('demo.echo', { value: 'hi' })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ value: 'hi' }]);
  });
});
