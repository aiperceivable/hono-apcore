import { Hono } from 'hono';
import { createApcore } from '../../src/index.js';

export const app = new Hono();
export const ap = createApcore({
  tools: [{
    id: 'demo.display', description: 'Display test',
    display: { alias: 'display', mcp: { alias: '9 display.tool' } },
    handler: () => ({ done: true }),
  }],
  mcp: { name: 'display-fixture', logLevel: 'ERROR' },
});
