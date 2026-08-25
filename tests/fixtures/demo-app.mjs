// CLI fixture: a plain Hono app with no apcore wiring at all, exercising the
// zero-intrusion path (`hono-apcore scan ./tests/fixtures/demo-app.mjs`).
import { Hono } from 'hono';

const app = new Hono();

app.get('/todos', (c) => c.json({ todos: [] }));
app.get('/todos/:id', (c) => c.json({ id: c.req.param('id') }));
app.post('/todos', (c) => c.json({ created: true }, 201));

export default app;
