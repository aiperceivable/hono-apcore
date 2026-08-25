/**
 * Hono context variable key holding the {@link HonoApcore} instance.
 *
 * Read it with `c.get(APCORE_VAR)` — or, with types, via `getApcore(c)`.
 */
export const APCORE_VAR = 'apcore' as const;

/**
 * Hono context variable key holding the per-request apcore `Context`
 * built by {@link HonoContextFactory}.
 */
export const APCORE_CONTEXT_VAR = 'apcoreContext' as const;

/** Default path the embedded MCP endpoint is mounted at. */
export const DEFAULT_MCP_ENDPOINT = '/mcp';

/** Default URL prefix for the MCP Tool Explorer UI. */
export const DEFAULT_EXPLORER_PREFIX = '/explorer';

/**
 * Sentinel header `@hono/node-server` looks for to learn that a handler has
 * already written the response directly to the Node `ServerResponse`.
 *
 * Mirrors `RESPONSE_ALREADY_SENT` from `@hono/node-server/utils/response`;
 * inlined so mounting MCP does not force a hard dependency on the Node
 * adapter in edge builds.
 */
export const HONO_ALREADY_SENT_HEADER = 'x-hono-already-sent';

/** Environment-variable prefix for all `APCORE_*` settings. */
export const APCORE_ENV_PREFIX = 'APCORE_';
