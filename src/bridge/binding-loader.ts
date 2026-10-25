import { readFile } from 'node:fs/promises';
import * as yaml from 'js-yaml';
import { parseBindingDocument } from 'apcore-toolkit';
import type { ApcoreRegistry } from '../core/registry.js';
import {
  EMPTY_OBJECT_SCHEMA,
  normalizeResult,
} from '../utils/module-factory.js';
import type { BoundExecuteFn } from '../utils/module-factory.js';
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
    const parsed: unknown = yaml.load(content);
    // Preserve empty documents; validate non-empty documents with the SDK parser.
    const empty = parsed == null || (
      typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 0
    );
    const bindings = parseBindingDocument(empty ? { bindings: [] } : parsed);
    const ids: string[] = [];

    for (const binding of bindings) {
      const handler = this.resolveTarget?.(binding.target);

      const execute: BoundExecuteFn = handler
        ? async (inputs, context) => normalizeResult(await handler(inputs, context))
        : async () => ({
            error: `No handler resolved for binding target "${binding.target}"`,
          });

      const scanned = {
        ...binding,
        inputSchema: Object.keys(binding.inputSchema).length
          ? binding.inputSchema : { ...EMPTY_OBJECT_SCHEMA },
        outputSchema: Object.keys(binding.outputSchema).length
          ? binding.outputSchema : { ...EMPTY_OBJECT_SCHEMA },
      };

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
