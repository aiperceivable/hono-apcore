import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { app, ap, initApcore } from './app.js';

const PORT = Number(process.env.PORT ?? 3000);

async function bootstrap(): Promise<void> {
  await initApcore();

  // One port, two protocols: the MCP endpoint, the Tool Explorer UI, and
  // /health are mounted into the same Hono app that serves the REST routes.
  await ap.mountMcp(app, { endpoint: '/mcp' });

  serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, () => {
    const jwt = process.env.JWT_SECRET ? 'enabled (Bearer token required for /mcp)' : 'disabled (set JWT_SECRET to enable)';
    const aclState = existsSync('./acl.yaml') ? 'enabled (anonymous=read-only / bearer=full)' : 'disabled (acl.yaml missing)';
    const sysModules = existsSync('./apcore.yaml') ? 'enabled (health, usage, toggle_feature, manifest)' : 'disabled (create apcore.yaml to enable)';

    console.log('');
    console.log('  hono-apcore demo is running!');
    console.log('');
    console.log(`  REST API     : http://localhost:${PORT}/todos`);
    console.log(`  MCP endpoint : http://localhost:${PORT}/mcp`);
    console.log(`  MCP Explorer : http://localhost:${PORT}/explorer/`);
    console.log(`  Health       : http://localhost:${PORT}/health`);
    console.log('');
    console.log(`  Modules      : ${ap.registry.count} (${ap.registry.list().join(', ')})`);
    console.log(`  JWT auth     : ${jwt}`);
    console.log(`  ACL          : ${aclState}`);
    console.log(`  sys_modules  : ${sysModules}`);
    console.log('');
  });
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
