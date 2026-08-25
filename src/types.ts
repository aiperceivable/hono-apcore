// Re-export upstream types from apcore-js
export type {
  ModuleAnnotations,
  ModuleExample,
  Module,
  Context,
  Identity,
  ModuleDescriptor,
  PreflightResult,
  PreflightCheckResult,
  ValidationResult,
} from 'apcore-js';

// ---------------------------------------------------------------------------
// Tool definition types
// ---------------------------------------------------------------------------

/** Annotations describing tool behaviour characteristics. */
export interface ApToolAnnotations {
  readonly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  requiresApproval?: boolean;
  openWorld?: boolean;
  streaming?: boolean;
  cacheable?: boolean;
  cacheTtl?: number;
  cacheKeyFields?: string[] | null;
  paginated?: boolean;
  paginationStyle?: 'cursor' | 'offset' | 'page';
}

/** Example entry for a tool invocation. */
export interface ApToolExample {
  title: string;
  inputs: Record<string, unknown>;
  output: Record<string, unknown>;
  description?: string;
}

/**
 * Handler signature for a tool defined with {@link defineTool}.
 *
 * `inputs` is the validated argument object; `context` is the apcore
 * `Context` for the current call (identity, trace, data), or `undefined`
 * when the caller did not supply one.
 */
export type ApToolHandler = (
  inputs: Record<string, unknown>,
  context?: unknown,
) => unknown | Promise<unknown>;

/**
 * A tool definition — the Hono counterpart to NestJS's `@ApTool` decorator.
 *
 * Either `id` or `name` must be present: `id` is used verbatim, while `name`
 * is combined with `namespace` to produce `"<namespace>.<name>"`.
 */
export interface ApToolDefinition {
  /** Fully-qualified module ID. Takes precedence over `namespace`/`name`. */
  id?: string;
  /** Namespace segment of the generated module ID. */
  namespace?: string;
  /** Name segment of the generated module ID (snake_cased if camelCase). */
  name?: string;
  /** Human-readable description surfaced to AI clients. Required. */
  description: string;
  /** TypeBox, Zod, or plain JSON Schema describing the inputs. */
  inputSchema?: unknown;
  /** TypeBox, Zod, or plain JSON Schema describing the output. */
  outputSchema?: unknown;
  annotations?: ApToolAnnotations | null;
  tags?: string[];
  documentation?: string | null;
  examples?: ApToolExample[];
  /**
   * Per-parameter prose merged into the input schema's property descriptions.
   *
   * JavaScript cannot read a function's leading comments at run time — the way
   * Python reads a docstring — so parameter documentation is declared here
   * rather than inferred from JSDoc.
   */
  params?: Record<string, string>;
  /** The function executed when the tool is called. */
  handler: ApToolHandler;
}

/** Shared defaults applied to every tool in a {@link defineToolset} group. */
export interface ApToolsetOptions {
  namespace: string;
  description?: string | null;
  tags?: string[];
  annotations?: ApToolAnnotations | null;
  tools: Record<
    string,
    Omit<ApToolDefinition, 'namespace' | 'name' | 'description'> & {
      name?: string;
      /** Falls back to the toolset description, then the record key. */
      description?: string;
    }
  >;
}

// ---------------------------------------------------------------------------
// HonoApcore option types
// ---------------------------------------------------------------------------

/** Options accepted by {@link createApcore} / the {@link HonoApcore} constructor. */
export interface HonoApcoreOptions {
  /** Directory scanned by `Registry.discover()` for filesystem extensions. */
  extensionsDir?: string | null;
  /** apcore `ACL` instance enforced by the Executor on every call. */
  acl?: unknown | null;
  /** apcore `Middleware` instances installed on the Executor. */
  middleware?: unknown[];
  /** Path to a YAML bindings file loaded during {@link HonoApcore.init}. */
  bindings?: string | null;
  /** Tools registered eagerly during construction. */
  tools?: ApToolDefinition[];
  /** MCP surface configuration. Presence enables the MCP service. */
  mcp?: ApcoreMcpOptions;
  /** CLI surface configuration. Presence enables the CLI service. */
  cli?: ApcoreCliOptions;
  /** A2A surface configuration. Presence enables the A2A service. */
  a2a?: ApcoreA2aOptions;
  /** Route-scanner configuration used by {@link HonoApcore.scanRoutes}. */
  routes?: RouteScanOptions;
  /** Overrides merged over the `APCORE_*` environment settings. */
  settings?: Partial<import('./config.js').ApcoreSettings>;
}

/** Options for the MCP surface. Mirrors `apcore-mcp`'s serve options. */
export interface ApcoreMcpOptions {
  transport?: 'stdio' | 'streamable-http' | 'sse';
  host?: string;
  port?: number;
  name?: string;
  version?: string;
  tags?: string[] | null;
  prefix?: string | null;
  explorer?: boolean;
  explorerPrefix?: string;
  allowExecute?: boolean;
  explorerTitle?: string;
  explorerProjectName?: string;
  explorerProjectUrl?: string;
  dynamic?: boolean;
  validateInputs?: boolean;
  logLevel?: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  onStartup?: () => void | Promise<void>;
  onShutdown?: () => void | Promise<void>;
  metricsCollector?: unknown;
  authenticator?: unknown;
  requireAuth?: boolean;
  exemptPaths?: string[];
  approvalHandler?: unknown;
  outputFormatter?: (result: Record<string, unknown>) => string;
  /** Enable the full observability stack (metrics + usage middleware). */
  observability?: unknown;
  /** Built-in output format ("json", "csv", "jsonl"). */
  outputFormat?: 'json' | 'csv' | 'jsonl';
  /** Redact sensitive fields from tool output. Default: true. */
  redactOutput?: boolean;
  /** Attach a pipeline trace to tool responses. Default: false. */
  trace?: boolean;
  /** Execution strategy name. */
  strategy?: string;
  /** Additional apcore middleware installed on the MCP executor. */
  mcpMiddleware?: unknown[];
  /** Optional ACL instance for this MCP server. */
  mcpAcl?: unknown;
  /** Pluggable ApprovalStore for async approval polling. */
  approvalStore?: unknown;
  /** Callback invoked when a new approval is requested. */
  approvalNotify?: (
    approvalId: string,
    moduleId: string,
    args: Record<string, unknown>,
  ) => Promise<void>;
}

/** Options for mounting the MCP endpoint into a Hono app. */
export interface MountMcpOptions {
  /** Path the MCP endpoint is served at. Default: `"/mcp"`. */
  endpoint?: string;
  /** Enable the Tool Explorer UI. Defaults to the MCP surface setting. */
  explorer?: boolean;
  /** URL prefix for the Explorer. Default: `"/explorer"`. */
  explorerPrefix?: string;
  /** Allow tool execution from the Explorer UI. */
  allowExecute?: boolean;
  /** Also mount `/health` and `/metrics`. Default: true. */
  builtinRoutes?: boolean;
}

/** Options for the CLI surface. */
export interface ApcoreCliOptions {
  /** Path to the extensions directory (default: `./extensions`). */
  extensionsDir?: string;
  /** Program name shown in help output. */
  progName?: string;
  /** Show built-in apcore options in `--help`. Default: false. */
  verboseHelp?: boolean;
  /** Base URL for online documentation. */
  docsUrl?: string | null;
}

/** Options for the A2A surface. */
export interface ApcoreA2aOptions {
  name?: string;
  description?: string;
  version?: string;
  url?: string;
  host?: string;
  /** Port for a standalone A2A server. Omit to embed via `asyncServe()`. */
  port?: number;
  auth?: unknown;
  taskStore?: unknown;
  corsOrigins?: string[];
  explorer?: boolean;
  explorerPrefix?: string;
  executionTimeout?: number;
  metrics?: boolean;
  logLevel?: string;
  shutdownTimeout?: number;
}

// ---------------------------------------------------------------------------
// Route scanning
// ---------------------------------------------------------------------------

/** Options controlling how Hono routes are turned into apcore modules. */
export interface RouteScanOptions {
  /** Prefix prepended to every generated module ID. */
  modulePrefix?: string;
  /** Only scan routes whose path matches one of these glob-ish patterns. */
  includePaths?: string[];
  /** Skip routes whose path matches one of these patterns. */
  excludePaths?: string[];
  /** Skip these HTTP methods. Default: `["HEAD", "OPTIONS"]`. */
  excludeMethods?: string[];
  /** Regex applied to generated module IDs — only matches are kept. */
  include?: string;
  /** Regex applied to generated module IDs — matches are removed. */
  exclude?: string;
  /** Tags attached to every scanned module. Default: `["http"]`. */
  tags?: string[];
  /** Per-route overrides keyed by `"<METHOD> <path>"`. */
  overrides?: Record<string, RouteOverride>;
  /** Base URL used when replaying requests through `app.request()`. */
  baseUrl?: string;
}

/** Per-route metadata overrides applied during scanning. */
export interface RouteOverride {
  id?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: ApToolAnnotations | null;
  tags?: string[];
  documentation?: string | null;
  examples?: ApToolExample[];
  /** Skip this route entirely. */
  skip?: boolean;
}

// ---------------------------------------------------------------------------
// Registration helpers
// ---------------------------------------------------------------------------

/** Options for registering a single method of a plain object as a module. */
export interface RegisterMethodOptions {
  instance: object;
  method: string;
  description: string;
  id?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: ApToolAnnotations;
  tags?: string[];
  documentation?: string | null;
  examples?: ApToolExample[];
}

/** Options for registering every method of an object at once. */
export interface RegisterObjectOptions {
  instance: object;
  description?: string;
  methods: string[] | '*';
  exclude?: string[];
  namespace?: string;
  annotations?: ApToolAnnotations;
  tags?: string[];
  methodOptions?: Record<string, Partial<RegisterMethodOptions>>;
}
