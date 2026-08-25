import { ModuleExecuteError, TraceContext, matchPattern } from 'apcore-js';
import type { Context as ApcoreContext } from 'apcore-js';
import {
  BaseScanner,
  createScannedModule,
  extractPathParamNames,
  generateSuggestedAlias,
  substitutePathParams,
} from 'apcore-toolkit';
import type { ScannedModule } from 'apcore-toolkit';
import { defaultSchemaExtractor } from '../schema/schema-extractor.js';
import { applyModulePrefix } from '../utils/id-generator.js';
import { normalizeResult, toModuleAnnotations } from '../utils/module-factory.js';
import type { BoundExecuteFn } from '../utils/module-factory.js';
import type { RouteOverride, RouteScanOptions } from '../types.js';

/**
 * The slice of Hono's app surface the scanner needs.
 *
 * Typed structurally so the scanner works with any `Hono<Env>` instantiation
 * without dragging Hono's generics through this package's public API.
 */
export interface HonoAppLike {
  routes: Array<{ path: string; method: string; handler: unknown }>;
  /**
   * Hono's own `request()` takes two further optional arguments (`Env` and
   * `ExecutionContext`); they are omitted here so any `Hono<Env>` remains
   * structurally assignable regardless of its bindings.
   */
  request: (input: Request | string | URL, init?: RequestInit) => Response | Promise<Response>;
}

/** Methods skipped unless the caller opts back in. */
const DEFAULT_EXCLUDED_METHODS = ['HEAD', 'OPTIONS'];

/** Methods whose inputs are carried in a request body rather than the query. */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** Base URL used when replaying a route through `app.request()`. */
const DEFAULT_BASE_URL = 'http://localhost';

function methodKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchPattern(pattern, path));
}

/**
 * Build the JSON Schema for a route: one required string property per path
 * parameter, plus a free-form `query` or `body` object depending on method.
 */
function buildRouteInputSchema(method: string, path: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const name of extractPathParamNames(path)) {
    properties[name] = {
      type: 'string',
      description: `Path parameter "${name}" of ${path}`,
    };
    required.push(name);
  }

  if (BODY_METHODS.has(method.toUpperCase())) {
    properties['body'] = {
      type: 'object',
      description: 'JSON request body.',
      additionalProperties: true,
    };
  } else {
    properties['query'] = {
      type: 'object',
      description: 'Query-string parameters.',
      additionalProperties: { type: 'string' },
    };
  }

  const schema: Record<string, unknown> = { type: 'object', properties };
  if (required.length > 0) schema['required'] = required;
  return schema;
}

/**
 * Propagate identity and W3C trace headers from the apcore `Context` onto the
 * replayed request, so route-level auth and ACL see the original caller.
 */
function contextHeaders(context: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  const ctx = context as ApcoreContext | null | undefined;
  if (!ctx) return headers;

  const identity = ctx.identity;
  if (identity) {
    if (identity.id) headers['x-user-id'] = identity.id;
    if (identity.roles?.length) headers['x-roles'] = identity.roles.join(',');
  }

  try {
    Object.assign(headers, TraceContext.inject(ctx));
  } catch {
    // A context without a usable trace id simply carries no trace headers.
  }

  return headers;
}

/** Turn a Response into the plain object a module must return. */
async function responseToResult(response: Response, moduleId: string): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('json');
  const payload: unknown = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const detail =
      typeof payload === 'string' ? payload : JSON.stringify(payload);
    throw new ModuleExecuteError(
      moduleId,
      `route responded ${response.status} ${response.statusText}: ${detail}`,
    );
  }

  return normalizeResult(payload);
}

/**
 * Scans a Hono app's route table and turns each route into an apcore module.
 *
 * Registered modules replay the route in-process through `app.request()`, so
 * middleware, validators, and error handlers all run exactly as they do for a
 * real HTTP request — no duplicated business logic, no second code path.
 *
 * Behavioural annotations are inferred from the HTTP method per RFC 9110
 * safe-method semantics (`GET` → readonly + cacheable, `DELETE` →
 * destructive, `PUT` → idempotent).
 */
export class HonoRouteScanner extends BaseScanner {
  getSourceName(): string {
    return 'hono-routes';
  }

  /**
   * Scan the app's routes into toolkit `ScannedModule` intermediates.
   *
   * Use {@link scanWithExecutors} when you also need the bound execute
   * functions — `scan()` returns serialisable metadata only, which is what
   * the `scan` CLI command and YAML binding export want.
   */
  scan(app: HonoAppLike, options: RouteScanOptions = {}): ScannedModule[] {
    return this.scanWithExecutors(app, options).map((entry) => entry.module);
  }

  /**
   * Scan the app's routes, returning each module together with the execute
   * function that replays it through `app.request()`.
   */
  scanWithExecutors(
    app: HonoAppLike,
    options: RouteScanOptions = {},
  ): Array<{ module: ScannedModule; execute: BoundExecuteFn }> {
    const {
      modulePrefix,
      includePaths = [],
      excludePaths = [],
      excludeMethods = DEFAULT_EXCLUDED_METHODS,
      include,
      exclude,
      tags = ['http'],
      overrides = {},
      baseUrl = DEFAULT_BASE_URL,
    } = options;

    const excludedMethods = new Set(excludeMethods.map((m) => m.toUpperCase()));
    const entries: Array<{ module: ScannedModule; execute: BoundExecuteFn }> = [];
    const seen = new Set<string>();

    for (const route of app.routes) {
      const method = route.method.toUpperCase();
      const path = route.path;

      // `app.use()` registers middleware as method `ALL`; it is not a callable
      // endpoint, and duplicate (method, path) pairs are the same endpoint
      // wrapped by several handlers.
      if (method === 'ALL') continue;
      if (excludedMethods.has(method)) continue;

      const key = methodKey(method, path);
      if (seen.has(key)) continue;
      seen.add(key);

      if (includePaths.length > 0 && !matchesAny(path, includePaths)) continue;
      if (excludePaths.length > 0 && matchesAny(path, excludePaths)) continue;

      const override: RouteOverride = overrides[key] ?? {};
      if (override.skip) continue;

      entries.push(this.buildEntry(app, method, path, override, {
        modulePrefix,
        tags,
        baseUrl,
      }));
    }

    // Deduplicate and filter while keeping each module paired with its
    // executor. `deduplicateIds` maps 1:1 and preserves order, so index
    // alignment with `entries` still holds after it renames a collision.
    const deduped = this.deduplicateIds(entries.map((entry) => entry.module));
    let paired = deduped.map((module, index) => ({
      module,
      execute: entries[index]!.execute,
    }));

    if (include || exclude) {
      const kept = new Set(
        this.filterModules(deduped, include, exclude).map((module) => module.moduleId),
      );
      paired = paired.filter((entry) => kept.has(entry.module.moduleId));
    }

    return paired;
  }

  private buildEntry(
    app: HonoAppLike,
    method: string,
    path: string,
    override: RouteOverride,
    config: { modulePrefix?: string; tags: string[]; baseUrl: string },
  ): { module: ScannedModule; execute: BoundExecuteFn } {
    const alias = generateSuggestedAlias(path, method);
    const moduleId = applyModulePrefix(override.id ?? alias, config.modulePrefix);

    const inputSchema = override.inputSchema
      ? defaultSchemaExtractor.extractJsonSchema(override.inputSchema)
      : buildRouteInputSchema(method, path);

    const outputSchema = override.outputSchema
      ? defaultSchemaExtractor.extractJsonSchema(override.outputSchema)
      : { type: 'object', properties: {}, additionalProperties: true };

    const module = createScannedModule({
      moduleId,
      description: override.description ?? `${method} ${path}`,
      inputSchema,
      outputSchema,
      tags: [...new Set([...config.tags, ...(override.tags ?? [])])],
      target: methodKey(method, path),
      annotations:
        toModuleAnnotations(override.annotations) ??
        BaseScanner.inferAnnotationsFromMethod(method),
      documentation: override.documentation ?? null,
      suggestedAlias: alias,
      examples: override.examples ?? [],
      metadata: { http_method: method, http_path: path },
    });

    const execute: BoundExecuteFn = async (inputs, context) => {
      const url = buildRequestUrl(path, method, inputs, config.baseUrl);
      const headers: Record<string, string> = contextHeaders(context);

      const init: RequestInit = { method, headers };
      if (BODY_METHODS.has(method)) {
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify(inputs['body'] ?? {});
      }

      const response = await app.request(url, init);
      return responseToResult(response, moduleId);
    };

    return { module, execute };
  }
}

/**
 * Substitute path parameters and append the query string, producing the URL
 * handed to `app.request()`.
 */
export function buildRequestUrl(
  path: string,
  method: string,
  inputs: Record<string, unknown>,
  baseUrl: string,
): string {
  const concrete = substitutePathParams(path, inputs);
  const url = new URL(concrete, baseUrl);

  if (!BODY_METHODS.has(method.toUpperCase())) {
    const query = inputs['query'];
    if (query !== null && typeof query === 'object' && !Array.isArray(query)) {
      for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
  }

  return url.toString();
}
