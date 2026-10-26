import { Hono } from 'hono';
import { createApcore } from '../../src/index.js';

export const app = new Hono();
export const ap = createApcore({
  tools: [{
    id: 'stdio.noisy', description: 'Verify SDK output isolation',
    handler: () => {
      console.log('module console diagnostic');
      process.stdout.write('module direct diagnostic\n');
      return { done: true };
    },
  }],
  mcp: {
    name: 'sdk-stdio-fixture',
    onStartup: () => { console.log('startup diagnostic'); },
    onShutdown: () => { console.log('shutdown diagnostic'); },
  },
});
