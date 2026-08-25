import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Registry } from 'apcore-js';
import { ApcoreRegistry } from '../../src/core/registry.js';
import { ApcoreCliService } from '../../src/cli/apcore-cli.service.js';

const createCli = vi.fn((..._args: unknown[]) => ({ name: 'program' }));
const configureManHelp = vi.fn();
const setDocsUrl = vi.fn();
const setVerboseHelp = vi.fn();

vi.mock('apcore-cli', () => ({
  createCli: (...args: unknown[]) => createCli(...args),
  configureManHelp: (...args: unknown[]) => configureManHelp(...args),
  setDocsUrl: (...args: unknown[]) => setDocsUrl(...args),
  setVerboseHelp: (...args: unknown[]) => setVerboseHelp(...args),
}));

let registry: ApcoreRegistry;

beforeEach(() => {
  registry = new ApcoreRegistry(new Registry());
  createCli.mockClear();
  configureManHelp.mockClear();
  setDocsUrl.mockClear();
  setVerboseHelp.mockClear();
});

describe('ApcoreCliService', () => {
  it('reports the module count', async () => {
    await registry.registerTool({ id: 'a.b', description: 'd', handler: () => ({}) });
    expect(new ApcoreCliService(registry).moduleCount).toBe(1);
  });

  it('builds a program with the configured defaults', async () => {
    const service = new ApcoreCliService(registry, {
      extensionsDir: './ext',
      progName: 'demo',
      verboseHelp: true,
    });

    await expect(service.createProgram()).resolves.toEqual({ name: 'program' });
    expect(createCli).toHaveBeenCalledWith('./ext', 'demo', true);
  });

  it('lets createProgram() override the extensions directory', async () => {
    const service = new ApcoreCliService(registry, { extensionsDir: './ext' });
    await service.createProgram('./other');
    expect(createCli).toHaveBeenCalledWith('./other', undefined, false);
  });

  it('applies docsUrl and verboseHelp once, on the first program build', async () => {
    const service = new ApcoreCliService(registry, {
      docsUrl: 'https://docs.example.com',
      verboseHelp: false,
    });

    await service.createProgram();
    await service.createProgram();

    expect(setDocsUrl).toHaveBeenCalledTimes(1);
    expect(setDocsUrl).toHaveBeenCalledWith('https://docs.example.com');
    expect(setVerboseHelp).toHaveBeenCalledTimes(1);
  });

  it('does not touch the module-level knobs when unset', async () => {
    await new ApcoreCliService(registry).createProgram();
    expect(setDocsUrl).not.toHaveBeenCalled();
    expect(setVerboseHelp).not.toHaveBeenCalled();
  });

  it('configures man help, defaulting the docs URL from the options', async () => {
    const service = new ApcoreCliService(registry, { docsUrl: 'https://docs.example.com' });
    const program = { name: 'program' };

    await service.configureManHelp(program, 'demo', '1.0.0', 'Demo');
    expect(configureManHelp).toHaveBeenCalledWith(
      program,
      'demo',
      '1.0.0',
      'Demo',
      'https://docs.example.com',
    );

    await service.configureManHelp(program, 'demo', '1.0.0', 'Demo', 'https://other');
    expect(configureManHelp.mock.calls[1][4]).toBe('https://other');
  });

  it('exposes the runtime setters', async () => {
    const service = new ApcoreCliService(registry);
    await service.setDocsUrl(null);
    await service.setVerboseHelp(true);

    expect(setDocsUrl).toHaveBeenCalledWith(null);
    expect(setVerboseHelp).toHaveBeenCalledWith(true);
  });
});
