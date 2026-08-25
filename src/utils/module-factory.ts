import { FunctionModule, DEFAULT_ANNOTATIONS, jsonSchemaToTypeBox } from 'apcore-js';
import type { ModuleAnnotations, ModuleExample } from 'apcore-js';
import { annotationsToDict } from 'apcore-toolkit';
import type { ScannedModule } from 'apcore-toolkit';
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
 * Convert a toolkit {@link ScannedModule} plus a pre-bound execute function
 * into an apcore-js `FunctionModule` ready for registry registration.
 */
export function scannedModuleToFunctionModule(
  mod: ScannedModule,
  execute: BoundExecuteFn,
): FunctionModule {
  // Strip internal keys (leading underscore) from metadata so they do not
  // leak into the module's public descriptor.
  const cleanMetadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(mod.metadata)) {
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
    annotations: annotationsToDict(mod.annotations) as ModuleAnnotations | null,
    metadata: Object.keys(cleanMetadata).length > 0 ? cleanMetadata : null,
    examples: mod.examples.length > 0 ? ([...mod.examples] as ModuleExample[]) : null,
  });
}

/** An empty JSON Schema object, used when a tool declares no schema. */
export const EMPTY_OBJECT_SCHEMA: Record<string, unknown> = Object.freeze({
  type: 'object',
  properties: {},
});
