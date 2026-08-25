import type { TSchema } from '@sinclair/typebox';

/**
 * Contract for pluggable schema adapters.
 *
 * Each adapter knows how to detect one schema dialect (TypeBox, Zod, plain
 * JSON Schema, ...) and convert it into the two canonical representations
 * apcore consumes.
 */
export interface SchemaAdapter {
  /** Human-readable adapter name, e.g. `'typebox'` or `'json-schema'`. */
  readonly name: string;

  /**
   * Selection weight. Adapters are tried in **descending** priority order,
   * so a higher number wins when two adapters both claim an input.
   */
  readonly priority: number;

  /** Return `true` when `input` is a schema this adapter can handle. */
  detect(input: unknown): boolean;

  /** Convert `input` into a TypeBox-compatible `TSchema` object. */
  extract(input: unknown): TSchema;

  /** Convert `input` into a plain JSON Schema object. */
  extractJsonSchema(input: unknown): Record<string, unknown>;
}
