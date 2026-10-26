import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import {
  AlwaysDenyHandler,
  CancelToken,
  Config,
  Context,
  ExecutionPolicy,
  Registry,
} from 'apcore-js';
import { createScannedModule } from 'apcore-toolkit';
import { createApcore } from '../../src/core/apcore.js';
import { ApcoreRegistry } from '../../src/core/registry.js';
import { ApBindingLoader } from '../../src/bridge/binding-loader.js';
import { renderBindingsYaml } from '../../src/output/yaml-writer.js';
import { Hono } from 'hono';

describe('SDK upgrade integration', () => {
  it('discovers and executes a registered tool through the real A2A HTTP app', async () => {
    const ap = createApcore({
      tools: [{ id: 'demo.echo', description: 'Echo', handler: (inputs) => ({ echoed: inputs }) }],
      a2a: { name: 'hono-upgrade', sysModules: false, metrics: false },
    });
    await ap.init();
    const app = await ap.a2a!.asyncServe();
    const server = createServer(app as RequestListener);
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const card = await fetch(`${url}/.well-known/agent-card.json`);
      expect(await card.json()).toMatchObject({ name: 'hono-upgrade', skills: [{ id: 'demo.echo' }] });
      const response = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(3_000),
        body: JSON.stringify({
          jsonrpc: '2.0', id: 'upgrade', method: 'message/send',
          params: { message: {
            messageId: 'upgrade-message', role: 'user',
            parts: [{ kind: 'text', text: '{"value":42}' }],
            metadata: { skillId: 'demo.echo' },
          } },
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ result: {
        status: { state: 'completed' },
        artifacts: [{ parts: [{ kind: 'data', data: { echoed: { value: 42 } } }] }],
      } });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await ap.close();
    }
  });

  it.each(['handler', 'body'])('drains asynchronous route %s cleanup after cancellation', async (phase) => {
    const token = new CancelToken();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const cleanupGate = new Promise<void>((resolve) => { release = resolve; });
    let wakeHandler = (): void => {};
    let cleaned = false;
    const app = new Hono().get('/drain', async (c) => {
      if (phase === 'body') {
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode('{')); started(); },
          async cancel() { await cleanupGate; cleaned = true; },
        }), { headers: { 'content-type': 'application/json' } });
      }
      const aborted = new Promise<void>((resolve) => {
        wakeHandler = resolve;
        c.req.raw.signal.addEventListener('abort', resolve.bind(null, undefined), { once: true });
        if (c.req.raw.signal.aborted) resolve();
      });
      started();
      await aborted;
      await cleanupGate;
      cleaned = true;
      return c.json({ ok: true });
    });
    const ap = createApcore();
    await ap.init(app);
    const execution = ap.executor.call('drain.list', {}, Context.create(null, null, token))
      .catch((error: unknown) => error);
    try {
      await ready;
      token.cancel();
      expect(await execution).toMatchObject({ code: 'EXECUTION_CANCELLED' });
      let drained = false;
      const draining = token.drain().then(() => { drained = true; });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(drained).toBe(false);
      expect(cleaned).toBe(false);
      release();
      await draining;
      expect(cleaned).toBe(true);
    } finally {
      token.cancel();
      wakeHandler();
      release();
      await execution;
      await token.drain();
      await ap.close();
    }
  });

  it('preserves runtime annotations and enforces tool approval', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const ap = createApcore({
      executorOptions: {
        strategy: 'performance',
        approvalHandler: new AlwaysDenyHandler(),
        policy: new ExecutionPolicy([], { strict: true }),
      },
      tools: [{
        id: 'demo.guarded', description: 'Guarded', handler,
        annotations: { requiresApproval: true, openWorld: false, cacheTtl: 15 },
      }],
    });
    await ap.init();
    expect(ap.registry.getDefinition('demo.guarded')?.annotations).toMatchObject({
      requiresApproval: true, openWorld: false, cacheTtl: 15,
    });
    await expect(ap.executor.call('demo.guarded')).rejects.toMatchObject({ code: 'APPROVAL_DENIED' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('honors SDK pipeline configuration', async () => {
    const ap = createApcore({
      config: new Config({ pipeline: { remove: ['middleware_after'] } }),
      tools: [{ id: 'demo.limited', description: 'Limited', handler: () => ({}),
        inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
      }],
    });
    await ap.init();
    expect(ap.executor.raw.currentStrategy.steps.map((step) => step.name))
      .not.toContain('middleware_after');
  });

  it('discovers extensions from configured SDK roots during init', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hono-sdk-roots-'));
    try {
      const extensions = join(root, 'extensions');
      const leaf = join(extensions, 'executor', 'svc');
      await mkdir(leaf, { recursive: true });
      await writeFile(join(root, 'package.json'), '{"type":"module"}');
      await writeFile(join(leaf, 'probe.js'), `export const Probe = {
        inputSchema: {type: 'object'}, outputSchema: {type: 'object'},
        description: 'Probe', execute: () => ({ok: true}),
      };`);
      const ap = createApcore({ config: new Config({ extensions: { roots: [extensions] } }) });
      await ap.init();
      expect(ap.registry.count).toBe(1);
      await expect(ap.executor.call(ap.registry.list()[0]!)).resolves.toEqual({ ok: true });
      await ap.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves async metadata, display and discoverability on tools', async () => {
    const ap = createApcore({ tools: [{
      id: 'demo.hidden', description: 'Hidden job', handler: () => ({}),
      metadata: { async: true }, display: { alias: 'job' },
      annotations: { discoverable: false, extra: { mcp_async: 'true' } },
    }] });
    await ap.init();
    expect(ap.registry.list()).not.toContain('demo.hidden');
    expect(ap.registry.getDefinition('demo.hidden')).toMatchObject({
      metadata: { async: true }, annotations: { extra: { mcp_async: 'true' } },
    });
    expect(ap.registry.toScannedModule('demo.hidden')?.display).toEqual({ alias: 'job' });
    await expect(ap.executor.call('demo.hidden')).resolves.toEqual({});
  });

  it('round-trips binding annotations, metadata, display and examples', async () => {
    const mod = createScannedModule({
      moduleId: 'demo.binding', description: 'Binding', target: 'Demo.run', tags: [],
      version: '2.0.0',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: {} },
      metadata: { async: true }, display: { alias: 'run' },
      examples: [{ title: 'Run', inputs: {}, output: {} }],
    });
    const registry = new ApcoreRegistry(new Registry());
    await new ApBindingLoader(registry, () => () => ({})).loadFromString(
      renderBindingsYaml([mod]),
    );
    expect(registry.getDefinition('demo.binding')).toMatchObject({
      version: '2.0.0', metadata: { async: true }, examples: mod.examples,
    });
    expect(registry.toScannedModule('demo.binding')?.display).toEqual({ alias: 'run' });
    expect(registry.getDefinition('demo.binding')?.metadata.display).toMatchObject({ alias: 'run' });
  });

  it('reads snake_case approval flags from binding YAML', async () => {
    const registry = new ApcoreRegistry(new Registry());
    await new ApBindingLoader(registry).loadFromString(`bindings:
  - module_id: demo.guarded
    target: Demo.run
    annotations:
      requires_approval: true
      open_world: false
      cache_ttl: 15
`);
    expect(registry.getDefinition('demo.guarded')?.annotations).toMatchObject({
      requiresApproval: true, openWorld: false, cacheTtl: 15,
    });
  });

  it.each([
    'other: 1',
    'bindings:\n  - module_id: demo.bad\n    target: Demo.run\n    typo: true',
    'bindings:\n  - module_id: demo.bad\n    target: Demo.run\n    input_schema: {type: object}',
  ])('rejects invalid binding structures before registration: %s', async (yaml) => {
    const registry = new ApcoreRegistry(new Registry());
    await expect(new ApBindingLoader(registry).loadFromString(yaml)).rejects.toThrow();
    expect(registry.count).toBe(0);
  });
});
