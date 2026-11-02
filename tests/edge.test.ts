import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { apcore, createApcore, defineTool, getApcore } from '../src/edge.js';

describe('edge entry', () => {
  it('runs tools without the Node-only surfaces', async () => {
    const ap = createApcore({
      tools: [
        defineTool({
          namespace: 'edge',
          name: 'echo',
          description: 'Echo an input value',
          inputSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
          handler: (inputs) => ({ value: inputs.value }),
        }),
      ],
    });

    await ap.init();

    const app = new Hono();
    app.use('*', apcore(ap));
    app.get('/echo/:value', async (c) =>
      c.json(await getApcore(c).executor.call('edge.echo', { value: c.req.param('value') })),
    );

    await expect((await app.request('/echo/hi')).json()).resolves.toEqual({ value: 'hi' });
    expect(ap).not.toHaveProperty('mcp');
    expect(ap).not.toHaveProperty('cli');
    expect(ap).not.toHaveProperty('a2a');
    expect(ap).not.toHaveProperty('loadBindings');
  });
});
