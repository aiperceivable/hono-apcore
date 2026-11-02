import { HonoApcore as HonoApcoreCore } from './apcore.js';
import { ApcoreMcpService } from '../mcp/apcore-mcp.service.js';
import { ApcoreCliService } from '../cli/apcore-cli.service.js';
import { ApcoreA2aService } from '../a2a/apcore-a2a.service.js';
import { ApBindingLoader } from '../bridge/binding-loader.js';
import type { TargetResolver } from '../bridge/binding-loader.js';
import { mountMcp as mountMcpEndpoint } from '../mcp/mount.js';
import type { MountableApp } from '../mcp/mount.js';
import type { McpApp } from '../mcp/apcore-mcp.service.js';
import { toMcpTransport } from '../config.js';
import type { HonoApcoreOptions, MountMcpOptions } from '../types.js';

/**
 * Node entry for {@link HonoApcore}.
 *
 * Adds the optional MCP, CLI, and A2A surfaces plus YAML bindings loaded from
 * disk. The edge entry exposes the same core behaviour without these
 * Node-only dependencies.
 */
export class HonoApcore extends HonoApcoreCore {
  private readonly _mcp: ApcoreMcpService | null;
  private readonly _cli: ApcoreCliService | null;
  private readonly _a2a: ApcoreA2aService | null;

  constructor(options: HonoApcoreOptions = {}) {
    super(options);

    this._mcp = options.mcp
      ? new ApcoreMcpService(this.registry, this.executor, {
          ...options.mcp,
          // The APCORE_* settings supply the defaults; explicit config wins.
          transport: options.mcp.transport ?? toMcpTransport(this.settings.transport),
          host: options.mcp.host ?? this.settings.host,
          port: options.mcp.port ?? this.settings.port,
        })
      : null;

    this._cli = options.cli
      ? new ApcoreCliService(this.registry, options.cli, this.executor)
      : null;
    this._a2a = options.a2a
      ? new ApcoreA2aService(this.registry, this.executor, options.a2a)
      : null;
  }

  private get nodeOptions(): HonoApcoreOptions {
    return this.options as HonoApcoreOptions;
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

  /**
   * Load a YAML bindings file and register its entries.
   *
   * @param filePath - Path to the YAML file. Defaults to `options.bindings`.
   * @param resolveTarget - Resolves each entry's `target` to a live handler.
   */
  async loadBindings(filePath?: string, resolveTarget?: TargetResolver): Promise<string[]> {
    const path = filePath ?? this.nodeOptions.bindings;
    if (!path) return [];
    return new ApBindingLoader(this.registry, resolveTarget).loadFromFile(path);
  }

  /**
   * Mount the MCP endpoint into the Hono app so one port serves both HTTP and
   * MCP. Node runtime only — see {@link mountMcpEndpoint}.
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
      explorer: this.nodeOptions.mcp?.explorer,
      explorerPrefix: this.nodeOptions.mcp?.explorerPrefix,
      allowExecute: this.nodeOptions.mcp?.allowExecute,
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

  protected override async loadConfiguredBindings(): Promise<void> {
    if (this.nodeOptions.bindings) {
      await this.loadBindings();
    }
  }

  protected override async startSurfaces(): Promise<void> {
    if (this._a2a && this.nodeOptions.a2a?.port !== undefined) {
      await this._a2a.start();
    }

    if (this._mcp && this.nodeOptions.mcp?.transport) {
      await this._mcp.start();
    }
  }
}

/**
 * Create a Node {@link HonoApcore} instance.
 *
 * Sugar for `new HonoApcore(options)`, matching the `createX()` style the
 * Hono ecosystem uses.
 */
export function createApcore(options: HonoApcoreOptions = {}): HonoApcore {
  return new HonoApcore(options);
}
