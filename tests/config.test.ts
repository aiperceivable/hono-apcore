import { describe, expect, it } from 'vitest';
import { APCORE_SETTING_DEFAULTS, loadSettings, toMcpTransport } from '../src/config.js';

describe('loadSettings', () => {
  it('returns the canonical defaults for an empty environment', () => {
    expect(loadSettings({})).toEqual(APCORE_SETTING_DEFAULTS);
  });

  it('parses every APCORE_* variable', () => {
    const settings = loadSettings({
      APCORE_ENABLED: 'false',
      APCORE_DEBUG: 'true',
      APCORE_SCANNERS: 'routes, tools',
      APCORE_INCLUDE_PATHS: '/api/*',
      APCORE_EXCLUDE_PATHS: '/internal/*,/health',
      APCORE_MODULE_PREFIX: 'svc',
      APCORE_AUTH_ENABLED: '1',
      APCORE_AUTH_STRATEGY: 'session',
      APCORE_TRANSPORT: 'http',
      APCORE_HOST: '127.0.0.1',
      APCORE_PORT: '9001',
    });

    expect(settings).toEqual({
      enabled: false,
      debug: true,
      scanners: ['routes', 'tools'],
      includePaths: ['/api/*'],
      excludePaths: ['/internal/*', '/health'],
      modulePrefix: 'svc',
      authEnabled: true,
      authStrategy: 'session',
      transport: 'http',
      host: '127.0.0.1',
      port: 9001,
    });
  });

  it('falls back to defaults for unparseable values', () => {
    const settings = loadSettings({
      APCORE_ENABLED: 'maybe',
      APCORE_PORT: 'not-a-port',
      APCORE_TRANSPORT: 'carrier-pigeon',
      APCORE_AUTH_STRATEGY: 'telepathy',
    });

    expect(settings.enabled).toBe(APCORE_SETTING_DEFAULTS.enabled);
    expect(settings.port).toBe(APCORE_SETTING_DEFAULTS.port);
    expect(settings.transport).toBe(APCORE_SETTING_DEFAULTS.transport);
    expect(settings.authStrategy).toBe(APCORE_SETTING_DEFAULTS.authStrategy);
  });

  it('rejects out-of-range ports', () => {
    expect(loadSettings({ APCORE_PORT: '70000' }).port).toBe(APCORE_SETTING_DEFAULTS.port);
    expect(loadSettings({ APCORE_PORT: '-1' }).port).toBe(APCORE_SETTING_DEFAULTS.port);
  });

  it('treats an empty list as empty rather than one blank entry', () => {
    expect(loadSettings({ APCORE_INCLUDE_PATHS: '' }).includePaths).toEqual([]);
  });

  it('lets overrides win over the environment', () => {
    const settings = loadSettings({ APCORE_PORT: '9001' }, { port: 1234, debug: true });
    expect(settings.port).toBe(1234);
    expect(settings.debug).toBe(true);
  });

  it('does not share array instances with the frozen defaults', () => {
    const first = loadSettings({});
    first.scanners.push('mutated');
    expect(loadSettings({}).scanners).toEqual(['auto']);
  });
});

describe('toMcpTransport', () => {
  it('maps the ecosystem "http" spelling to apcore-mcp\'s name', () => {
    expect(toMcpTransport('http')).toBe('streamable-http');
  });

  it('passes stdio and sse through unchanged', () => {
    expect(toMcpTransport('stdio')).toBe('stdio');
    expect(toMcpTransport('sse')).toBe('sse');
  });
});
