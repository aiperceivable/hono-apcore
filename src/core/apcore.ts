import { Executor, Registry } from 'apcore-js';
import type { ACL, Middleware } from 'apcore-js';
import { ApcoreRegistry } from './registry.js';
import { ApcoreExecutor } from './executor.js';
import { ApcoreMcpService } from '../mcp/apcore-mcp.service.js';
import { ApcoreCliService } from '../cli/apcore-cli.service.js';
import { ApcoreA2aService } from '../a2a/apcore-a2a.service.js';
import { HonoContextFactory } from '../context/hono-context.factory.js';
import { HonoRouteScanner } from '../scanners/hono-route-scanner.js';
import type { HonoAppLike } from '../scanners/hono-route-scanner.js';
import { ApBindingLoader } from '../bridge/binding-loader.js';
import type { TargetResolver } from '../bridge/binding-loader.js';
import { mountMcp as mountMcpEndpoint } from '../mcp/mount.js';
import type { MountableApp } from '../mcp/mount.js';
import type { McpApp } from '../mcp/apcore-mcp.service.js';
import { loadSettings, toMcpTransport } from '../config.js';
import type { ApcoreSettings } from '../config.js';
import type {
  ApToolDefinition,
  HonoApcoreOptions,
  MountMcpOptions,
  RegisterMethodOptions,
  RegisterObjectOptions,
  RouteScanOptions,
} from '../types.js';

/**
 * The single entry point for wiring apcore into a Hono app.
 *
 * Owns the apcore `Registry` and `Executor`, the tool/route registration
 * surface, and the optional MCP, CLI, and A2A services. Everything else in
 * this package hangs off an instance of this class.
 *
 * @example
 * ```ts
 * const ap = createApcore({
 *   tools: [listTodos, addTodo],
 *   mcp: { explorer: true, allowExecute: true },
 * });
 *
 * app.use('*', apcore(ap));
 * await ap.init(app);                 // register tools, scan routes
 * await ap.mountMcp(app);             // serve MCP on the same port
 * ```
 */
export class HonoApcore {
  /** Canonical `APCORE_*` settings, environment merged with `options.settings`. */
  readonly settings: ApcoreSettings;

  /** Registry wrapper — register and inspect modules. */
  readonly registry: ApcoreRegistry;

  /** Executor wrapper — `call()`, `stream()`, `validate()`. */
  readonly executor: ApcoreExecutor;

  /** Builds per-request apcore `Context` objects from Hono requests. */
  readonly contextFactory: HonoContextFactory;

  private readonly _mcp: ApcoreMcpService | null;
  private readonly _cli: ApcoreCliService | null;
  private readonly _a2a: ApcoreA2aService | null;
  private readonly scanner = new HonoRouteScanner();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly options: HonoApcoreOptions = {}) {
    this.settings = loadSettings(undefined, options.settings);

    const registry = new Registry({ extensionsDir: options.extensionsDir ?? null });
    const executor = new Executor({
      registry,
      acl: (options.acl as ACL | null) ?? null,
      middlewares: (options.middleware as Middleware[]) ?? null,
    });

    this.registry = new ApcoreRegistry(registry);
    this.executor = new ApcoreExecutor(executor);
    this.contextFactory = new HonoContextFactory();

    this._mcp = options.mcp
      ? new ApcoreMcpService(this.registry, this.executor, {
          ...options.mcp,
          // The APCORE_* settings supply the defaults; explicit config wins.
          transport: options.mcp.transport ?? toMcpTransport(this.settings.transport),
          host: options.mcp.host ?? this.settings.host,
          port: options.mcp.port ?? this.settings.port,
        })
      : null;

    this._cli = options.cli ? new ApcoreCliService(this.registry, options.cli) : null;
    this._a2a = options.a2a
      ? new ApcoreA2aService(this.registry, this.executor, options.a2a)
      : null;
  }

  // -------------------------------------------------------------------------
  // Surfaces
  // -------------------------------------------------------------------------

  /**
   * The route-scan options this instance would use: the `APCORE_*` settings
   * with the constructor's `routes` block layered on top.
   *
   * The `hono-apcore` CLI reads this so `scan` against a configured entry
   * produces the same module set the app itself registers.
   */
  get routeOptions(): RouteScanOptions {
    return this.mergeRouteOptions();
  }

  /** The MCP service, or `null` when `options.mcp` was omitted. */
  get mcp(): ApcoreMcpService | null {
    return this._mcp;
  }

  /** The CLI service, or `null` when `options.cli` was omitted. */
  get cli(): ApcoreCliService | null {
    return this._cli;
  }

  /** The A2A service, or `null` when `options.a2a` was omitted. */
  get a2a(): ApcoreA2aService | null {
    return this._a2a;
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /** Register one tool definition. Returns its module ID. */
  registerTool(tool: ApToolDefinition): Promise<string> {
    return this.registry.registerTool(tool, { modulePrefix: this.settings.modulePrefix });
  }

  /** Register several tool definitions. Returns their module IDs. */
  registerTools(tools: ApToolDefinition[]): Promise<string[]> {
    return this.registry.registerTools(tools, { modulePrefix: this.settings.modulePrefix });
  }

  /** Register a single method of a service object as a module. */
  registerMethod(options: RegisterMethodOptions): Promise<string> {
    return this.registry.registerMethod(options);
  }

  /** Register several — or all — methods of a service object. */
  registerObject(options: RegisterObjectOptions): Promise<string[]> {
    return this.registry.registerObject(options);
  }

  /**
   * Scan a Hono app's route table and register every matching route as a
   * module that replays the route in-process via `app.request()`.
   *
   * Options are merged over the `routes` block from the constructor and the
   * `APCORE_INCLUDE_PATHS` / `APCORE_EXCLUDE_PATHS` / `APCORE_MODULE_PREFIX`
   * settings.
   *
   * @returns The module IDs that were registered.
   */
  async scanRoutes(app: HonoAppLike, options: RouteScanOptions = {}): Promise<string[]> {
    const merged = this.mergeRouteOptions(options);

    const ids: string[] = [];
    for (const { module, execute } of this.scanner.scanWithExecutors(app, merged)) {
      try {
        ids.push(await this.registry.registerScanned(module, execute));
      } catch (err) {
        // A path segment can collide with a reserved namespace ("internal",
        // "system", ...) or otherwise fail §2.7 validation. Name the route so
        // the fix is obvious instead of surfacing a bare module-ID error.
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Cannot register route ${module.target} as module "${module.moduleId}": ${reason}. ` +
            'Give it an explicit id via routes.overrides, or drop it with routes.excludePaths.',
          { cause: err },
        );
      }
    }
    return ids;
  }

  /**
   * Load a YAML bindings file and register its entries.
   *
   * @param filePath - Path to the YAML file. Defaults to `options.bindings`.
   * @param resolveTarget - Resolves each entry's `target` to a live handler.
   */
  async loadBindings(filePath?: string, resolveTarget?: TargetResolver): Promise<string[]> {
    const path = filePath ?? this.options.bindings;
    if (!path) return [];
    return new ApBindingLoader(this.registry, resolveTarget).loadFromFile(path);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Discover extensions, register the configured tools and bindings, scan the
   * app's routes, and start any surface configured to run standalone.
   *
   * Idempotent: repeat calls await the first one instead of registering twice.
   * When `APCORE_ENABLED` is false, this resolves without doing anything.
   *
   * @param app - Hono app whose routes should be scanned. Omit to skip scanning.
   * @param routeOptions - Route-scan overrides for this call.
   */
  init(app?: HonoAppLike, routeOptions?: RouteScanOptions): Promise<void> {
    this.initPromise ??= this.runInit(app, routeOptions);
    return this.initPromise;
  }

  /**
   * Await an in-flight {@link init}. Resolves immediately when init has not
   * been called — the middleware uses it to avoid racing a slow startup.
   */
  async ready(): Promise<void> {
    await this.initPromise;
  }

  /** Layer the `APCORE_*` settings, the constructor options, and a per-call override. */
  private mergeRouteOptions(options: RouteScanOptions = {}): RouteScanOptions {
    return {
      modulePrefix: this.settings.modulePrefix || undefined,
      includePaths: this.settings.includePaths,
      excludePaths: this.settings.excludePaths,
      ...this.options.routes,
      ...options,
    };
  }

  private async runInit(app?: HonoAppLike, routeOptions?: RouteScanOptions): Promise<void> {
    if (!this.settings.enabled) return;

    if (this.options.extensionsDir) {
      await this.registry.discover();
    }

    if (this.options.tools?.length) {
      await this.registerTools(this.options.tools);
    }

    if (this.options.bindings) {
      await this.loadBindings();
    }

    if (app) {
      await this.scanRoutes(app, routeOptions);
    }

    // Surfaces start last, so every module is registered before a client can
    // list the tools.
    if (this._a2a && this.options.a2a?.port !== undefined) {
      await this._a2a.start();
    }

    if (this._mcp && this.options.mcp?.transport) {
      await this._mcp.start();
    }
  }

  /**
   * Mount the MCP endpoint into the Hono app so one port serves both HTTP and
   * MCP. Node runtime only — see {@link mountMcp}.
   *
   * @throws {Error} When the instance was created without `options.mcp`.
   */
  async mountMcp(app: MountableApp, options: MountMcpOptions = {}): Promise<McpApp> {
    if (!this._mcp) {
      throw new Error(
        'mountMcp() requires the MCP surface. Pass an `mcp` block to createApcore().',
      );
    }

    return mountMcpEndpoint(app, this._mcp, {
      explorer: this.options.mcp?.explorer,
      explorerPrefix: this.options.mcp?.explorerPrefix,
      allowExecute: this.options.mcp?.allowExecute,
      ...options,
    });
  }

  /**
   * Convert the registered modules to OpenAI-compatible tool definitions.
   *
   * @throws {Error} When the instance was created without `options.mcp`.
   */
  async toOpenaiTools(options?: {
    embedAnnotations?: boolean;
    strict?: boolean;
    tags?: string[];
    prefix?: string;
  }): Promise<unknown[]> {
    if (!this._mcp) {
      throw new Error(
        'toOpenaiTools() requires the MCP surface. Pass an `mcp` block to createApcore().',
      );
    }
    return this._mcp.toOpenaiTools(options);
  }

  /** Shut down the MCP and A2A surfaces. */
  async close(): Promise<void> {
    await this._mcp?.stop();
    this._a2a?.stop();
  }
}

/**
 * Create a {@link HonoApcore} instance.
 *
 * Sugar for `new HonoApcore(options)`, matching the `createX()` style the
 * Hono ecosystem uses.
 */
export function createApcore(options: HonoApcoreOptions = {}): HonoApcore {
  return new HonoApcore(options);
}
