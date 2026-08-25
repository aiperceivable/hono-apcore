import type { ApcoreExecutor } from '../core/executor.js';
import type { ApcoreRegistry } from '../core/registry.js';
import type { ApcoreA2aOptions } from '../types.js';

/**
 * Manages the A2A (Agent-to-Agent) server that exposes the registered apcore
 * modules as agent skills.
 *
 * `apcore-a2a` is an **optional** peer dependency, loaded lazily.
 *
 * - **Standalone** — set `port` and call {@link start}; the A2A server binds
 *   its own port alongside the Hono HTTP server.
 * - **Embedded** — {@link asyncServe} returns an Express-compatible app you
 *   can mount behind a reverse proxy or inside a Node server.
 */
export class ApcoreA2aService {
  private _isRunning = false;

  constructor(
    private readonly registry: ApcoreRegistry,
    private readonly executor: ApcoreExecutor,
    private readonly options: ApcoreA2aOptions = {},
  ) {}

  /** Whether the standalone A2A server has been started. */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /** Number of skills (modules) exposed to A2A clients. */
  get skillCount(): number {
    return this.registry.list().length;
  }

  /**
   * Start a standalone A2A HTTP server with the configured options.
   *
   * Called automatically by {@link HonoApcore.init} when `port` is set.
   */
  async start(): Promise<void> {
    const { serve } = await import('apcore-a2a');
    this._isRunning = true;
    (serve as (executor: unknown, options: unknown) => unknown)(
      this.executor.raw,
      this.serveOptions(),
    );
  }

  /**
   * Build an embeddable A2A application without binding a port.
   *
   * @param overrides - Option overrides merged over the configured values.
   */
  async asyncServe(overrides?: Partial<ApcoreA2aOptions>): Promise<unknown> {
    const { asyncServe } = await import('apcore-a2a');
    return (asyncServe as (executor: unknown, options: unknown) => Promise<unknown>)(
      this.executor.raw,
      this.serveOptions(overrides),
    );
  }

  /**
   * Mark the service stopped. The underlying HTTP server owns its own
   * lifecycle and shuts down with the process.
   */
  stop(): void {
    this._isRunning = false;
  }

  private serveOptions(overrides?: Partial<ApcoreA2aOptions>): Record<string, unknown> {
    const opts = { ...this.options, ...overrides };
    const result: Record<string, unknown> = {
      name: opts.name,
      description: opts.description,
      version: opts.version,
      url: opts.url,
      host: opts.host,
      port: opts.port,
      auth: opts.auth,
      taskStore: opts.taskStore,
      corsOrigins: opts.corsOrigins,
      explorer: opts.explorer,
      explorerPrefix: opts.explorerPrefix,
      executionTimeout: opts.executionTimeout,
      metrics: opts.metrics,
      logLevel: opts.logLevel,
      shutdownTimeout: opts.shutdownTimeout,
    };

    for (const key of Object.keys(result)) {
      if (result[key] === undefined) delete result[key];
    }

    return result;
  }
}
