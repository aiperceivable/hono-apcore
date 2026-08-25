import { APCORE_ENV_PREFIX } from './constants.js';

/**
 * The canonical `APCORE_*` settings every apcore framework integration
 * implements with identical names, types, and defaults.
 *
 * Values are read from `process.env` (or any object passed to
 * {@link loadSettings}) and normalised into this camelCase shape.
 */
export interface ApcoreSettings {
  /** `APCORE_ENABLED` — master switch. */
  enabled: boolean;
  /** `APCORE_DEBUG` — verbose logging / introspection. */
  debug: boolean;
  /** `APCORE_SCANNERS` — enabled scanner identifiers. */
  scanners: string[];
  /** `APCORE_INCLUDE_PATHS` — route patterns to include (empty = all). */
  includePaths: string[];
  /** `APCORE_EXCLUDE_PATHS` — route patterns to exclude. */
  excludePaths: string[];
  /** `APCORE_MODULE_PREFIX` — prefix prepended to generated module IDs. */
  modulePrefix: string;
  /** `APCORE_AUTH_ENABLED` — require auth for MCP/A2A endpoints. */
  authEnabled: boolean;
  /** `APCORE_AUTH_STRATEGY` — `bearer` / `session` / `custom`. */
  authStrategy: 'bearer' | 'session' | 'custom';
  /** `APCORE_TRANSPORT` — MCP transport: `stdio` / `http` / `sse`. */
  transport: 'stdio' | 'http' | 'sse';
  /** `APCORE_HOST` — bind address when transport is not stdio. */
  host: string;
  /** `APCORE_PORT` — bind port when transport is not stdio. */
  port: number;
}

/** Authoritative defaults, shared across every apcore integration. */
export const APCORE_SETTING_DEFAULTS: Readonly<ApcoreSettings> = Object.freeze({
  enabled: true,
  debug: false,
  scanners: ['auto'],
  includePaths: [],
  excludePaths: [],
  modulePrefix: '',
  authEnabled: false,
  authStrategy: 'bearer',
  transport: 'stdio',
  host: '0.0.0.0',
  port: 8808,
});

/** Minimal shape of an environment source (`process.env` satisfies it). */
export type EnvSource = Record<string, string | undefined>;

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1' || value === 'yes' || value === 'on') return true;
  if (value === 'false' || value === '0' || value === 'no' || value === 'off') return false;
  return fallback;
}

function parseList(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined) return [...fallback];
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items;
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0 || value > 65535) return fallback;
  return value;
}

function parseEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase() as T;
  return allowed.includes(value) ? value : fallback;
}

/**
 * Read the canonical `APCORE_*` settings from an environment source.
 *
 * Unset or unparseable variables fall back to {@link APCORE_SETTING_DEFAULTS}.
 * `overrides` win over the environment, letting code configure the same
 * knobs without mutating `process.env`.
 *
 * @param env - Environment source. Defaults to `process.env` when available.
 * @param overrides - Values that take precedence over the environment.
 */
export function loadSettings(
  env: EnvSource = typeof process !== 'undefined' ? process.env : {},
  overrides: Partial<ApcoreSettings> = {},
): ApcoreSettings {
  const key = (name: string): string | undefined => env[`${APCORE_ENV_PREFIX}${name}`];

  const fromEnv: ApcoreSettings = {
    enabled: parseBool(key('ENABLED'), APCORE_SETTING_DEFAULTS.enabled),
    debug: parseBool(key('DEBUG'), APCORE_SETTING_DEFAULTS.debug),
    scanners: parseList(key('SCANNERS'), APCORE_SETTING_DEFAULTS.scanners),
    includePaths: parseList(key('INCLUDE_PATHS'), APCORE_SETTING_DEFAULTS.includePaths),
    excludePaths: parseList(key('EXCLUDE_PATHS'), APCORE_SETTING_DEFAULTS.excludePaths),
    modulePrefix: key('MODULE_PREFIX') ?? APCORE_SETTING_DEFAULTS.modulePrefix,
    authEnabled: parseBool(key('AUTH_ENABLED'), APCORE_SETTING_DEFAULTS.authEnabled),
    authStrategy: parseEnum(
      key('AUTH_STRATEGY'),
      ['bearer', 'session', 'custom'] as const,
      APCORE_SETTING_DEFAULTS.authStrategy,
    ),
    transport: parseEnum(
      key('TRANSPORT'),
      ['stdio', 'http', 'sse'] as const,
      APCORE_SETTING_DEFAULTS.transport,
    ),
    host: key('HOST') ?? APCORE_SETTING_DEFAULTS.host,
    port: parsePort(key('PORT'), APCORE_SETTING_DEFAULTS.port),
  };

  return { ...fromEnv, ...overrides };
}

/**
 * Translate the canonical `APCORE_TRANSPORT` value to the transport name
 * `apcore-mcp` expects.
 *
 * `"http"` is the ecosystem-wide spelling; `apcore-mcp` calls the same
 * transport `"streamable-http"`.
 */
export function toMcpTransport(
  transport: ApcoreSettings['transport'],
): 'stdio' | 'streamable-http' | 'sse' {
  return transport === 'http' ? 'streamable-http' : transport;
}
