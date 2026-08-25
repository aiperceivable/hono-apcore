import type { ModuleDescriptor, Registry } from 'apcore-js';
import { createScannedModule, moduleToDict, modulesToDicts } from 'apcore-toolkit';
import type { ScannedModule } from 'apcore-toolkit';
import type {
  ApToolDefinition,
  RegisterMethodOptions,
  RegisterObjectOptions,
} from '../types.js';
import { generateModuleId, normalizeName, normalizeMethodName } from '../utils/id-generator.js';
import {
  EMPTY_OBJECT_SCHEMA,
  normalizeResult,
  scannedModuleToFunctionModule,
  toModuleAnnotations,
} from '../utils/module-factory.js';
import type { BoundExecuteFn } from '../utils/module-factory.js';
import { toolToScannedModule } from '../tools/define-tool.js';
import type { ToolConversionOptions } from '../tools/define-tool.js';

/**
 * Collect every own method name along an object's prototype chain, stopping
 * before `Object.prototype`. `constructor` is excluded.
 *
 * Own enumerable function-valued properties are included too, so object
 * literals of arrow functions register as readily as class instances.
 */
function getAllMethodNames(instance: object): string[] {
  const methods = new Set<string>();

  for (const [name, value] of Object.entries(instance)) {
    if (typeof value === 'function') methods.add(name);
  }

  let proto: object | null = Object.getPrototypeOf(instance) as object | null;
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (descriptor && typeof descriptor.value === 'function') {
        methods.add(name);
      }
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }

  return [...methods];
}

/**
 * Thin wrapper around the upstream apcore-js `Registry`.
 *
 * Delegates the core operations and adds the registration conveniences a
 * Hono app wants: registering a {@link ApToolDefinition}, a single method of
 * a service object, or every method at once.
 */
export class ApcoreRegistry {
  constructor(private readonly registry: Registry) {}

  // -------------------------------------------------------------------------
  // Raw access
  // -------------------------------------------------------------------------

  /** The underlying apcore-js `Registry`. */
  get raw(): Registry {
    return this.registry;
  }

  // -------------------------------------------------------------------------
  // Delegated operations
  // -------------------------------------------------------------------------

  async register(moduleId: string, module: unknown): Promise<void> {
    await this.registry.register(moduleId, module);
  }

  unregister(moduleId: string): boolean {
    return this.registry.unregister(moduleId);
  }

  get(moduleId: string): unknown | null {
    return this.registry.get(moduleId);
  }

  has(moduleId: string): boolean {
    return this.registry.has(moduleId);
  }

  list(options?: { tags?: string[]; prefix?: string }): string[] {
    return this.registry.list(options);
  }

  getDefinition(moduleId: string): ModuleDescriptor | null {
    return this.registry.getDefinition(moduleId);
  }

  on(event: string, callback: (moduleId: string, module: unknown) => void): void {
    this.registry.on(event, callback);
  }

  discover(): Promise<number> {
    return this.registry.discover();
  }

  get count(): number {
    return this.registry.count;
  }

  // -------------------------------------------------------------------------
  // Serialisation helpers (via apcore-toolkit)
  // -------------------------------------------------------------------------

  /**
   * Convert a registered module's descriptor into a toolkit `ScannedModule`.
   *
   * Returns `null` when the module is not registered.
   */
  toScannedModule(moduleId: string): ScannedModule | null {
    const def = this.registry.getDefinition(moduleId);
    if (!def) return null;

    return createScannedModule({
      moduleId: def.moduleId,
      description: def.description,
      inputSchema: def.inputSchema as Record<string, unknown>,
      outputSchema: def.outputSchema as Record<string, unknown>,
      tags: (def.tags as string[]) ?? [],
      target: moduleId,
      annotations: def.annotations ?? null,
      documentation: def.documentation ?? null,
      examples: (def.examples ?? []) as never[],
      metadata: def.metadata ?? {},
    });
  }

  /**
   * Serialise one registered module to a snake_case dictionary via
   * apcore-toolkit's `moduleToDict()`. Returns `null` when not found.
   */
  toDict(moduleId: string): Record<string, unknown> | null {
    const scanned = this.toScannedModule(moduleId);
    return scanned ? moduleToDict(scanned) : null;
  }

  /** Serialise every registered module (optionally filtered) to dictionaries. */
  toDicts(options?: { tags?: string[]; prefix?: string }): Record<string, unknown>[] {
    const scanned: ScannedModule[] = [];
    for (const id of this.registry.list(options)) {
      const module = this.toScannedModule(id);
      if (module) scanned.push(module);
    }
    return modulesToDicts(scanned);
  }

  // -------------------------------------------------------------------------
  // Registration conveniences
  // -------------------------------------------------------------------------

  /**
   * Register a scanned module together with its bound execute function.
   *
   * The lowest-level entry point — the tool registrar, the route scanner, and
   * the YAML binding loader all funnel through here.
   */
  async registerScanned(module: ScannedModule, execute: BoundExecuteFn): Promise<string> {
    await this.registry.register(module.moduleId, scannedModuleToFunctionModule(module, execute));
    return module.moduleId;
  }

  /**
   * Register a single {@link ApToolDefinition}.
   *
   * @returns The module ID it was registered under.
   */
  async registerTool(
    tool: ApToolDefinition,
    options?: ToolConversionOptions,
  ): Promise<string> {
    const { module, execute } = toolToScannedModule(tool, options);
    return this.registerScanned(module, execute);
  }

  /** Register several tool definitions, preserving their order. */
  async registerTools(
    tools: ApToolDefinition[],
    options?: ToolConversionOptions,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const tool of tools) {
      ids.push(await this.registerTool(tool, options));
    }
    return ids;
  }

  /**
   * Register one method of a service object as a module.
   *
   * @returns The module ID it was registered under.
   * @throws {Error} When `method` is not a function on `instance`.
   */
  async registerMethod(options: RegisterMethodOptions): Promise<string> {
    const {
      instance,
      method,
      description,
      id,
      inputSchema,
      outputSchema,
      annotations,
      tags,
      documentation,
      examples,
    } = options;

    const fn = (instance as Record<string, unknown>)[method];
    if (typeof fn !== 'function') {
      throw new Error(
        `Method "${method}" does not exist on ${instance.constructor?.name ?? 'object'}`,
      );
    }

    const objectName = instance.constructor?.name ?? 'object';
    const moduleId = generateModuleId(objectName, method, true, id);

    const scanned = createScannedModule({
      moduleId,
      description,
      inputSchema: (inputSchema as Record<string, unknown>) ?? { ...EMPTY_OBJECT_SCHEMA },
      outputSchema: (outputSchema as Record<string, unknown>) ?? { ...EMPTY_OBJECT_SCHEMA },
      tags: tags ?? [],
      target: `${objectName}.${method}`,
      annotations: toModuleAnnotations(annotations),
      documentation: documentation ?? null,
      examples: examples ?? [],
    });

    const execute: BoundExecuteFn = async (inputs, context) => {
      const raw = await (fn as (...args: unknown[]) => unknown).call(instance, inputs, context);
      return normalizeResult(raw);
    };

    return this.registerScanned(scanned, execute);
  }

  /**
   * Register several — or every — method of a service object.
   *
   * With `methods: '*'`, public methods are discovered by walking the
   * prototype chain and own enumerable properties, minus anything in
   * `exclude`.
   *
   * @returns The module IDs that were registered.
   */
  async registerObject(options: RegisterObjectOptions): Promise<string[]> {
    const {
      instance,
      description,
      methods,
      exclude = [],
      namespace,
      annotations,
      tags,
      methodOptions = {},
    } = options;

    const methodNames = (
      methods === '*' ? getAllMethodNames(instance) : methods
    ).filter((name) => !exclude.includes(name));

    const ns = namespace ?? normalizeName(instance.constructor?.name ?? 'object');
    const registeredIds: string[] = [];

    for (const methodName of methodNames) {
      const perMethod = methodOptions[methodName] ?? {};
      const moduleId = perMethod.id ?? `${ns}.${normalizeMethodName(methodName)}`;

      registeredIds.push(
        await this.registerMethod({
          instance,
          method: methodName,
          description: perMethod.description ?? description ?? methodName,
          id: moduleId,
          inputSchema: perMethod.inputSchema,
          outputSchema: perMethod.outputSchema,
          annotations: perMethod.annotations ?? annotations,
          tags: perMethod.tags ?? tags,
          documentation: perMethod.documentation,
          examples: perMethod.examples,
        }),
      );
    }

    return registeredIds;
  }
}
