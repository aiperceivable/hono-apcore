import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { setAuditLogger } from 'apcore-cli';
import { ACL, AfterMiddleware, AlwaysDenyHandler, DEFAULT_ANNOTATIONS, STREAMING_MARKER } from 'apcore-js';
import type { createCli } from 'apcore-cli';
import { createApcore } from '../../src/core/apcore.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('real CLI SDK', () => {
  it('prompts only once when terminal approval already covered the module annotation', async () => {
    vi.stubEnv('APCORE_CLI_AUTO_APPROVE', '');
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const input = Object.assign(new PassThrough(), { isTTY: true });
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as unknown as typeof process.stdin);
    let prompts = 0;
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      if (String(chunk).includes('Proceed?')) {
        prompts++;
        queueMicrotask(() => input.write('y\n'));
      }
      return true;
    });
    const handler = vi.fn(() => ({ done: true }));
    const ap = createApcore({ cli: {}, tools: [{
      id: 'demo.guarded', description: 'Guarded', annotations: { requiresApproval: true }, handler,
    }] });
    await ap.init();
    const program = await ap.cli!.createProgram() as ReturnType<typeof createCli>;
    setAuditLogger(null);
    try {
      await program.parseAsync(['demo', 'guarded'], { from: 'user' });
      expect(handler).toHaveBeenCalledOnce();
      expect(prompts).toBe(1);
    } finally {
      input.destroy();
    }
  });
  it.each([
    { flags: [] }, { flags: ['--trace'] },
    { flags: ['--trace', '--strategy', 'standard'] }, { flags: ['--stream'] },
  ])('enforces ACL-derived approval without a host handler: $flags', async ({ flags }) => {
    vi.stubEnv('APCORE_CLI_AUTO_APPROVE', '');
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`); });
    const handler = vi.fn(() => ({ done: true }));
    const ap = createApcore({ cli: {}, acl: new ACL([{
      callers: ['*'], targets: ['demo.guarded'], effect: 'allow',
      approval: 'required', description: 'Approval is required for this call',
    }], 'deny') });
    await ap.registry.register('demo.guarded', {
      [STREAMING_MARKER]: true,
      description: 'Guarded stream', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
      annotations: { ...DEFAULT_ANNOTATIONS, streaming: true },
      execute: handler, stream: async function* () { yield handler(); },
    });
    expect((await ap.executor.validate('demo.guarded')).requiresApproval).toBe(true);
    const program = await ap.cli!.createProgram() as ReturnType<typeof createCli>;
    setAuditLogger(null);
    await expect(program.parseAsync(['demo', 'guarded', ...flags], { from: 'user' }))
      .rejects.toThrow('exit:');
    expect(handler).not.toHaveBeenCalled();
    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('Non-interactive');
  });

  it('honors --yes for the CLI approval fallback without authorizing later application calls', async () => {
    vi.stubEnv('APCORE_CLI_AUTO_APPROVE', '');
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const handler = vi.fn(() => ({ done: true }));
    const ap = createApcore({ cli: {}, acl: new ACL([{
      callers: ['*'], targets: ['demo.guarded'], effect: 'allow',
      approval: 'required', description: 'Ask first',
    }], 'deny'), tools: [{ id: 'demo.guarded', description: 'Guarded', handler }] });
    await ap.init();
    const program = await ap.cli!.createProgram() as ReturnType<typeof createCli>;
    setAuditLogger(null);
    await program.parseAsync(['demo', 'guarded', '--yes'], { from: 'user' });
    expect(handler).toHaveBeenCalledOnce();
    const second = await ap.cli!.createProgram() as ReturnType<typeof createCli>;
    setAuditLogger(null);
    await second.parseAsync(['demo', 'guarded', '--yes'], { from: 'user' });
    expect(handler).toHaveBeenCalledTimes(2);
    await expect(ap.executor.call('demo.guarded')).rejects.toMatchObject({ code: 'APPROVAL_DENIED' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('propagates CLI identity to streaming calls and their ACL checks', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const ap = createApcore({ cli: {}, acl: new ACL([{
      callers: ['*'], targets: ['demo.stream'], effect: 'allow', description: 'Admins',
      conditions: { roles: ['admin'] },
    }], 'deny') });
    await ap.registry.register('demo.stream', {
      [STREAMING_MARKER]: true,
      description: 'Stream identity', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
      annotations: { ...DEFAULT_ANNOTATIONS, streaming: true },
      execute: () => ({}),
      stream: async function* (_input: unknown, context: { identity: { id: string } }) {
        yield { identity: context.identity.id };
      },
    });
    const program = await ap.cli!.createProgram() as ReturnType<typeof createCli>;
    setAuditLogger(null);
    await program.parseAsync([
      '--identity-id', 'alice', '--role', 'admin', 'demo', 'stream', '--stream',
    ], { from: 'user' });
    expect(JSON.parse(write.mock.calls.map(([chunk]) => String(chunk)).join('')))
      .toEqual({ identity: 'alice' });
  });
  it.each([{ flags: [] }, { flags: ['--trace'] }, { flags: ['--trace', '--strategy', 'standard'] }])('executes registered Hono tools with host middleware: $flags', async ({ flags }) => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const after = vi.fn((_id, _inputs, output) => ({ ...output, host: true }));
    const ap = createApcore({
      cli: { progName: 'demo' },
      middleware: [new AfterMiddleware(after)],
      tools: [{ id: 'demo.ping', description: 'Ping', handler: () => ({ pong: true }) }],
    });
    await ap.init();
    const program = await ap.cli!.createProgram() as ReturnType<typeof createCli>;
    setAuditLogger(null);
    program.exitOverride();
    await program.parseAsync(['demo', 'ping', ...flags], { from: 'user' });
    expect(after).toHaveBeenCalled();
    const output = write.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(JSON.parse(output)).toMatchObject({ pong: true, host: true });
    if (flags.length) expect(JSON.parse(output)._trace.success).toBe(true);
    await ap.close();
  });

  it('keeps the host approval handler when constructing a CLI', async () => {
    const approval = new AlwaysDenyHandler();
    const request = vi.spyOn(approval, 'requestApproval');
    const ap = createApcore({
      cli: {}, executorOptions: { approvalHandler: approval },
      tools: [{ id: 'demo.guarded', description: 'Guarded',
        annotations: { requiresApproval: true }, handler: () => ({}),
      }],
    });
    await ap.init();
    await ap.cli!.createProgram();
    setAuditLogger(null);
    await expect(ap.executor.call('demo.guarded')).rejects.toMatchObject({ code: 'APPROVAL_DENIED' });
    expect(request).toHaveBeenCalledOnce();
  });

  it('requires terminal approval for annotated tools before invoking a handler', async () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`); });
    const handler = vi.fn(() => ({}));
    const ap = createApcore({ cli: {}, tools: [{
      id: 'demo.guarded', description: 'Guarded', annotations: { requiresApproval: true }, handler,
    }] });
    await ap.init();
    const program = await ap.cli!.createProgram() as ReturnType<typeof createCli>;
    setAuditLogger(null);
    await expect(program.parseAsync(['demo', 'guarded'], { from: 'user' })).rejects.toThrow('exit:');
    expect(handler).not.toHaveBeenCalled();
    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('requires approval');
  });
});
