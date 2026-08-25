import { DEFAULT_EXPLORER_PREFIX, DEFAULT_MCP_ENDPOINT, HONO_ALREADY_SENT_HEADER } from '../constants.js';
import type { ApcoreMcpService, McpApp } from './apcore-mcp.service.js';
import type { MountMcpOptions } from '../types.js';

/** The subset of a Hono app used for mounting. */
export interface MountableApp {
  all: (path: string, handler: (c: unknown) => Promise<Response> | Response) => unknown;
}

/**
 * Node bindings `@hono/node-server` puts on `c.env` — the escape hatch that
 * lets a Node-style `(req, res)` handler write the response directly.
 */
interface NodeBindings {
  incoming: unknown;
  outgoing: unknown;
}

/**
 * The sentinel `@hono/node-server` recognises as "the handler already wrote
 * this response itself".
 *
 * Constructed here rather than imported from
 * `@hono/node-server/utils/response` so mounting never makes the Node adapter
 * a hard dependency; the header name is the contract.
 */
export const RESPONSE_ALREADY_SENT: Response = new Response(null, {
  headers: { [HONO_ALREADY_SENT_HEADER]: 'true' },
});

const NODE_ONLY_MESSAGE =
  'mountMcp() needs the Node bindings from @hono/node-server (c.env.incoming / c.env.outgoing). ' +
  'On Workers, Deno, or Bun, run the MCP server standalone with ApcoreMcpService.start() instead.';

function nodeBindings(c: unknown): NodeBindings | null {
  const env = (c as { env?: unknown } | null)?.env;
  if (env === null || typeof env !== 'object') return null;
  const { incoming, outgoing } = env as Partial<NodeBindings>;
  if (!incoming || !outgoing) return null;
  return { incoming, outgoing };
}

/**
 * Wrap `apcore-mcp`'s Node request handler as a Hono handler.
 *
 * The MCP transport speaks Streamable HTTP with SSE, which needs direct
 * control of the response stream — so the handler writes to the Node
 * `ServerResponse` and returns the already-sent sentinel instead of a
 * `Response` Hono would try to serialise itself.
 */
export function toHonoHandler(mcpApp: McpApp): (c: unknown) => Promise<Response> {
  return async (c: unknown): Promise<Response> => {
    const bindings = nodeBindings(c);
    if (!bindings) {
      return new Response(NODE_ONLY_MESSAGE, {
        status: 501,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    await mcpApp.handler(bindings.incoming, bindings.outgoing);
    return RESPONSE_ALREADY_SENT;
  };
}

/**
 * Mount the MCP endpoint — and, when enabled, the Tool Explorer UI and the
 * `/health`, `/metrics`, `/usage` routes — into an existing Hono app.
 *
 * One process, one port: the app keeps serving its own routes while AI
 * clients talk MCP at `endpoint`.
 *
 * **Node runtime only.** The MCP transport needs the raw Node request and
 * response objects that `@hono/node-server` exposes on `c.env`. On other
 * runtimes, run the server standalone with {@link ApcoreMcpService.start}.
 *
 * `endpoint` must be the path as the HTTP server sees it — if the Hono app
 * itself sits under a `basePath`, include that prefix here.
 *
 * @example
 * ```ts
 * import { serve } from '@hono/node-server';
 *
 * await apcore.init();
 * await mountMcp(app, apcore.mcp!, { endpoint: '/mcp', explorer: true });
 * serve({ fetch: app.fetch, port: 3000 });
 * ```
 *
 * @returns The embedded MCP app; call `close()` on shutdown.
 */
export async function mountMcp(
  app: MountableApp,
  service: ApcoreMcpService,
  options: MountMcpOptions = {},
): Promise<McpApp> {
  const endpoint = options.endpoint ?? DEFAULT_MCP_ENDPOINT;
  const explorerPrefix = options.explorerPrefix ?? DEFAULT_EXPLORER_PREFIX;
  const builtinRoutes = options.builtinRoutes ?? true;

  const mcpApp = await service.asyncServe({
    endpoint,
    explorer: options.explorer,
    explorerPrefix,
    allowExecute: options.allowExecute,
  });

  const handler = toHonoHandler(mcpApp);

  app.all(endpoint, handler);

  if (options.explorer) {
    app.all(explorerPrefix, handler);
    app.all(`${explorerPrefix}/*`, handler);
  }

  if (builtinRoutes) {
    // Served by the MCP transport itself: /health and /metrics before auth,
    // /usage after it.
    for (const path of ['/health', '/metrics', '/usage']) {
      app.all(path, handler);
    }
  }

  return mcpApp;
}
