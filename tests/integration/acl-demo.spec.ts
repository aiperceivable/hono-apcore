import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import { ACL, ACLDeniedError } from 'apcore-js';
import { apcore, createApcore, defineToolset, getApcore, getApcoreContext } from '../../src/index.js';

/**
 * The `orders.delete` (admins only) / `orders.list` (public read) contract
 * every apcore framework integration demonstrates, expressed with Hono
 * routes that call the modules through the Executor.
 */
function buildApp(): Hono {
  const acl = new ACL(
    [
      {
        description: 'Admins may call any module',
        callers: ['*'],
        targets: ['*'],
        effect: 'allow',
        conditions: { roles: ['admin'] },
      },
      {
        description: 'Anyone, including anonymous, may read the order list',
        callers: ['*'],
        targets: ['orders.list'],
        effect: 'allow',
      },
    ],
    'deny',
  );

  const ap = createApcore({
    acl,
    tools: defineToolset({
      namespace: 'orders',
      tags: ['orders'],
      tools: {
        list: {
          description: 'List orders (public read)',
          annotations: { readonly: true, idempotent: true },
          handler: () => ({ orders: [{ id: 1 }, { id: 2 }] }),
        },
        delete: {
          description: 'Delete an order (admins only)',
          annotations: { readonly: false, destructive: true },
          handler: (inputs) => ({ deleted: Number(inputs.order_id) }),
        },
      },
    }),
  });

  const app = new Hono();
  app.use('*', apcore(ap));

  const call = async (c: HonoContext, moduleId: string, inputs: Record<string, unknown>) => {
    try {
      return c.json(await getApcore(c).executor.call(moduleId, inputs, getApcoreContext(c)));
    } catch (err) {
      if (err instanceof ACLDeniedError) return c.json({ error: err.message }, 403);
      throw err;
    }
  };

  app.get('/orders', (c) => call(c, 'orders.list', {}));
  app.delete('/orders/:id', (c) =>
    call(c, 'orders.delete', { order_id: Number(c.req.param('id')) }),
  );

  void ap.init();
  return app;
}

describe('ACL demo', () => {
  it('denies an anonymous delete', async () => {
    const response = await buildApp().request('/orders/1', { method: 'DELETE' });
    expect(response.status).toBe(403);
  });

  it('denies a non-admin delete', async () => {
    const response = await buildApp().request('/orders/1', {
      method: 'DELETE',
      headers: { 'X-Roles': 'user' },
    });
    expect(response.status).toBe(403);
  });

  it('allows an admin delete', async () => {
    const response = await buildApp().request('/orders/1', {
      method: 'DELETE',
      headers: { 'X-Roles': 'admin' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 1 });
  });

  it('allows anyone to read the order list', async () => {
    const app = buildApp();

    const anonymous = await app.request('/orders');
    expect(anonymous.status).toBe(200);
    expect(await anonymous.json()).toEqual({ orders: [{ id: 1 }, { id: 2 }] });

    const admin = await app.request('/orders', { headers: { 'X-Roles': 'admin' } });
    expect(admin.status).toBe(200);
  });
});
