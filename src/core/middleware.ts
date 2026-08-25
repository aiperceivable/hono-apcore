import type { Context as HonoContext, MiddlewareHandler } from 'hono';
import type { Context as ApcoreContext } from 'apcore-js';
import { APCORE_CONTEXT_VAR, APCORE_VAR } from '../constants.js';
import { HonoContextFactory } from '../context/hono-context.factory.js';
import type { HonoApcore } from './apcore.js';
import type { HonoApcoreOptions } from '../types.js';

declare module 'hono' {
  interface ContextVariableMap {
    /** The {@link HonoApcore} instance installed by the `apcore()` middleware. */
    apcore: HonoApcore;
    /** The per-request apcore `Context` (identity, trace, correlation id). */
    apcoreContext: ApcoreContext;
  }
}

/** Options for the {@link apcore} middleware. */
export interface ApcoreMiddlewareOptions {
  /** Factory used to build the per-request apcore `Context`. */
  contextFactory?: HonoContextFactory;
  /**
   * Skip building a per-request `Context`. Set this when a route never calls
   * modules through the executor and you want to shave the work.
   */
  skipContext?: boolean;
}

/**
 * Hono middleware that puts the apcore instance and a per-request apcore
 * `Context` on the Hono context.
 *
 * Downstream handlers read them with {@link getApcore} and
 * {@link getApcoreContext} — or, since the variable map is augmented,
 * directly via `c.get('apcore')`.
 *
 * @example
 * ```ts
 * const ap = createApcore({ mcp: { explorer: true } });
 * app.use('*', apcore(ap));
 *
 * app.get('/orders', async (c) => {
 *   const result = await getApcore(c).executor.call('orders.list', {}, getApcoreContext(c));
 *   return c.json(result);
 * });
 * ```
 *
 * @param instance - An existing {@link HonoApcore}, or options to build one.
 *   Passing options is a convenience for simple apps; keep a reference to the
 *   instance when you need to register tools or mount MCP.
 */
export function apcore(
  instance: HonoApcore,
  options?: ApcoreMiddlewareOptions,
): MiddlewareHandler;
export function apcore(
  options?: HonoApcoreOptions & ApcoreMiddlewareOptions,
): MiddlewareHandler;
export function apcore(
  instanceOrOptions?: HonoApcore | (HonoApcoreOptions & ApcoreMiddlewareOptions),
  maybeOptions?: ApcoreMiddlewareOptions,
): MiddlewareHandler {
  // Resolved lazily so this module never imports the class eagerly — that
  // would make apcore.ts and middleware.ts a hard import cycle.
  const isInstance =
    instanceOrOptions !== undefined &&
    typeof (instanceOrOptions as HonoApcore).registerTool === 'function';

  const instance = isInstance ? (instanceOrOptions as HonoApcore) : undefined;
  const options = (isInstance ? maybeOptions : instanceOrOptions) as
    | (HonoApcoreOptions & ApcoreMiddlewareOptions)
    | undefined;

  let resolved: HonoApcore | undefined = instance;
  const contextFactory = options?.contextFactory ?? new HonoContextFactory();
  const skipContext = options?.skipContext ?? false;

  return async function apcoreMiddleware(c, next) {
    if (!resolved) {
      const { HonoApcore: Ctor } = await import('./apcore.js');
      resolved = new Ctor(options ?? {});
      await resolved.init();
    }

    await resolved.ready();

    c.set(APCORE_VAR, resolved);
    if (!skipContext) {
      c.set(APCORE_CONTEXT_VAR, contextFactory.createContext(c));
    }

    await next();
  };
}

/**
 * Read the {@link HonoApcore} instance the `apcore()` middleware installed.
 *
 * @throws {Error} When the middleware has not run for this request.
 */
export function getApcore(c: HonoContext): HonoApcore {
  const instance = c.get(APCORE_VAR);
  if (!instance) {
    throw new Error(
      'No apcore instance on the Hono context. Install the apcore() middleware before this route.',
    );
  }
  return instance;
}

/**
 * Read the per-request apcore `Context` the `apcore()` middleware built.
 *
 * @throws {Error} When the middleware has not run, or ran with `skipContext`.
 */
export function getApcoreContext(c: HonoContext): ApcoreContext {
  const context = c.get(APCORE_CONTEXT_VAR);
  if (!context) {
    throw new Error(
      'No apcore Context on the Hono context. Install the apcore() middleware without skipContext.',
    );
  }
  return context;
}
