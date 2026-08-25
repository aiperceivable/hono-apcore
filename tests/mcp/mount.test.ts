import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HONO_ALREADY_SENT_HEADER } from '../../src/constants.js';
import { RESPONSE_ALREADY_SENT, mountMcp, toHonoHandler } from '../../src/mcp/mount.js';
import type { McpApp } from '../../src/mcp/apcore-mcp.service.js';
import type { ApcoreMcpService } from '../../src/mcp/apcore-mcp.service.js';

function fakeApp(): McpApp {
  return { handler: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
}

function fakeService(app: McpApp): ApcoreMcpService {
  return { asyncServe: vi.fn(async () => app) } as unknown as ApcoreMcpService;
}

describe('RESPONSE_ALREADY_SENT', () => {
  it('carries the sentinel header @hono/node-server looks for', () => {
    expect(RESPONSE_ALREADY_SENT.headers.get(HONO_ALREADY_SENT_HEADER)).toBe('true');
  });
});

describe('toHonoHandler', () => {
  it('hands the Node request and response to the MCP handler', async () => {
    const app = fakeApp();
    const incoming = { url: '/mcp' };
    const outgoing = { end: vi.fn() };

    const response = await toHonoHandler(app)({ env: { incoming, outgoing } });

    expect(app.handler).toHaveBeenCalledWith(incoming, outgoing);
    expect(response.headers.get(HONO_ALREADY_SENT_HEADER)).toBe('true');
  });

  it('returns 501 with a runtime hint when the Node bindings are absent', async () => {
    const response = await toHonoHandler(fakeApp())({ env: {} });
    expect(response.status).toBe(501);
    expect(await response.text()).toMatch(/@hono\/node-server/);
  });

  it('handles a context with no env at all', async () => {
    expect((await toHonoHandler(fakeApp())({})).status).toBe(501);
    expect((await toHonoHandler(fakeApp())(null)).status).toBe(501);
  });
});

describe('mountMcp', () => {
  it('mounts the endpoint and the built-in routes by default', async () => {
    const hono = new Hono();
    const mcpApp = fakeApp();

    await mountMcp(hono, fakeService(mcpApp));

    const paths = hono.routes.map((route) => route.path);
    expect(paths).toContain('/mcp');
    expect(paths).toContain('/health');
    expect(paths).toContain('/metrics');
    expect(paths).toContain('/usage');
    expect(paths).not.toContain('/explorer');
  });

  it('mounts the explorer prefix and its subtree when enabled', async () => {
    const hono = new Hono();
    await mountMcp(hono, fakeService(fakeApp()), {
      explorer: true,
      explorerPrefix: '/ui',
      builtinRoutes: false,
    });

    const paths = hono.routes.map((route) => route.path);
    expect(paths).toEqual(expect.arrayContaining(['/mcp', '/ui', '/ui/*']));
    expect(paths).not.toContain('/health');
  });

  it('forwards the endpoint and explorer settings to asyncServe', async () => {
    const service = fakeService(fakeApp());
    await mountMcp(new Hono(), service, {
      endpoint: '/tools',
      explorer: true,
      allowExecute: true,
    });

    expect(service.asyncServe).toHaveBeenCalledWith({
      endpoint: '/tools',
      explorer: true,
      explorerPrefix: '/explorer',
      allowExecute: true,
    });
  });

  it('returns the embedded app so callers can close it', async () => {
    const mcpApp = fakeApp();
    await expect(mountMcp(new Hono(), fakeService(mcpApp))).resolves.toBe(mcpApp);
  });

  it('routes a request through the mounted handler', async () => {
    const hono = new Hono();
    const mcpApp = fakeApp();
    await mountMcp(hono, fakeService(mcpApp), { builtinRoutes: false });

    const response = await hono.request('/mcp', { method: 'POST' }, {
      incoming: { url: '/mcp' },
      outgoing: {},
    });

    expect(mcpApp.handler).toHaveBeenCalledTimes(1);
    expect(response.headers.get(HONO_ALREADY_SENT_HEADER)).toBe('true');
  });
});
