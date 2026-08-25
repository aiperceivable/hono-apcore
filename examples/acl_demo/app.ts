import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { ACL, ACLDeniedError } from 'apcore-js';
import { apcore, createApcore, getApcore, getApcoreContext } from 'hono-apcore';
import type { Context as HonoContext } from 'hono';
import { orderTools } from './orders.js';

// Load the demo ACL by absolute path so enforcement does not depend on the
// process working directory (ACL.discover() reads apcore.yaml from the CWD).
const here = dirname(fileURLToPath(import.meta.url));
const acl = ACL.load(join(here, 'acl.yaml'));

export const ap = createApcore({ acl, tools: orderTools });

/**
 * Route handlers call the module through the Executor rather than calling the
 * business logic directly — that is what puts the route under apcore ACL.
 * A denied call raises ACLDeniedError, which maps to HTTP 403.
 */
async function call(
  c: HonoContext,
  moduleId: string,
  inputs: Record<string, unknown>,
): Promise<Response> {
  try {
    const result = await getApcore(c).executor.call(moduleId, inputs, getApcoreContext(c));
    return c.json(result);
  } catch (err) {
    if (err instanceof ACLDeniedError) {
      return c.json({ error: String(err.message) }, 403);
    }
    throw err;
  }
}

export const app = new Hono();

app.use('*', apcore(ap));

app.get('/orders', (c) => call(c, 'orders.list', {}));
app.delete('/orders/:id', (c) =>
  call(c, 'orders.delete', { order_id: Number(c.req.param('id')) }),
);
