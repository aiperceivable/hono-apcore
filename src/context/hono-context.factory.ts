import { Context as ApcoreContext, TraceContext, createIdentity } from 'apcore-js';
import type { Identity, TraceParent } from 'apcore-js';

/**
 * Anything this factory can read request headers from.
 *
 * Covers a Hono `Context` (`c`), a raw web `Request`, a bare `Headers`
 * instance, and the plain header record a Node handler sees — so the same
 * factory serves routes, middleware, and tests.
 */
export type HeaderSource =
  | Headers
  | Request
  | { req: { raw: Request } }
  | { headers: Headers | Record<string, string | string[] | undefined> };

function isHeaders(value: unknown): value is Headers {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Headers).get === 'function' &&
    typeof (value as Headers).forEach === 'function'
  );
}

/**
 * Reduce any {@link HeaderSource} to a `Headers` instance.
 *
 * `Headers` already matches header names case-insensitively, so downstream
 * lookups need no normalisation of their own.
 */
export function toHeaders(source: HeaderSource): Headers {
  if (isHeaders(source)) return source;

  if (source instanceof Request) return source.headers;

  const req = (source as { req?: { raw?: Request } }).req;
  if (req?.raw instanceof Request) return req.raw.headers;

  const raw = (source as { headers?: unknown }).headers;
  if (isHeaders(raw)) return raw;

  const headers = new Headers();
  if (raw !== null && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') {
        headers.set(key, value);
      } else if (Array.isArray(value) && value.length > 0) {
        headers.set(key, String(value[0]));
      }
    }
  }
  return headers;
}

/**
 * Builds apcore `Context` objects from Hono requests.
 *
 * **Identity resolution**, in order:
 *   1. `x-user-id` header
 *   2. `Authorization: Bearer <token>` (identity id `"bearer"`)
 *   3. `x-roles` alone — a demo shortcut for role-based ACL without auth
 *   4. anonymous
 *
 * **W3C Trace Context** — a `traceparent` header supplies the trace id.
 * Strict 32-hex validation and rejection of W3C-invalid ids happen inside
 * `Context.create`, not here (PROTOCOL_SPEC §10.5).
 *
 * **Correlation id** — `x-correlation-id` (or `x-request-id`) is copied into
 * `context.data["x-correlation-id"]` so existing log pipelines keep working.
 *
 * Pass a `resolveIdentity` override to plug in real authentication: whatever
 * it returns wins over the header heuristics above.
 */
export class HonoContextFactory {
  constructor(
    private readonly options: {
      /** Custom identity resolver; returning `null` falls back to the headers. */
      resolveIdentity?: (headers: Headers) => Identity | null;
      /** Extra `context.data` entries merged over the built-in ones. */
      data?: (headers: Headers) => Record<string, unknown>;
    } = {},
  ) {}

  /** Create an apcore `Context` from a Hono context, `Request`, or headers. */
  createContext(source: HeaderSource): ApcoreContext {
    const headers = toHeaders(source);
    const identity = this.extractIdentity(headers);
    const traceParent = this.extractTraceParent(headers);
    const data = {
      ...this.extractData(headers),
      ...(this.options.data?.(headers) ?? {}),
    };
    return ApcoreContext.create(identity, traceParent, null, data);
  }

  private extractTraceParent(headers: Headers): TraceParent | null {
    return TraceContext.extract(headers);
  }

  private extractIdentity(headers: Headers): Identity {
    const custom = this.options.resolveIdentity?.(headers);
    if (custom) return custom;

    const roles = this.extractRoles(headers);

    const userId = headers.get('x-user-id');
    if (userId) {
      return createIdentity(userId, 'user', roles);
    }

    const auth = headers.get('authorization');
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      return createIdentity('bearer', 'api_key', roles);
    }

    // An `x-roles` header on its own still identifies a roled user — a demo
    // shortcut for exercising role-based ACL without full authentication.
    if (roles.length > 0) {
      return createIdentity('u1', 'user', roles);
    }

    return createIdentity('anonymous', 'anonymous');
  }

  /** Parse the comma-separated `x-roles` header into a role list. */
  private extractRoles(headers: Headers): string[] {
    const raw = headers.get('x-roles');
    if (!raw) return [];
    return raw
      .split(',')
      .map((role) => role.trim())
      .filter((role) => role.length > 0);
  }

  private extractData(headers: Headers): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    const correlationId = headers.get('x-correlation-id') ?? headers.get('x-request-id');
    if (correlationId) {
      data['x-correlation-id'] = correlationId;
    }
    return data;
  }
}

/** Shared factory used by the default `apcore()` middleware. */
export const defaultContextFactory = new HonoContextFactory();
