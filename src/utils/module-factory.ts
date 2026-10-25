import { FunctionModule, DEFAULT_ANNOTATIONS, jsonSchemaToTypeBox } from 'apcore-js';
import type { ModuleAnnotations, ModuleExample } from 'apcore-js';
import type { DisplayMetadata, ScannedModule, SurfaceDisplay } from 'apcore-toolkit';
import type { ApToolAnnotations } from '../types.js';

/**
 * Execute-function signature for Hono-bound modules.
 *
 * Unlike apcore-toolkit's `RegistryWriter` — which resolves a `target` string
 * via dynamic import — a Hono integration already holds the closure, so the
 * bound function is passed in directly.
 */
export type BoundExecuteFn = (
  inputs: Record<string, unknown>,
  context: unknown,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

/**
 * Normalise a raw handler return value to a plain `Record<string, unknown>`.
 *
 * `null` / `undefined` become `{}`; arrays and primitives are wrapped as
 * `{ result }` so every module honours the object-output contract.
 */
export function normalizeResult(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return { result: raw };
}

/**
 * Widen partial {@link ApToolAnnotations} (all-optional booleans) into a full
 * `ModuleAnnotations` by spreading over apcore-js's `DEFAULT_ANNOTATIONS`.
 *
 * Returns `null` when the input is nullish.
 */
export function toModuleAnnotations(
  partial: ApToolAnnotations | null | undefined,
): ModuleAnnotations | null {
  if (partial == null) return null;
  return { ...DEFAULT_ANNOTATIONS, ...partial };
}

/**
 * Toolkit 0.14's public DisplayResolver always logs to stdout, including on
 * successful MCP alias sanitization. Keep only its in-memory projection here
 * so registration is safe for JSON exports and stdio MCP. SDK parity tests
 * cover precedence, aliases and validation; file/binding parsing stays upstream.
 */
function resolveDisplay(mod: ScannedModule): DisplayMetadata {
  const overlay = mod.display!;
  const string = (value: unknown): string | undefined =>
    typeof value === 'string' ? value : undefined;
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
  const alias = string(overlay.alias) || mod.suggestedAlias ||
    string(mod.metadata.suggested_alias) || mod.moduleId;
  const description = string(overlay.description) || mod.description;
  const guidance = string(overlay.guidance) || null;
  const surface = (key: string): SurfaceDisplay => {
    const override = object(overlay[key]);
    return {
      alias: string(override.alias) || alias,
      description: string(override.description) || description,
      guidance: string(override.guidance) || guidance,
    };
  };
  const display: DisplayMetadata = {
    alias, description, guidance,
    documentation: string(overlay.documentation) || mod.documentation || null,
    tags: Array.isArray(overlay.tags)
      ? overlay.tags.filter((tag): tag is string => typeof tag === 'string') : [...mod.tags],
    cli: surface('cli'), mcp: surface('mcp'), a2a: surface('a2a'),
  };
  display.mcp.alias = display.mcp.alias.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (/^\d/.test(display.mcp.alias)) display.mcp.alias = '_' + display.mcp.alias;
  if (display.mcp.alias.length > 64) {
    throw new Error(
      `Module '${mod.moduleId}': MCP alias '${display.mcp.alias}' exceeds ` +
      '64-character hard limit (OpenAI spec). Set display.mcp.alias to a shorter value.',
    );
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(display.mcp.alias)) {
    throw new Error(
      `Module '${mod.moduleId}': MCP alias '${display.mcp.alias}' does not match ` +
      'required pattern ^[a-zA-Z_][a-zA-Z0-9_-]*$.',
    );
  }
  if (string(object(overlay.cli).alias) && !/^[a-z][a-z0-9_-]*$/.test(display.cli.alias)) {
    console.warn(
      `Module '${mod.moduleId}': CLI alias '${display.cli.alias}' does not match shell-safe pattern ` +
      `^[a-z][a-z0-9_-]*$ - falling back to default alias '${alias}'.`,
    );
    display.cli.alias = alias;
  }
  return display;
}

/**
 * Convert a toolkit {@link ScannedModule} plus a pre-bound execute function
 * into an apcore-js `FunctionModule` ready for registry registration.
 */
export function scannedModuleToFunctionModule(
  mod: ScannedModule,
  execute: BoundExecuteFn,
): FunctionModule {
  const metadata = mod.display
    ? { ...mod.metadata, display: resolveDisplay(mod) } : mod.metadata;
  // Strip internal keys (leading underscore) from metadata so they do not
  // leak into the module's public descriptor.
  const cleanMetadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!k.startsWith('_')) {
      cleanMetadata[k] = v;
    }
  }

  return new FunctionModule({
    execute,
    moduleId: mod.moduleId,
    inputSchema: jsonSchemaToTypeBox(mod.inputSchema),
    outputSchema: jsonSchemaToTypeBox(mod.outputSchema),
    description: mod.description,
    documentation: mod.documentation,
    tags: mod.tags.length > 0 ? [...mod.tags] : null,
    version: mod.version,
    annotations: mod.annotations,
    display: mod.display,
    metadata: Object.keys(cleanMetadata).length > 0 ? cleanMetadata : null,
    examples: mod.examples.length > 0 ? ([...mod.examples] as ModuleExample[]) : null,
  });
}

/** An empty JSON Schema object, used when a tool declares no schema. */
export const EMPTY_OBJECT_SCHEMA: Record<string, unknown> = Object.freeze({
  type: 'object',
  properties: {},
});
