// CLI fixture: an app that exports both a Hono app and a configured apcore
// instance — under the name `ap`, not `apcore`, because `apcore` is already
// taken by the middleware import in a real app.
import { Hono } from 'hono';
import { createApcore, defineTool } from '../../src/index.js';

export const app = new Hono();
app.get('/ping', (c) => c.json({ pong: true }));
app.get('/internal-only', (c) => c.json({ secret: true }));

export const ap = createApcore({
  tools: [
    defineTool({
      namespace: 'demo',
      name: 'echo',
      description: 'Echo the input back',
      handler: (inputs) => inputs,
    }),
  ],
  routes: { excludePaths: ['/internal-only'] },
  mcp: { name: 'fixture', logLevel: 'ERROR' },
});
