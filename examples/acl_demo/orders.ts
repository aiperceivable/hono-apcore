import { defineToolset } from 'hono-apcore';

/**
 * Orders exposed as apcore modules, governed by acl.yaml:
 *   orders.delete -> admins only
 *   orders.list   -> public (read)
 */
export const orderTools = defineToolset({
  namespace: 'orders',
  description: 'Order management (ACL demo)',
  tags: ['orders'],
  tools: {
    list: {
      description: 'List orders (public read)',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: {
        type: 'object',
        properties: {
          orders: { type: 'array', items: { type: 'object', properties: { id: { type: 'number' } } } },
        },
      },
      annotations: { readonly: true, idempotent: true },
      tags: ['orders', 'query'],
      handler: () => ({ orders: [{ id: 1 }, { id: 2 }] }),
    },

    delete: {
      description: 'Delete an order (admins only)',
      inputSchema: {
        type: 'object',
        properties: { order_id: { type: 'number' } },
        required: ['order_id'],
      },
      outputSchema: { type: 'object', properties: { deleted: { type: 'number' } } },
      annotations: { readonly: false, destructive: true },
      tags: ['orders', 'mutate'],
      handler: (inputs) => ({ deleted: Number(inputs.order_id) }),
    },
  },
});
