import { Hono } from 'hono';
import { ACL, Config, registerSysModules } from 'apcore-js';
import { JWTAuthenticator } from 'apcore-mcp';
import { apcore, createApcore } from 'hono-apcore';
import { todoRoutes } from './todo/todo.routes.js';
import { todoTools } from './todo/todo.tools.js';
import { weatherRoutes } from './weather/weather.routes.js';

// --- Config + ACL ----------------------------------------------------------
// Config.discover() finds apcore.yaml from the process CWD; ACL.discover()
// reads acl.root from it. Both return null when the file is absent, which
// means "no enforcement".
const config = Config.discover();
const acl = ACL.discover(config) ?? undefined;
if (acl) {
  console.log('[ACL] Loaded from apcore.yaml acl.root (default_effect=deny)');
}

// --- JWT (optional) --------------------------------------------------------
const jwtSecret = process.env.JWT_SECRET;
const authenticator = jwtSecret ? new JWTAuthenticator({ secret: jwtSecret }) : undefined;

// --- apcore instance -------------------------------------------------------
export const ap = createApcore({
  acl,
  // Hand-written tools: full schemas, explicit annotations, ACL-friendly ids.
  tools: todoTools,
  // Route scanning: everything else becomes a tool with no code changes.
  // The todo routes are excluded because todoTools already covers them.
  routes: {
    excludePaths: ['/', '/todos*', '/health', '/mcp*', '/explorer*', '/metrics', '/usage'],
  },
  mcp: {
    name: 'hono-apcore-demo',
    version: '0.1.0',
    explorer: true,
    allowExecute: true,
    authenticator,
  },
});

// --- Hono app --------------------------------------------------------------
export const app = new Hono();

app.use('*', apcore(ap));
app.route('/', todoRoutes);
app.route('/', weatherRoutes);

app.get('/', (c) =>
  c.json({
    name: 'hono-apcore-demo',
    modules: ap.registry.list(),
    docs: { explorer: '/explorer/', mcp: '/mcp', rest: '/todos' },
  }),
);

/**
 * Register the tools, scan the routes, and register the apcore system modules
 * (`sys.health`, `sys.usage`, `sys.manifest`, ...).
 *
 * Kept separate from module construction so `main.ts` can await it before the
 * server starts listening, and so the CLI can drive the same app.
 */
export async function initApcore(): Promise<void> {
  await ap.init(app);
  registerSysModules(ap.registry.raw, ap.executor.raw, config);
}
