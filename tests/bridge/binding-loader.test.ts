import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Registry } from 'apcore-js';
import { ApBindingLoader, resolverFromObjects } from '../../src/bridge/binding-loader.js';
import { ApcoreRegistry } from '../../src/core/registry.js';

const YAML = `
bindings:
  - module_id: email.send
    target: EmailService.send
    description: Send an email
    input_schema:
      type: object
      properties:
        to: { type: string }
      required: [to]
    output_schema:
      type: object
      properties:
        sent: { type: boolean }
    tags: [email, mutate]
    annotations:
      readonly: false
    documentation: Sends one email.
`;

class EmailService {
  send(inputs: Record<string, unknown>): Record<string, unknown> {
    return { sent: true, to: inputs.to };
  }
}

let registry: ApcoreRegistry;

beforeEach(() => {
  registry = new ApcoreRegistry(new Registry());
});

describe('resolverFromObjects', () => {
  it('resolves a bound method', () => {
    const resolve = resolverFromObjects({ EmailService: new EmailService() });
    expect(resolve('EmailService.send')?.({ to: 'a@b.c' })).toEqual({ sent: true, to: 'a@b.c' });
  });

  it('returns undefined for an unknown object, method, or malformed target', () => {
    const resolve = resolverFromObjects({ EmailService: new EmailService() });
    expect(resolve('Nope.send')).toBeUndefined();
    expect(resolve('EmailService.nope')).toBeUndefined();
    expect(resolve('EmailService')).toBeUndefined();
  });
});

describe('ApBindingLoader', () => {
  it('registers each binding with its metadata', async () => {
    const loader = new ApBindingLoader(
      registry,
      resolverFromObjects({ EmailService: new EmailService() }),
    );

    await expect(loader.loadFromString(YAML)).resolves.toEqual(['email.send']);

    const definition = registry.getDefinition('email.send');
    expect(definition?.description).toBe('Send an email');
    expect(definition?.tags).toEqual(['email', 'mutate']);
    expect(definition?.documentation).toBe('Sends one email.');
  });

  it('binds the resolved handler', async () => {
    const loader = new ApBindingLoader(
      registry,
      resolverFromObjects({ EmailService: new EmailService() }),
    );
    await loader.loadFromString(YAML);

    const module = registry.get('email.send') as { execute: (i: unknown, c: unknown) => unknown };
    await expect(module.execute({ to: 'a@b.c' }, null)).resolves.toEqual({
      sent: true,
      to: 'a@b.c',
    });
  });

  it('registers an error-returning stub when the target cannot be resolved', async () => {
    const loader = new ApBindingLoader(registry);
    await loader.loadFromString(YAML);

    const module = registry.get('email.send') as { execute: (i: unknown, c: unknown) => unknown };
    await expect(module.execute({}, null)).resolves.toEqual({
      error: 'No handler resolved for binding target "EmailService.send"',
    });
  });

  it('defaults missing schemas to an empty object schema', async () => {
    const loader = new ApBindingLoader(registry);
    await loader.loadFromString(
      'bindings:\n  - module_id: a.b\n    target: X.y\n    description: d\n',
    );
    expect(registry.getDefinition('a.b')?.inputSchema).toMatchObject({ type: 'object' });
  });

  it('accepts empty and binding-less documents', async () => {
    const loader = new ApBindingLoader(registry);
    await expect(loader.loadFromString('')).resolves.toEqual([]);
    await expect(loader.loadFromString('other: 1\n')).resolves.toEqual([]);
  });

  it('loads from a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hono-apcore-'));
    const file = join(dir, 'bindings.yaml');
    await writeFile(file, YAML, 'utf-8');

    const loader = new ApBindingLoader(registry);
    await expect(loader.loadFromFile(file)).resolves.toEqual(['email.send']);
  });
});
