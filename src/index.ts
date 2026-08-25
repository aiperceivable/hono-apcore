// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------
export { HonoApcore, createApcore } from './core/apcore.js';
export { ApcoreRegistry } from './core/registry.js';
export { ApcoreExecutor } from './core/executor.js';
export { apcore, getApcore, getApcoreContext } from './core/middleware.js';
export type { ApcoreMiddlewareOptions } from './core/middleware.js';

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
export { defineTool, defineToolset, resolveToolId, toolToScannedModule } from './tools/index.js';
export type { ToolConversionOptions } from './tools/index.js';

// ---------------------------------------------------------------------------
// Route scanning
// ---------------------------------------------------------------------------
export { HonoRouteScanner, buildRequestUrl } from './scanners/index.js';
export type { HonoAppLike } from './scanners/index.js';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
export { HonoContextFactory, defaultContextFactory, toHeaders } from './context/index.js';
export type { HeaderSource } from './context/index.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
export {
  SchemaExtractor,
  SchemaExtractionError,
  defaultSchemaExtractor,
  TypeBoxAdapter,
  ZodAdapter,
  JsonSchemaAdapter,
} from './schema/index.js';
export type { SchemaAdapter } from './schema/index.js';

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------
export { ApcoreMcpService, mountMcp, toHonoHandler, RESPONSE_ALREADY_SENT } from './mcp/index.js';
export type { McpApp, MountableApp } from './mcp/index.js';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
export { ApcoreCliService } from './cli/index.js';

// ---------------------------------------------------------------------------
// A2A
// ---------------------------------------------------------------------------
export { ApcoreA2aService } from './a2a/index.js';

// ---------------------------------------------------------------------------
// YAML bindings
// ---------------------------------------------------------------------------
export { ApBindingLoader, resolverFromObjects } from './bridge/index.js';
export type { TargetResolver } from './bridge/index.js';

// ---------------------------------------------------------------------------
// Output writers
// ---------------------------------------------------------------------------
export { modulesToBindings, renderBindingsYaml, writeBindingsFile } from './output/index.js';
export type { BindingRecord } from './output/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export { loadSettings, toMcpTransport, APCORE_SETTING_DEFAULTS } from './config.js';
export type { ApcoreSettings, EnvSource } from './config.js';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
export {
  toSnakeCase,
  normalizeName,
  normalizeMethodName,
  generateModuleId,
  applyModulePrefix,
} from './utils/id-generator.js';
export {
  scannedModuleToFunctionModule,
  toModuleAnnotations,
  normalizeResult,
  EMPTY_OBJECT_SCHEMA,
} from './utils/module-factory.js';
export type { BoundExecuteFn } from './utils/module-factory.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export {
  APCORE_VAR,
  APCORE_CONTEXT_VAR,
  APCORE_ENV_PREFIX,
  DEFAULT_MCP_ENDPOINT,
  DEFAULT_EXPLORER_PREFIX,
  HONO_ALREADY_SENT_HEADER,
} from './constants.js';

// ---------------------------------------------------------------------------
// apcore-js re-exports
//
// The core SDK is a hard dependency, so these are always importable straight
// from `hono-apcore`. The MCP, CLI, and A2A packages are *optional* peers and
// are deliberately not re-exported — importing them eagerly would pull
// `node:http` into edge builds. Import those symbols from `apcore-mcp`,
// `apcore-cli`, and `apcore-a2a` directly.
// ---------------------------------------------------------------------------
export {
  Registry,
  Executor,
  Context as ApcoreRequestContext,
  createIdentity,
  ACL,
  Config,
  FunctionModule,
  TraceContext,
  registerSysModules,
  ACLDeniedError,
  ModuleError,
  ModuleNotFoundError,
  ModuleExecuteError,
  SchemaValidationError,
  ErrorCodes,
  DEFAULT_ANNOTATIONS,
  VERSION as APCORE_VERSION,
} from 'apcore-js';

// ---------------------------------------------------------------------------
// apcore-toolkit re-exports (scanning and serialisation helpers)
// ---------------------------------------------------------------------------
export {
  BaseScanner,
  createScannedModule,
  cloneModule,
  filterModules,
  deduplicateIds,
  moduleToDict,
  modulesToDicts,
  annotationsToDict,
  formatModule,
  formatModules,
  toMarkdown,
  enrichSchemaDescriptions,
  resolveHttpVerb,
  generateSuggestedAlias,
  hasPathParams,
  extractPathParamNames,
  substitutePathParams,
  SCANNER_VERB_MAP,
} from 'apcore-toolkit';
export type { ScannedModule } from 'apcore-toolkit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// `Identity` is a type-only export upstream — apcore-js exposes the class
// through `createIdentity()`, not as a constructor.
export type { Identity } from 'apcore-js';

export type {
  // Upstream
  ModuleAnnotations,
  ModuleExample,
  Module,
  Context,
  ModuleDescriptor,
  PreflightResult,
  PreflightCheckResult,
  ValidationResult,
  // Tool definition
  ApToolAnnotations,
  ApToolExample,
  ApToolHandler,
  ApToolDefinition,
  ApToolsetOptions,
  // Configuration
  HonoApcoreOptions,
  ApcoreMcpOptions,
  ApcoreCliOptions,
  ApcoreA2aOptions,
  MountMcpOptions,
  // Route scanning
  RouteScanOptions,
  RouteOverride,
  // Registration
  RegisterMethodOptions,
  RegisterObjectOptions,
} from './types.js';
