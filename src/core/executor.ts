import type { Context, Executor, PreflightResult } from 'apcore-js';

/**
 * Thin wrapper around the upstream apcore-js `Executor`.
 *
 * Every delegation normalises `null` / `undefined` inputs to `{}` so callers
 * never have to think about nullability at the call site.
 */
export class ApcoreExecutor {
  constructor(private readonly executor: Executor) {}

  /** The underlying apcore-js `Executor`. */
  get raw(): Executor {
    return this.executor;
  }

  /**
   * Execute a module by ID.
   *
   * @param moduleId - Fully-qualified module identifier (e.g. `"todo.list"`).
   * @param inputs   - Key/value inputs; `null` / `undefined` become `{}`.
   * @param context  - Optional execution context (identity, trace, data).
   */
  async call(
    moduleId: string,
    inputs?: Record<string, unknown> | null,
    context?: Context | null,
  ): Promise<Record<string, unknown>> {
    return this.executor.call(moduleId, inputs ?? {}, context);
  }

  /**
   * Stream execution results from a module, yielding each chunk produced by
   * the upstream generator.
   */
  async *stream(
    moduleId: string,
    inputs?: Record<string, unknown> | null,
    context?: Context | null,
  ): AsyncGenerator<Record<string, unknown>> {
    yield* this.executor.stream(moduleId, inputs ?? {}, context);
  }

  /**
   * Run preflight checks — schema, ACL, approval, call-chain — without
   * executing the module.
   */
  validate(
    moduleId: string,
    inputs?: Record<string, unknown> | null,
    context?: Context | null,
  ): Promise<PreflightResult> {
    return this.executor.validate(moduleId, inputs ?? {}, context);
  }
}
