import { Executor, Registry } from 'apcore-js';
import type { ACL, Middleware } from 'apcore-js';
import { ApcoreRegistry } from './registry.js';
import { ApcoreExecutor } from './executor.js';
import { HonoContextFactory } from '../context/hono-context.factory.js';
import { HonoRouteScanner } from '../scanners/hono-route-scanner.js';
import type { HonoAppLike } from '../scanners/hono-route-scanner.js';
import { loadSettings } from '../config.js';
import type { ApcoreSettings } from '../config.js';
import type {
  ApToolDefinition,
  HonoApcoreCoreOptions,
  RegisterMethodOptions,
  RegisterObjectOptions,
  RouteScanOptions,
} from '../types.js';

/**
 * Core entry point for wiring apcore into a Hono app.
 *
 * Owns the apcore `Registry` and `Executor`, the tool/route registration
 * surface, and route scanning. This is the implementation behind both package
 * entries: the Node subclass adds MCP, CLI, A2A, and YAML bindings, while the
 * edge entry exposes this class directly.
 *
 * @example
 * ```ts
 * const ap = createApcore({ tools: [listTodos, addTodo] });
 *
 * app.use('*', apcore(ap));
 * await ap.init(app);                 // register tools, scan routes
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

  protected readonly options: HonoApcoreCoreOptions;
  private readonly scanner = new HonoRouteScanner();
  private initPromise: Promise<void> | null = null;

  constructor(options: HonoApcoreCoreOptions = {}) {
    this.options = options;
    this.settings = loadSettings(undefined, options.settings);

    const registry = new Registry({
      config: options.config,
      extensionsDir: options.extensionsDir ?? null,
    });
    const executorOptions = {
      ...options.executorOptions,
      registry,
      config: options.config,
      acl: (options.acl as ACL | null) ?? null,
      middlewares: (options.middleware as Middleware[]) ?? null,
    };
    const executor = new Executor(executorOptions);

    this.registry = new ApcoreRegistry(registry);
    this.executor = new ApcoreExecutor(executor, executorOptions);
    this.contextFactory = new HonoContextFactory();
  }

  // -------------------------------------------------------------------------
  // Options
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

    if (
      this.options.extensionsDir ||
      this.options.config?.getDeclared('extensions.root') !== undefined ||
      this.options.config?.getDeclared('extensions.roots') !== undefined
    ) {
      await this.registry.discover();
    }

    if (this.options.tools?.length) {
      await this.registerTools(this.options.tools);
    }

    await this.loadConfiguredBindings();

    if (app) {
      await this.scanRoutes(app, routeOptions);
    }

    // Surfaces start last, so every module is registered before a client can
    // list the tools.
    await this.startSurfaces();
  }

  /**
   * Register file-backed bindings before routes are scanned.
   *
   * The core entry leaves this empty; the Node entry loads YAML from disk.
   */
  protected async loadConfiguredBindings(): Promise<void> {}

  /**
   * Start configured standalone surfaces after every module is registered.
   *
   * The core entry leaves this empty; the Node entry starts MCP, CLI, and A2A.
   */
  protected async startSurfaces(): Promise<void> {}
}

/**
 * Create a {@link HonoApcore} instance.
 *
 * Sugar for `new HonoApcore(options)`, matching the `createX()` style the
 * Hono ecosystem uses.
 */
export function createApcore(options: HonoApcoreCoreOptions = {}): HonoApcore {
  return new HonoApcore(options);
}
