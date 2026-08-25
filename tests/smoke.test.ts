import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { apcore, createApcore, defineTool, getApcore } from '../src/index.js';

describe('smoke', () => {
  it('wires a Hono app end to end in a handful of lines', async () => {
    const app = new Hono();
    app.get('/health', (c) => c.json({ ok: true }));

    const ap = createApcore({
      tools: [
        defineTool({
          namespace: 'greet',
          name: 'hello',
          description: 'Greet someone by name',
          inputSchema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
          handler: (inputs) => ({ message: `Hello, ${String(inputs.name)}!` }),
        }),
      ],
    });

    app.use('*', apcore(ap));
    app.get('/greet/:name', async (c) =>
      c.json(await getApcore(c).executor.call('greet.hello', { name: c.req.param('name') })),
    );

    await ap.init(app);

    expect(ap.registry.list().sort()).toEqual(['greet.hello', 'greet.get', 'health.list'].sort());
    expect(await (await app.request('/greet/world')).json()).toEqual({
      message: 'Hello, world!',
    });
    await expect(ap.executor.call('health.list', {})).resolves.toEqual({ ok: true });
  });
});
