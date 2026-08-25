import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createIdentity } from 'apcore-js';
import { createApcore } from '../../src/core/apcore.js';
import { apcore, getApcore, getApcoreContext } from '../../src/core/middleware.js';
import { HonoContextFactory } from '../../src/context/hono-context.factory.js';
import { defineTool } from '../../src/tools/define-tool.js';

const whoami = defineTool({
  namespace: 'demo',
  name: 'whoami',
  description: 'Report the caller',
  handler: (_inputs, context) => ({
    caller: (context as { identity?: { id: string } } | undefined)?.identity?.id ?? 'none',
  }),
});

describe('apcore() middleware', () => {
  it('puts the instance and a request Context on the Hono context', async () => {
    const ap = createApcore();
    const app = new Hono();
    app.use('*', apcore(ap));
    app.get('/', (c) => c.json({ same: getApcore(c) === ap, caller: getApcoreContext(c).identity?.id }));

    const response = await app.request('/', { headers: { 'x-user-id': 'alice' } });
    expect(await response.json()).toEqual({ same: true, caller: 'alice' });
  });

  it('threads the request Context into a module call', async () => {
    const ap = createApcore({ tools: [whoami] });
    await ap.init();

    const app = new Hono();
    app.use('*', apcore(ap));
    app.get('/who', async (c) =>
      c.json(await getApcore(c).executor.call('demo.whoami', {}, getApcoreContext(c))),
    );

    const response = await app.request('/who', { headers: { 'x-user-id': 'alice' } });
    expect(await response.json()).toEqual({ caller: 'alice' });
  });

  it('skips the Context when asked', async () => {
    const app = new Hono();
    app.use('*', apcore(createApcore(), { skipContext: true }));
    app.get('/', (c) => {
      expect(() => getApcoreContext(c)).toThrow(/without skipContext/);
      return c.text('ok');
    });

    expect(await (await app.request('/')).text()).toBe('ok');
  });

  it('uses a custom context factory', async () => {
    const app = new Hono();
    app.use(
      '*',
      apcore(createApcore(), {
        contextFactory: new HonoContextFactory({
          resolveIdentity: () => createIdentity('svc', 'service'),
        }),
      }),
    );
    app.get('/', (c) => c.json({ caller: getApcoreContext(c).identity?.id }));

    expect(await (await app.request('/')).json()).toEqual({ caller: 'svc' });
  });

  it('builds and initialises an instance from plain options', async () => {
    const app = new Hono();
    app.use('*', apcore({ tools: [whoami] }));
    app.get('/', (c) => c.json({ modules: getApcore(c).registry.list() }));

    expect(await (await app.request('/')).json()).toEqual({ modules: ['demo.whoami'] });
  });

  it('reuses the lazily built instance across requests', async () => {
    const app = new Hono();
    const seen = new Set<unknown>();
    app.use('*', apcore({ tools: [whoami] }));
    app.get('/', (c) => {
      seen.add(getApcore(c));
      return c.text('ok');
    });

    await app.request('/');
    await app.request('/');
    expect(seen.size).toBe(1);
  });

  it('works with no arguments at all', async () => {
    const app = new Hono();
    app.use('*', apcore());
    app.get('/', (c) => c.json({ count: getApcore(c).registry.count }));

    expect(await (await app.request('/')).json()).toEqual({ count: 0 });
  });
});

describe('getApcore / getApcoreContext', () => {
  it('explain themselves when the middleware never ran', async () => {
    const app = new Hono();
    app.get('/instance', (c) => {
      expect(() => getApcore(c)).toThrow(/Install the apcore\(\) middleware/);
      return c.text('ok');
    });
    app.get('/context', (c) => {
      expect(() => getApcoreContext(c)).toThrow(/No apcore Context/);
      return c.text('ok');
    });

    expect((await app.request('/instance')).status).toBe(200);
    expect((await app.request('/context')).status).toBe(200);
  });
});
