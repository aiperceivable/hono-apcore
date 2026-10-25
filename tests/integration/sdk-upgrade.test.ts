import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AlwaysDenyHandler,
  Config,
  ExecutionPolicy,
  Registry,
} from 'apcore-js';
import { createScannedModule } from 'apcore-toolkit';
import { createApcore } from '../../src/core/apcore.js';
import { ApcoreRegistry } from '../../src/core/registry.js';
import { ApBindingLoader } from '../../src/bridge/binding-loader.js';
import { renderBindingsYaml } from '../../src/output/yaml-writer.js';

describe('SDK upgrade integration', () => {
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
