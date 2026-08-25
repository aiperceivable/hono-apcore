import type { TSchema } from '@sinclair/typebox';
import type { SchemaAdapter } from './schema-adapter.interface.js';

/**
 * Well-known TypeBox symbol tagging every schema node. Looking it up lets
 * detection work without importing TypeBox at runtime.
 */
const KIND = Symbol.for('TypeBox.Kind');

/**
 * Schema adapter for `@sinclair/typebox` schemas.
 *
 * TypeBox schemas are already valid JSON Schema objects decorated with extra
 * `Symbol` properties that the TypeBox runtime (`Value.Check()`) relies on.
 */
export class TypeBoxAdapter implements SchemaAdapter {
  readonly name = 'typebox' as const;
  readonly priority = 100;

  /** Returns `true` when `input` carries `Symbol.for('TypeBox.Kind')`. */
  detect(input: unknown): boolean {
    if (input === null || input === undefined) return false;
    if (typeof input !== 'object') return false;
    return KIND in (input as object);
  }

  /**
   * Return the TypeBox schema as-is — its `Symbol` keys must survive for
   * runtime validation to work.
   */
  extract(input: unknown): TSchema {
    return input as TSchema;
  }

  /**
   * Convert a TypeBox schema to plain JSON Schema. Because TypeBox *is* JSON
   * Schema with extra symbol decorations, a JSON round-trip drops the symbols
   * and leaves a standards-compliant document.
   */
  extractJsonSchema(input: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  }
}
