import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { Type } from '@sinclair/typebox';
import { createApcore, defineTool } from '../../src/index.js';
import type { HonoApcore } from '../../src/index.js';
import type { McpApp } from '../../src/index.js';

/**
 * Exercises the real thing: a Hono app whose routes and tools are registered
 * as apcore modules, with the MCP endpoint mounted into the same app and
 * served through @hono/node-server, then driven over HTTP by an MCP client
 * handshake.
 */

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

let app: Hono;
let ap: HonoApcore;
let mcpApp: McpApp;
let server: ServerType;
let baseUrl: string;
let sessionId: string;

/** Read a Streamable HTTP response, which arrives as an SSE `data:` frame. */
async function readJsonRpc(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  return JSON.parse(line ? line.slice(5).trim() : text) as Record<string, unknown>;
}

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { ...MCP_HEADERS, 'mcp-session-id': sessionId },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  return readJsonRpc(response);
}

beforeAll(async () => {
  app = new Hono();
  app.get('/todos', (c) => c.json({ todos: [{ id: 1, title: 'first' }] }));
  app.get('/todos/:id', (c) => c.json({ id: Number(c.req.param('id')) }));

  ap = createApcore({
    tools: [
      defineTool({
        namespace: 'math',
        name: 'add',
        description: 'Add two numbers',
        inputSchema: Type.Object({ a: Type.Number(), b: Type.Number() }),
        outputSchema: Type.Object({ sum: Type.Number() }),
        annotations: { readonly: true, idempotent: true },
        tags: ['math'],
        handler: (inputs) => ({ sum: Number(inputs.a) + Number(inputs.b) }),
      }),
    ],
    mcp: { name: 'hono-apcore-e2e', version: '1.0.0', logLevel: 'ERROR' },
  });

  await ap.init(app);
  mcpApp = await ap.mountMcp(app, { endpoint: '/mcp' });

  server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  const initialize = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '1.0.0' },
      },
    }),
  });
  sessionId = initialize.headers.get('mcp-session-id') ?? '';
}, 30_000);

afterAll(async () => {
  await mcpApp.close();
  await ap.close();
  server.close();
});

describe('hono-apcore end to end', () => {
  it('registers both the tools and the scanned routes', () => {
    expect(ap.registry.list().sort()).toEqual(['math.add', 'todos.get', 'todos.list']);
  });

  it("keeps the app's own routes working", async () => {
    const response = await fetch(`${baseUrl}/todos`);
    expect(await response.json()).toEqual({ todos: [{ id: 1, title: 'first' }] });
  });

  it('serves the MCP handshake on the same port', () => {
    expect(sessionId).not.toBe('');
  });

  it('lists every module as an MCP tool', async () => {
    const result = await rpc('tools/list');
    const names = ((result.result as { tools: { name: string }[] }).tools ?? []).map((t) => t.name);

    expect(names).toEqual(expect.arrayContaining(['math.add', 'todos.list', 'todos.get']));
  });

  it('calls a defineTool() module over MCP', async () => {
    const result = await rpc('tools/call', { name: 'math.add', arguments: { a: 2, b: 3 } });
    const content = (result.result as { content: { text: string }[] }).content;
    expect(JSON.parse(content[0].text)).toEqual({ sum: 5 });
  });

  it('calls a scanned route over MCP, replaying it in-process', async () => {
    const result = await rpc('tools/call', { name: 'todos.get', arguments: { id: '7' } });
    const content = (result.result as { content: { text: string }[] }).content;
    expect(JSON.parse(content[0].text)).toEqual({ id: 7 });
  });

  it('serves the built-in health endpoint', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('exports OpenAI-compatible tool definitions', async () => {
    const tools = (await ap.toOpenaiTools()) as Array<{
      type: string;
      function: { name: string };
    }>;

    // OpenAI function names cannot contain dots, so apcore-mcp normalises the
    // module ID separator to a hyphen.
    expect(tools.map((t) => t.function.name)).toEqual(
      expect.arrayContaining(['math-add', 'todos-list']),
    );
    expect(tools.every((t) => t.type === 'function')).toBe(true);
  });
});
