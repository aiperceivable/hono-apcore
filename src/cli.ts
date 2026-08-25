#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { formatModules } from 'apcore-toolkit';
import type { ScannedModule } from 'apcore-toolkit';
import { HonoApcore } from './core/apcore.js';
import { HonoRouteScanner } from './scanners/hono-route-scanner.js';
import type { HonoAppLike } from './scanners/hono-route-scanner.js';
import { renderBindingsYaml, writeBindingsFile } from './output/yaml-writer.js';
import { ApcoreMcpService } from './mcp/apcore-mcp.service.js';
import { loadSettings, toMcpTransport } from './config.js';
import type { ApcoreSettings } from './config.js';
import type { RouteScanOptions } from './types.js';

const USAGE = `hono-apcore — expose a Hono app as apcore modules

Usage:
  hono-apcore <command> <entry> [options]

Commands:
  scan     Scan the app's routes and print or write the module bindings
  serve    Scan, then start an MCP server exposing the modules as tools
  export   Write OpenAI-compatible tool definitions as JSON

Entry:
  <path>[:<export>]   Module to import. <export> defaults to "default", then "app".
                      TypeScript entries need a loader, e.g.
                        npx tsx node_modules/.bin/hono-apcore scan ./src/app.ts

Options:
  --out <file>        scan/export: write to this file instead of stdout
  --format <fmt>      scan: yaml | json | markdown | table (default: table)
  --transport <t>     serve: stdio | http | sse            (default: $APCORE_TRANSPORT)
  --host <host>       serve: bind address                  (default: $APCORE_HOST)
  --port <n>          serve: bind port                     (default: $APCORE_PORT)
  --explorer          serve: enable the MCP Tool Explorer UI
  --allow-execute     serve: allow tool execution from the Explorer
  --name <name>       serve: MCP server name
  --bindings <file>   Load additional modules from a YAML bindings file
  --prefix <str>      Prefix prepended to generated module IDs
  --include <regex>   Keep only module IDs matching this pattern
  --exclude <regex>   Drop module IDs matching this pattern
  -h, --help          Show this help
  -v, --version       Show the package version
`;

/** Everything the CLI needs from a loaded entry module. */
interface ResolvedEntry {
  instance: HonoApcore;
  app: HonoAppLike | null;
}

function isHonoApp(value: unknown): value is HonoAppLike {
  return (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray((value as HonoAppLike).routes) &&
    typeof (value as HonoAppLike).request === 'function'
  );
}

/**
 * Duck-typed rather than `instanceof`: the entry may have been built against a
 * different copy of this package (a workspace link, two versions in the tree),
 * and a real instance under a second copy is still the instance the user meant.
 */
function isHonoApcore(value: unknown): value is HonoApcore {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<HonoApcore>;
  return (
    typeof candidate.registerTool === 'function' &&
    typeof candidate.scanRoutes === 'function' &&
    typeof candidate.init === 'function' &&
    candidate.registry !== undefined &&
    candidate.executor !== undefined
  );
}

/**
 * Import the entry module and work out which export is the Hono app and
 * which — if any — is a pre-configured {@link HonoApcore}.
 */
async function resolveEntry(spec: string): Promise<ResolvedEntry> {
  const separator = spec.lastIndexOf(':');
  // A Windows drive letter ("C:\...") is not an export separator.
  const hasExport = separator > 1;
  const modulePath = hasExport ? spec.slice(0, separator) : spec;
  const exportName = hasExport ? spec.slice(separator + 1) : undefined;

  const url = pathToFileURL(resolvePath(process.cwd(), modulePath)).href;
  const mod = (await import(url)) as Record<string, unknown>;

  const named = exportName ? mod[exportName] : undefined;
  if (exportName && named === undefined) {
    throw new Error(`Entry module "${modulePath}" has no export named "${exportName}".`);
  }

  const candidate = named ?? mod['default'] ?? mod['app'];

  // A configured instance may be exported under any name — apps commonly call
  // it `ap`, because `apcore` is already taken by the middleware import.
  const instance =
    (isHonoApcore(candidate) ? candidate : undefined) ??
    Object.values(mod).find(isHonoApcore) ??
    new HonoApcore();

  const app = isHonoApp(candidate)
    ? candidate
    : isHonoApp(mod['app'])
      ? (mod['app'] as HonoAppLike)
      : isHonoApp(mod['default'])
        ? (mod['default'] as HonoAppLike)
        : null;

  return { instance, app };
}

/** Scan the app's routes without registering, for `scan` and `export` output. */
function scanModules(app: HonoAppLike | null, options: RouteScanOptions): ScannedModule[] {
  if (!app) return [];
  return new HonoRouteScanner().scan(app, options);
}

/**
 * Build the scan options for a command: the entry's own configuration first,
 * then the CLI flags. A flag that was not passed leaves the entry's value
 * alone, so `scan` reports the same modules the app itself registers.
 */
function routeOptions(
  values: Record<string, unknown>,
  instance?: HonoApcore,
): RouteScanOptions {
  const base = instance?.routeOptions ?? {
    modulePrefix: loadSettings().modulePrefix || undefined,
    includePaths: loadSettings().includePaths,
    excludePaths: loadSettings().excludePaths,
  };

  const overrides: RouteScanOptions = {};
  if (values['prefix'] !== undefined) overrides.modulePrefix = values['prefix'] as string;
  if (values['include'] !== undefined) overrides.include = values['include'] as string;
  if (values['exclude'] !== undefined) overrides.exclude = values['exclude'] as string;

  return { ...base, ...overrides };
}

async function emit(content: string, out?: string): Promise<void> {
  if (out) {
    await writeFile(out, content, 'utf-8');
    process.stdout.write(`Wrote ${out}\n`);
  } else {
    process.stdout.write(content.endsWith('\n') ? content : `${content}\n`);
  }
}

async function commandScan(entry: string, values: Record<string, unknown>): Promise<void> {
  const { app, instance } = await resolveEntry(entry);
  if (!app) {
    throw new Error('Entry module does not export a Hono app — nothing to scan.');
  }

  const modules = scanModules(app, routeOptions(values, instance));
  const format = (values['format'] as string | undefined) ?? 'table';
  const out = values['out'] as string | undefined;

  if (format === 'yaml') {
    if (out) {
      await writeBindingsFile(modules, out);
      process.stdout.write(`Wrote ${out} (${modules.length} modules)\n`);
      return;
    }
    await emit(renderBindingsYaml(modules));
    return;
  }

  if (format === 'json') {
    await emit(JSON.stringify(formatModules(modules, { style: 'json' }), null, 2), out);
    return;
  }

  const style = format === 'markdown' ? 'markdown' : 'table-row';
  await emit(String(formatModules(modules, { style })), out);
}

async function commandServe(entry: string, values: Record<string, unknown>): Promise<void> {
  const { instance, app } = await resolveEntry(entry);
  const settings = loadSettings();

  await instance.init(app ?? undefined, routeOptions(values, instance));

  if (values['bindings']) {
    await instance.loadBindings(values['bindings'] as string);
  }

  // A zero-config entry (a bare Hono app) still gets an MCP surface here, so
  // `hono-apcore serve ./src/app.ts` works without touching the app's source.
  const mcp =
    instance.mcp ?? new ApcoreMcpService(instance.registry, instance.executor, {});

  const transport = toMcpTransport(
    ((values['transport'] as string | undefined) ?? settings.transport) as
      ApcoreSettings['transport'],
  );
  const port = values['port'] !== undefined ? Number(values['port']) : undefined;

  process.stderr.write(
    `hono-apcore: serving ${instance.registry.count} modules over ${transport}\n`,
  );

  await mcp.start({
    transport,
    host: values['host'] as string | undefined,
    port: Number.isFinite(port) ? port : undefined,
    explorer: values['explorer'] as boolean | undefined,
    allowExecute: values['allow-execute'] as boolean | undefined,
    name: values['name'] as string | undefined,
  });
}

async function commandExport(entry: string, values: Record<string, unknown>): Promise<void> {
  const { instance, app } = await resolveEntry(entry);
  await instance.init(app ?? undefined, routeOptions(values, instance));

  const mcp =
    instance.mcp ?? new ApcoreMcpService(instance.registry, instance.executor, {});
  const tools = await mcp.toOpenaiTools();
  await emit(JSON.stringify(tools, null, 2), values['out'] as string | undefined);
}

/** Parse argv and dispatch. Exported so tests can drive the CLI directly. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      format: { type: 'string' },
      transport: { type: 'string' },
      host: { type: 'string' },
      port: { type: 'string' },
      explorer: { type: 'boolean' },
      'allow-execute': { type: 'boolean' },
      name: { type: 'string' },
      bindings: { type: 'string' },
      prefix: { type: 'string' },
      include: { type: 'string' },
      exclude: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.version) {
    const { VERSION } = await import('apcore-js');
    process.stdout.write(`hono-apcore (apcore-js ${VERSION})\n`);
    return 0;
  }

  if (values.help || positionals.length === 0) {
    process.stdout.write(USAGE);
    return 0;
  }

  const [command, entry] = positionals;
  if (!entry) {
    process.stderr.write(`hono-apcore: "${command}" needs an entry module.\n\n${USAGE}`);
    return 2;
  }

  switch (command) {
    case 'scan':
      await commandScan(entry, values);
      return 0;
    case 'serve':
      await commandServe(entry, values);
      return 0;
    case 'export':
      await commandExport(entry, values);
      return 0;
    default:
      process.stderr.write(`hono-apcore: unknown command "${command}".\n\n${USAGE}`);
      return 2;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`hono-apcore: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
