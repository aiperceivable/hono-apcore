/**
 * Convert a PascalCase or camelCase string to snake_case.
 *
 * Handles consecutive uppercase letters (acronyms) by inserting an
 * underscore before the last uppercase letter of the run when it is
 * followed by a lowercase letter — `"HTTPClient"` becomes `"http_client"`.
 */
export function toSnakeCase(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

/**
 * Suffixes stripped from handler/object names before normalisation.
 *
 * Hono has no class conventions of its own, so this covers the names people
 * actually give the plain service objects they register.
 */
const SERVICE_SUFFIXES = ['Service', 'Handler', 'Handlers', 'Controller', 'Routes', 'Router'];

/**
 * Normalise a service/object name into a namespace segment: strip a trailing
 * service suffix, then convert the remainder to snake_case.
 *
 * A name consisting *only* of a suffix is kept as-is (lowercased) rather than
 * collapsing to an empty string.
 *
 * @example
 * normalizeName('TodoService')  // 'todo'
 * normalizeName('WeatherRoutes') // 'weather'
 * normalizeName('HTTPClient')   // 'http_client'
 */
export function normalizeName(name: string): string {
  let stripped = name;

  for (const suffix of SERVICE_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      stripped = name.slice(0, -suffix.length);
      break;
    }
  }

  return toSnakeCase(stripped);
}

/**
 * Normalise a method / tool name by converting camelCase to snake_case.
 *
 * @example
 * normalizeMethodName('sendEmail')  // 'send_email'
 * normalizeMethodName('send_email') // 'send_email'
 */
export function normalizeMethodName(name: string): string {
  return toSnakeCase(name);
}

/**
 * Build a fully-qualified module ID of the form `"namespace.name"`.
 *
 * @param namespace  - Namespace portion of the ID.
 * @param name       - Name portion of the ID.
 * @param normalizeInputs - Apply {@link normalizeName} / {@link normalizeMethodName}
 *   to the two segments before joining.
 * @param explicitId - Returned verbatim when non-null, bypassing generation.
 *
 * @example
 * generateModuleId('todo', 'list')                         // 'todo.list'
 * generateModuleId('TodoService', 'listAll', true)         // 'todo.list_all'
 * generateModuleId('a', 'b', false, 'custom.override')     // 'custom.override'
 */
export function generateModuleId(
  namespace: string,
  name: string,
  normalizeInputs?: boolean,
  explicitId?: string | null,
): string {
  if (explicitId != null) {
    return explicitId;
  }

  const ns = normalizeInputs ? normalizeName(namespace) : namespace;
  const n = normalizeInputs ? normalizeMethodName(name) : name;

  return ns.length > 0 ? `${ns}.${n}` : n;
}

/**
 * Prepend a module-ID prefix, inserting the separating dot only when needed.
 *
 * An empty prefix returns the ID unchanged, and a prefix that already ends
 * with `"."` is not given a second one.
 */
export function applyModulePrefix(moduleId: string, prefix?: string): string {
  if (!prefix) return moduleId;
  return prefix.endsWith('.') ? `${prefix}${moduleId}` : `${prefix}.${moduleId}`;
}
