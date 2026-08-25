import { serve } from '@hono/node-server';
import { app, ap } from './app.js';

const PORT = Number(process.env.PORT ?? 3000);

/**
 * Bootstrap the ACL demo as a standalone HTTP server.
 *
 *   npx tsx examples/acl_demo/main.ts
 *
 *   curl -X DELETE localhost:3000/orders/1                       # 403 (anonymous)
 *   curl -X DELETE localhost:3000/orders/1 -H 'X-Roles: user'    # 403 (not admin)
 *   curl -X DELETE localhost:3000/orders/1 -H 'X-Roles: admin'   # 200
 *   curl localhost:3000/orders                                   # 200 (read is public)
 */
async function bootstrap(): Promise<void> {
  await ap.init();

  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`hono-apcore ACL demo listening on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
