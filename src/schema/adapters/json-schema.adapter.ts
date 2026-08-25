import type { TSchema } from '@sinclair/typebox';
import type { SchemaAdapter } from './schema-adapter.interface.js';

/** Well-known symbol used by @sinclair/typebox to tag its schema objects. */
const TYPEBOX_KIND = Symbol.for('TypeBox.Kind');

/**
 * Schema adapter for plain JSON Schema objects.
 *
 * JSON Schema is structurally compatible with TypeBox's `TSchema`, so
 * conversion is a deep clone via JSON round-trip.
 */
export class JsonSchemaAdapter implements SchemaAdapter {
  readonly name = 'json-schema' as const;
  readonly priority = 30;

  /**
   * Returns `true` for a non-null, non-array object that carries a `type`,
   * `properties`, `anyOf`, `oneOf`, or `$ref` key and is not already a
   * TypeBox schema (those belong to {@link TypeBoxAdapter}).
   */
  detect(input: unknown): boolean {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return false;
    }

    const obj = input as Record<string | symbol, unknown>;

    if (TYPEBOX_KIND in obj) {
      return false;
    }

    return (
      'type' in obj ||
      'properties' in obj ||
      'anyOf' in obj ||
      'oneOf' in obj ||
      '$ref' in obj
    );
  }

  /** Deep-clone the JSON Schema; it doubles as a structurally valid TSchema. */
  extract(input: unknown): TSchema {
    return JSON.parse(JSON.stringify(input)) as TSchema;
  }

  /** Deep-clone the JSON Schema. */
  extractJsonSchema(input: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  }
}
