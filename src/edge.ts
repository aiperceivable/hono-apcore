// ---------------------------------------------------------------------------
// Edge entry
//
// Browser, worker, and edge-runtime subset of hono-apcore. It deliberately
// excludes the optional MCP, CLI, and A2A surfaces, file-backed YAML bindings,
// and the Node-only apcore-js re-exports. Bundlers targeting the browser or a
// worker runtime select this entry through the `browser` export condition;
// explicit consumers can also import `hono-apcore/edge`.
// ---------------------------------------------------------------------------

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
// apcore-js re-exports (browser-safe subset)
// ---------------------------------------------------------------------------
export {
  Registry,
  Executor,
  Context as ApcoreRequestContext,
  createIdentity,
  ACL,
  FunctionModule,
  TraceContext,
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
// apcore-toolkit re-exports (browser-safe subset)
// ---------------------------------------------------------------------------
export {
  BaseScanner,
  createScannedModule,
  cloneModule,
  moduleToDict,
  modulesToDicts,
  annotationsToDict,
  toMarkdown,
  enrichSchemaDescriptions,
  resolveHttpVerb,
  generateSuggestedAlias,
  hasPathParams,
  extractPathParamNames,
  substitutePathParams,
  SCANNER_VERB_MAP,
} from 'apcore-toolkit/browser';
export type { ScannedModule } from 'apcore-toolkit/browser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type { Identity } from 'apcore-js';

export type {
  ModuleAnnotations,
  ModuleExample,
  Module,
  Context,
  ModuleDescriptor,
  PreflightResult,
  PreflightCheckResult,
  ValidationResult,
  ApToolAnnotations,
  ApToolExample,
  ApToolHandler,
  ApToolDefinition,
  ApToolsetOptions,
  HonoApcoreCoreOptions as HonoApcoreOptions,
  RouteScanOptions,
  RouteOverride,
  RegisterMethodOptions,
  RegisterObjectOptions,
} from './types.js';
