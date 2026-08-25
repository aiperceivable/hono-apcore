import type { ApcoreExecutor } from '../core/executor.js';
import type { ApcoreRegistry } from '../core/registry.js';
import type { ApcoreMcpOptions } from '../types.js';

/**
 * The embeddable MCP app returned by `apcore-mcp`'s `asyncServe()`.
 *
 * `handler` is a Node.js `(req, res)` function — see
 * {@link mountMcp} for wiring it into a Hono app on the Node runtime.
 */
export interface McpApp {
  handler: (req: unknown, res: unknown) => Promise<void>;
  close: () => Promise<void>;
}

/** Options forwarded to both `serve()` and `asyncServe()`. */
const SHARED_OPTION_KEYS = [
  'name',
  'version',
  'tags',
  'prefix',
  'validateInputs',
  'logLevel',
  'metricsCollector',
  'observability',
  'authenticator',
  'requireAuth',
  'exemptPaths',
  'approvalHandler',
  'approvalStore',
  'approvalNotify',
  'outputFormatter',
  'outputFormat',
  'redactOutput',
  'trace',
  'strategy',
] as const;

/** Options only `serve()` understands (they configure a standalone server). */
const SERVE_ONLY_KEYS = [
  'transport',
  'host',
  'port',
  'explorer',
  'explorerPrefix',
  'allowExecute',
  'dynamic',
  'onStartup',
  'onShutdown',
  'explorerTitle',
  'explorerProjectName',
  'explorerProjectUrl',
] as const;

/** Options renamed on their way to `apcore-mcp`. */
const RENAMED_OPTIONS: Record<string, string> = {
  mcpMiddleware: 'middleware',
  mcpAcl: 'acl',
};

/**
 * Manages the MCP (Model Context Protocol) server for a Hono app.
 *
 * `apcore-mcp` is an **optional** peer dependency and is loaded lazily, so
 * importing `hono-apcore` stays safe on runtimes without `node:http`
 * (Workers, Deno, Bun) as long as the MCP surface goes unused there.
 *
 * Two deployment shapes are supported:
 *
 * - **Standalone** — {@link start} runs an MCP server on its own port, next
 *   to the Hono HTTP server. Configure `transport` to enable it.
 * - **Embedded** — {@link asyncServe} returns a request handler that
 *   {@link mountMcp} wires into the Hono app itself, so one port serves both.
 */
export class ApcoreMcpService {
  private _isRunning = false;
  private _app: McpApp | null = null;

  constructor(
    private readonly registry: ApcoreRegistry,
    private readonly executor: ApcoreExecutor,
    private readonly options: ApcoreMcpOptions,
  ) {}

  // -------------------------------------------------------------------------
  // Properties
  // -------------------------------------------------------------------------

  /** Whether a standalone MCP server has been started. */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /** The embedded MCP app, once {@link asyncServe} has built one. */
  get app(): McpApp | null {
    return this._app;
  }

  /** Number of tools exposed, honouring the module-level `tags` / `prefix`. */
  get toolCount(): number {
    return this.registry.list({
      tags: this.options.tags ?? undefined,
      prefix: this.options.prefix ?? undefined,
    }).length;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start a standalone MCP server using the configured transport.
   *
   * With `transport: 'stdio'` this occupies the process's stdio, so it is the
   * right choice for a CLI-launched MCP server and the wrong one for a web
   * process — use {@link asyncServe} there.
   *
   * @param overrides - Per-call option overrides, e.g. the flags the
   *   `hono-apcore serve` command accepts.
   */
  async start(overrides: Partial<ApcoreMcpOptions> = {}): Promise<void> {
    const { serve } = await import('apcore-mcp');
    this._isRunning = true;

    const serveOptions: Record<string, unknown> = {
      ...this.collectOptions(SHARED_OPTION_KEYS),
      ...this.collectOptions(SERVE_ONLY_KEYS),
    };

    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) serveOptions[key] = value;
    }

    await (serve as (executor: unknown, options: unknown) => Promise<void>)(
      this.executor.raw,
      serveOptions,
    );
  }

  /**
   * Build an embeddable MCP request handler without starting a server.
   *
   * Repeated calls return the same app; call {@link stop} to tear it down.
   *
   * @param options - Per-call overrides for endpoint and Explorer settings.
   */
  async asyncServe(options?: {
    endpoint?: string;
    explorer?: boolean;
    explorerPrefix?: string;
    allowExecute?: boolean;
    dynamic?: boolean;
  }): Promise<McpApp> {
    if (this._app) return this._app;

    const { asyncServe } = await import('apcore-mcp');

    const asyncOptions: Record<string, unknown> = {
      ...this.collectOptions(SHARED_OPTION_KEYS),
      explorer: options?.explorer ?? this.options.explorer,
      explorerPrefix: options?.explorerPrefix ?? this.options.explorerPrefix,
      allowExecute: options?.allowExecute ?? this.options.allowExecute,
      explorerTitle: this.options.explorerTitle,
      explorerProjectName: this.options.explorerProjectName,
      explorerProjectUrl: this.options.explorerProjectUrl,
    };

    if (options?.endpoint !== undefined) asyncOptions['endpoint'] = options.endpoint;
    if (options?.dynamic !== undefined) asyncOptions['dynamic'] = options.dynamic;

    for (const key of Object.keys(asyncOptions)) {
      if (asyncOptions[key] === undefined) delete asyncOptions[key];
    }

    this._app = (await (
      asyncServe as (executor: unknown, options: unknown) => Promise<McpApp>
    )(this.executor.raw, asyncOptions)) as McpApp;

    return this._app;
  }

  /** Tear down the embedded MCP app and mark the service stopped. */
  async stop(): Promise<void> {
    this._isRunning = false;
    if (this._app) {
      await this._app.close();
      this._app = null;
    }
  }

  /** Stop, then start the standalone MCP server. */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  // -------------------------------------------------------------------------
  // Tool conversion
  // -------------------------------------------------------------------------

  /**
   * Convert the registered modules to OpenAI-compatible tool definitions,
   * ready to hand to a chat-completions `tools` parameter.
   */
  async toOpenaiTools(options?: {
    embedAnnotations?: boolean;
    strict?: boolean;
    tags?: string[];
    prefix?: string;
  }): Promise<unknown[]> {
    const { toOpenaiTools } = await import('apcore-mcp');
    return (toOpenaiTools as (executor: unknown, options?: unknown) => unknown[])(
      this.executor.raw,
      options ?? {
        tags: this.options.tags ?? undefined,
        prefix: this.options.prefix ?? undefined,
      },
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Collect the defined values for `keys`, applying any option renames. */
  private collectOptions(keys: readonly string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const key of keys) {
      const value = (this.options as Record<string, unknown>)[key];
      if (value !== undefined) result[key] = value;
    }

    for (const [from, to] of Object.entries(RENAMED_OPTIONS)) {
      const value = (this.options as Record<string, unknown>)[from];
      if (value !== undefined) result[to] = value;
    }

    return result;
  }
}
