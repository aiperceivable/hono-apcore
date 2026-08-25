import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

/**
 * Pins the public surface. A symbol disappearing from this list is a breaking
 * change; a new one should be added here deliberately.
 */
const EXPECTED_EXPORTS = [
  // Core
  'HonoApcore',
  'createApcore',
  'ApcoreRegistry',
  'ApcoreExecutor',
  'apcore',
  'getApcore',
  'getApcoreContext',
  // Tools
  'defineTool',
  'defineToolset',
  'resolveToolId',
  'toolToScannedModule',
  // Scanning
  'HonoRouteScanner',
  'buildRequestUrl',
  // Context
  'HonoContextFactory',
  'defaultContextFactory',
  'toHeaders',
  // Schema
  'SchemaExtractor',
  'SchemaExtractionError',
  'defaultSchemaExtractor',
  'TypeBoxAdapter',
  'ZodAdapter',
  'JsonSchemaAdapter',
  // Surfaces
  'ApcoreMcpService',
  'mountMcp',
  'toHonoHandler',
  'RESPONSE_ALREADY_SENT',
  'ApcoreCliService',
  'ApcoreA2aService',
  // Bindings and output
  'ApBindingLoader',
  'resolverFromObjects',
  'modulesToBindings',
  'renderBindingsYaml',
  'writeBindingsFile',
  // Configuration
  'loadSettings',
  'toMcpTransport',
  'APCORE_SETTING_DEFAULTS',
  // Utilities
  'toSnakeCase',
  'normalizeName',
  'normalizeMethodName',
  'generateModuleId',
  'applyModulePrefix',
  'scannedModuleToFunctionModule',
  'toModuleAnnotations',
  'normalizeResult',
  'EMPTY_OBJECT_SCHEMA',
  // Constants
  'APCORE_VAR',
  'APCORE_CONTEXT_VAR',
  'APCORE_ENV_PREFIX',
  'DEFAULT_MCP_ENDPOINT',
  'DEFAULT_EXPLORER_PREFIX',
  'HONO_ALREADY_SENT_HEADER',
  // apcore-js re-exports
  'Registry',
  'Executor',
  'ApcoreRequestContext',
  'createIdentity',
  'ACL',
  'Config',
  'FunctionModule',
  'TraceContext',
  'registerSysModules',
  'ACLDeniedError',
  'ModuleError',
  'ModuleNotFoundError',
  'ModuleExecuteError',
  'SchemaValidationError',
  'ErrorCodes',
  'DEFAULT_ANNOTATIONS',
  'APCORE_VERSION',
  // apcore-toolkit re-exports
  'BaseScanner',
  'createScannedModule',
  'cloneModule',
  'filterModules',
  'deduplicateIds',
  'moduleToDict',
  'modulesToDicts',
  'annotationsToDict',
  'formatModule',
  'formatModules',
  'toMarkdown',
  'enrichSchemaDescriptions',
  'resolveHttpVerb',
  'generateSuggestedAlias',
  'hasPathParams',
  'extractPathParamNames',
  'substitutePathParams',
  'SCANNER_VERB_MAP',
];

describe('public API', () => {
  it.each(EXPECTED_EXPORTS)('exports %s', (name) => {
    expect(api).toHaveProperty(name);
    expect((api as Record<string, unknown>)[name]).toBeDefined();
  });

  it('exports nothing beyond the pinned list', () => {
    expect(Object.keys(api).sort()).toEqual([...EXPECTED_EXPORTS].sort());
  });

  it('does not eagerly load the optional MCP, CLI, or A2A peers', () => {
    // Importing hono-apcore on an edge runtime must not pull in node:http via
    // apcore-mcp; those packages are reached through lazy dynamic imports.
    const source = api as Record<string, unknown>;
    expect(source).not.toHaveProperty('serve');
    expect(source).not.toHaveProperty('asyncServe');
    expect(source).not.toHaveProperty('createCli');
  });
});
