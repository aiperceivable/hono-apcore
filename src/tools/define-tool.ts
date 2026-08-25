import { createScannedModule, enrichSchemaDescriptions } from 'apcore-toolkit';
import type { ScannedModule } from 'apcore-toolkit';
import { SchemaExtractor, defaultSchemaExtractor } from '../schema/schema-extractor.js';
import { generateModuleId, normalizeMethodName, applyModulePrefix } from '../utils/id-generator.js';
import {
  EMPTY_OBJECT_SCHEMA,
  normalizeResult,
  toModuleAnnotations,
} from '../utils/module-factory.js';
import type { BoundExecuteFn } from '../utils/module-factory.js';
import type { ApToolDefinition, ApToolsetOptions } from '../types.js';

/**
 * Identity helper that gives a tool literal full type inference and a single
 * obvious place to look for the shape.
 *
 * This is the Hono counterpart to NestJS's `@ApTool` decorator: Hono has no
 * classes or DI container to decorate, so a tool is a plain object carrying
 * its own metadata and handler.
 *
 * @example
 * ```ts
 * const listTodos = defineTool({
 *   namespace: 'todo',
 *   name: 'list',
 *   description: 'List all todos',
 *   inputSchema: Type.Object({ done: Type.Optional(Type.Boolean()) }),
 *   annotations: { readonly: true, idempotent: true },
 *   handler: (inputs) => ({ todos: store.filter(...) }),
 * });
 * ```
 */
export function defineTool(definition: ApToolDefinition): ApToolDefinition {
  return definition;
}

/**
 * Group several tools under one namespace, applying shared tags and
 * annotations to each.
 *
 * The record key becomes the tool's `name` when the entry does not set one,
 * so `{ list: {...} }` under namespace `todo` yields `todo.list`.
 *
 * @example
 * ```ts
 * const todoTools = defineToolset({
 *   namespace: 'todo',
 *   tags: ['todo'],
 *   tools: {
 *     list:   { description: 'List todos', handler: list },
 *     create: { description: 'Add a todo', handler: create },
 *   },
 * });
 * ```
 */
export function defineToolset(options: ApToolsetOptions): ApToolDefinition[] {
  const { namespace, description, tags, annotations, tools } = options;

  return Object.entries(tools).map(([key, tool]) => ({
    ...tool,
    namespace,
    name: tool.name ?? key,
    description: tool.description || description || key,
    tags: tool.tags ?? tags,
    annotations: tool.annotations ?? annotations,
  }));
}

/** Resolve the module ID a tool definition will be registered under. */
export function resolveToolId(tool: ApToolDefinition, modulePrefix?: string): string {
  if (tool.id != null) {
    return applyModulePrefix(tool.id, modulePrefix);
  }

  // An anonymous handler written inline picks up the property key as its
  // name — `{ handler: () => {} }` yields `"handler"` — which would silently
  // produce a module called `<namespace>.handler`, so it is not a usable
  // fallback.
  const inferred = tool.handler.name === 'handler' ? '' : tool.handler.name;
  const name = tool.name ?? inferred;
  if (!name) {
    throw new Error(
      'Tool definition needs an "id", a "name", or a named handler function to derive its module ID from.',
    );
  }

  const base = generateModuleId(
    tool.namespace ?? '',
    normalizeMethodName(name),
    false,
    null,
  );
  return applyModulePrefix(base, modulePrefix);
}

/** Options for {@link toolToScannedModule}. */
export interface ToolConversionOptions {
  /** Prefix prepended to the generated module ID. */
  modulePrefix?: string;
  /** Extractor used for `inputSchema` / `outputSchema`. */
  schemaExtractor?: SchemaExtractor;
  /** Extra tags merged into the tool's own tags. */
  tags?: string[];
}

function extractSchema(
  extractor: SchemaExtractor,
  input: unknown,
  moduleId: string,
  field: string,
): Record<string, unknown> {
  if (input == null) return { ...EMPTY_OBJECT_SCHEMA };
  try {
    return extractor.extractJsonSchema(input);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to extract ${field} for tool "${moduleId}": ${reason}`);
  }
}

/**
 * Convert a {@link ApToolDefinition} into the toolkit's `ScannedModule`
 * intermediate plus the bound execute function the registry needs.
 *
 * Schemas are normalised to JSON Schema, and JSDoc on the handler fills in
 * missing documentation and per-parameter descriptions.
 */
export function toolToScannedModule(
  tool: ApToolDefinition,
  options: ToolConversionOptions = {},
): { module: ScannedModule; execute: BoundExecuteFn } {
  const extractor = options.schemaExtractor ?? defaultSchemaExtractor;
  const moduleId = resolveToolId(tool, options.modulePrefix);

  let inputSchema = extractSchema(extractor, tool.inputSchema, moduleId, 'inputSchema');
  const outputSchema = extractSchema(extractor, tool.outputSchema, moduleId, 'outputSchema');

  // JavaScript gives no runtime access to a function's leading comments — the
  // way Python reads a docstring — so per-parameter prose is declared with the
  // explicit `params` field instead of inferred from JSDoc.
  if (tool.params && Object.keys(tool.params).length > 0) {
    inputSchema = enrichSchemaDescriptions(inputSchema, tool.params);
  }

  const tags = [...new Set([...(tool.tags ?? []), ...(options.tags ?? [])])];

  const module = createScannedModule({
    moduleId,
    description: tool.description,
    inputSchema,
    outputSchema,
    tags,
    target: tool.handler.name || moduleId,
    annotations: toModuleAnnotations(tool.annotations),
    documentation: tool.documentation ?? null,
    examples: tool.examples ?? [],
  });

  const execute: BoundExecuteFn = async (inputs, context) => {
    const raw = await tool.handler(inputs, context);
    return normalizeResult(raw);
  };

  return { module, execute };
}
