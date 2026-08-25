import { Hono } from 'hono';
import { todoStore } from './todo.store.js';

/**
 * REST routes over the same `todoStore` the MCP tools use.
 *
 * These routes are deliberately *not* scanned into apcore modules (see
 * `app.ts`, which excludes `/todos/*`) — the todo surface is already exposed
 * as hand-written tools with proper schemas, and registering it twice would
 * give an AI client two ways to do one thing.
 */
export const todoRoutes = new Hono();

todoRoutes.get('/todos', (c) => c.json(todoStore.list()));

todoRoutes.get('/todos/:id', (c) => {
  const todo = todoStore.get(Number(c.req.param('id')));
  return todo ? c.json(todo) : c.json({ error: 'Todo not found' }, 404);
});

todoRoutes.post('/todos', async (c) => {
  const body = (await c.req.json()) as { title?: string };
  if (!body.title) return c.json({ error: 'title is required' }, 400);
  return c.json(todoStore.add(body.title), 201);
});

todoRoutes.delete('/todos/:id', (c) =>
  c.json({ deleted: todoStore.remove(Number(c.req.param('id'))) }),
);
