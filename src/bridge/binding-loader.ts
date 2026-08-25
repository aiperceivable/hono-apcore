import { readFile } from 'node:fs/promises';
import * as yaml from 'js-yaml';
import { createScannedModule } from 'apcore-toolkit';
import type { ApcoreRegistry } from '../core/registry.js';
import {
  EMPTY_OBJECT_SCHEMA,
  normalizeResult,
  toModuleAnnotations,
} from '../utils/module-factory.js';
import type { BoundExecuteFn } from '../utils/module-factory.js';
import type { ApToolAnnotations } from '../types.js';

/** A single binding entry parsed from YAML. */
interface BindingEntry {
  module_id: string;
  target: string;
  description: string;
  input_schema?: unknown;
  output_schema?: unknown;
  annotations?: Record<string, unknown>;
  tags?: string[];
  documentation?: string;
}

/** Top-level structure of a bindings YAML file. */
interface BindingsFile {
  bindings?: BindingEntry[];
}

/**
 * Resolves the `"Object.method"` target of a binding entry to a live handler.
 *
 * Returning `undefined` leaves the module registered but non-functional,
 * which surfaces the missing wiring at call time rather than at boot.
 */
export type TargetResolver = (
  target: string,
) => ((inputs: Record<string, unknown>, context?: unknown) => unknown) | undefined;

/**
 * Builds a resolver over a map of named service objects.
 *
 * @example
 * ```ts
 * const loader = new ApBindingLoader(apcore.registry, resolverFromObjects({ TodoService: todo }));
 * await loader.loadFromFile('./bindings.yaml');   // target: TodoService.list
 * ```
 */
export function resolverFromObjects(objects: Record<string, object>): TargetResolver {
  return (target: string) => {
    const [objectName, methodName] = target.split('.');
    if (!objectName || !methodName) return undefined;

    const instance = objects[objectName];
    if (!instance) return undefined;

    const fn = (instance as Record<string, unknown>)[methodName];
    if (typeof fn !== 'function') return undefined;

    return (inputs, context) =>
      (fn as (...args: unknown[]) => unknown).call(instance, inputs, context);
  };
}

/**
 * Registers apcore modules declared in a YAML bindings file — the zero-code
 * path for exposing existing functions as AI tools.
 *
 * Uses apcore-toolkit's `createScannedModule()` to build the standard
 * intermediate, then hands it to {@link ApcoreRegistry.registerScanned}.
 */
export class ApBindingLoader {
  constructor(
    private readonly registry: ApcoreRegistry,
    private readonly resolveTarget?: TargetResolver,
  ) {}

  /**
   * Parse YAML describing bindings and register each entry.
   *
   * @param content - Raw YAML string.
   * @returns The module IDs that were registered.
   */
  async loadFromString(content: string): Promise<string[]> {
    const parsed = (yaml.load(content) ?? {}) as BindingsFile;
    const bindings = parsed.bindings ?? [];
    const ids: string[] = [];

    for (const binding of bindings) {
      const moduleId = binding.module_id;
      const handler = this.resolveTarget?.(binding.target);

      const execute: BoundExecuteFn = handler
        ? async (inputs, context) => normalizeResult(await handler(inputs, context))
        : async () => ({
            error: `No handler resolved for binding target "${binding.target}"`,
          });

      const scanned = createScannedModule({
        moduleId,
        description: binding.description,
        inputSchema:
          (binding.input_schema as Record<string, unknown>) ?? { ...EMPTY_OBJECT_SCHEMA },
        outputSchema:
          (binding.output_schema as Record<string, unknown>) ?? { ...EMPTY_OBJECT_SCHEMA },
        tags: binding.tags ?? [],
        target: binding.target,
        annotations: toModuleAnnotations(binding.annotations as ApToolAnnotations | undefined),
        documentation: binding.documentation ?? null,
      });

      ids.push(await this.registry.registerScanned(scanned, execute));
    }

    return ids;
  }

  /**
   * Read a YAML bindings file from disk and register its entries.
   *
   * @param filePath - Absolute or CWD-relative path to the YAML file.
   * @returns The module IDs that were registered.
   */
  async loadFromFile(filePath: string): Promise<string[]> {
    return this.loadFromString(await readFile(filePath, 'utf-8'));
  }
}
