import type { TSchema } from '@sinclair/typebox';
import type { SchemaAdapter } from './adapters/schema-adapter.interface.js';
import { TypeBoxAdapter } from './adapters/typebox.adapter.js';
import { ZodAdapter } from './adapters/zod.adapter.js';
import { JsonSchemaAdapter } from './adapters/json-schema.adapter.js';

/** Thrown when no registered adapter can handle the provided input. */
export class SchemaExtractionError extends Error {
  override readonly name = 'SchemaExtractionError';

  constructor(message: string) {
    super(message);
    // Restore the prototype chain when down-levelling or extending built-ins.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const NO_MATCH =
  'No adapter matched the provided input. ' +
  'Provide a TypeBox schema, a Zod schema, or a plain JSON Schema object.';

/**
 * Delegates schema detection and conversion to a prioritised chain of
 * {@link SchemaAdapter}s.
 *
 * Built-in adapters, tried in descending priority order:
 *
 * | Adapter            | Priority |
 * |--------------------|----------|
 * | TypeBoxAdapter     | 100      |
 * | ZodAdapter         | 50       |
 * | JsonSchemaAdapter  | 30       |
 *
 * Register your own with {@link registerAdapter}; it is inserted into the
 * chain according to its `priority`.
 */
export class SchemaExtractor {
  private adapters: SchemaAdapter[];

  constructor(adapters?: SchemaAdapter[]) {
    this.adapters = adapters ?? [new TypeBoxAdapter(), new ZodAdapter(), new JsonSchemaAdapter()];
    this.sortAdapters();
  }

  /** Add a custom adapter and re-sort the chain (highest priority first). */
  registerAdapter(adapter: SchemaAdapter): void {
    this.adapters.push(adapter);
    this.sortAdapters();
  }

  /** Names of the adapters in the chain, highest priority first. */
  get adapterNames(): string[] {
    return this.adapters.map((adapter) => adapter.name);
  }

  /**
   * Name of the first adapter that claims `input`, or `null` when none
   * recognises it.
   */
  detect(input: unknown): string | null {
    for (const adapter of this.adapters) {
      if (adapter.detect(input)) {
        return adapter.name;
      }
    }
    return null;
  }

  /**
   * Extract a TypeBox-compatible `TSchema` from `input`.
   *
   * @throws {SchemaExtractionError} When no adapter can handle the input.
   */
  extract(input: unknown): TSchema {
    for (const adapter of this.adapters) {
      if (adapter.detect(input)) {
        return adapter.extract(input);
      }
    }
    throw new SchemaExtractionError(NO_MATCH);
  }

  /**
   * Extract a plain JSON Schema object from `input`.
   *
   * @throws {SchemaExtractionError} When no adapter can handle the input.
   */
  extractJsonSchema(input: unknown): Record<string, unknown> {
    for (const adapter of this.adapters) {
      if (adapter.detect(input)) {
        return adapter.extractJsonSchema(input);
      }
    }
    throw new SchemaExtractionError(NO_MATCH);
  }

  private sortAdapters(): void {
    this.adapters.sort((a, b) => b.priority - a.priority);
  }
}

/** Process-wide extractor used by the tool registrar and route scanner. */
export const defaultSchemaExtractor = new SchemaExtractor();
