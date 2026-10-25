import { describe, expect, it } from 'vitest';
import { AlwaysDenyHandler, ExecutionPolicy, Executor, PolicyRule, Registry } from 'apcore-js';
import { createApcore } from '../../src/core/apcore.js';
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
  it('uses the live policy for named traces after the startup policy is cleared or replaced', async () => {
    const policy = new ExecutionPolicy([new PolicyRule('demo.run', { requiresApproval: true })], { strict: true });
    const ap = createApcore({ executorOptions: { policy, approvalHandler: new AlwaysDenyHandler() },
      tools: [{ id: 'demo.run', description: 'Run', handler: () => ({ done: true }) }],
    });
    await ap.init();
    ap.executor.raw.setPolicy(null);
    const [output] = await ap.executor.callWithTrace('demo.run', {}, null, { strategy: 'standard' });
    expect(output).toEqual({ done: true });
    ap.executor.raw.setPolicy(policy);
    await expect(ap.executor.callWithTrace('demo.run', {}, null, { strategy: 'standard' }))
      .rejects.toMatchObject({ code: 'APPROVAL_DENIED' });
  });
  it('exposes the underlying executor', async () => {
    const executor = await buildExecutor();
    expect(executor.raw).toBeInstanceOf(Executor);
  });

  it('calls a module', async () => {
    const executor = await buildExecutor();
    await expect(executor.call('demo.echo', { value: 'hi' })).resolves.toEqual({ value: 'hi' });
  });

  it('traces calls and runs step middleware through the SDK pipeline', async () => {
    const executor = await buildExecutor();
    const steps: string[] = [];
    expect(executor.addStepMiddleware({ beforeStep: (name) => { steps.push(name); } }))
      .toBe(executor);
    const [output, trace] = await executor.callWithTrace('demo.echo', { value: 'hi' });
    expect(output).toEqual({ value: 'hi' });
    expect(trace.steps.length).toBeGreaterThan(0);
    expect(steps).toContain('execute');
    await expect(executor.callWithTrace('demo.echo', null)).rejects.toThrow();
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
