import type { ApcoreRegistry } from '../core/registry.js';
import type { ApcoreCliOptions } from '../types.js';

/**
 * Exposes `apcore-cli` for a Hono app: build a Commander program whose
 * commands are the app's registered apcore modules.
 *
 * `apcore-cli` is an **optional** peer dependency, loaded lazily — importing
 * `hono-apcore` never pulls in a CLI stack you are not using.
 *
 * @example
 * ```ts
 * const cli = new ApcoreCliService(apcore.registry, { progName: 'my-app' });
 * const program = await cli.createProgram();
 * await cli.configureManHelp(program, 'my-app', '1.0.0', 'My Hono app');
 * program.parse();
 * ```
 */
export class ApcoreCliService {
  private configured = false;

  constructor(
    private readonly registry: ApcoreRegistry,
    private readonly options: ApcoreCliOptions = {},
  ) {}

  /** Number of modules currently registered. */
  get moduleCount(): number {
    return this.registry.count;
  }

  /**
   * Build a Commander program exposing the registered modules.
   *
   * Built-in apcore options (`--input`, `--yes`, `--large-input`, `--format`)
   * are hidden by default; `--help --verbose` at runtime — or `verboseHelp`
   * in the options — reveals them.
   *
   * @param extensionsDir - Overrides the configured extensions directory.
   */
  async createProgram(extensionsDir?: string): Promise<unknown> {
    const cli = await import('apcore-cli');
    await this.applyModuleOptions();

    return (
      cli.createCli as (
        dir?: string,
        progName?: string,
        verboseHelp?: boolean,
      ) => unknown
    )(
      extensionsDir ?? this.options.extensionsDir,
      this.options.progName,
      this.options.verboseHelp ?? false,
    );
  }

  /**
   * Add `--help --man` support to an existing Commander program, so
   * `<prog> --help --man` writes a full man page to stdout.
   */
  async configureManHelp(
    program: unknown,
    progName: string,
    version: string,
    description?: string,
    docsUrl?: string,
  ): Promise<void> {
    const cli = await import('apcore-cli');
    (
      cli.configureManHelp as (
        program: unknown,
        progName: string,
        version: string,
        description?: string,
        docsUrl?: string,
      ) => void
    )(program, progName, version, description, docsUrl ?? this.options.docsUrl ?? undefined);
  }

  /** Update the docs URL used by man pages and per-command help output. */
  async setDocsUrl(url: string | null): Promise<void> {
    const cli = await import('apcore-cli');
    (cli.setDocsUrl as (url: string | null) => void)(url);
  }

  /** Toggle verbose help — when on, `--help` lists the built-in apcore options. */
  async setVerboseHelp(verbose: boolean): Promise<void> {
    const cli = await import('apcore-cli');
    (cli.setVerboseHelp as (verbose: boolean) => void)(verbose);
  }

  /**
   * Apply the module-level `docsUrl` / `verboseHelp` defaults once, the first
   * time a program is built.
   */
  private async applyModuleOptions(): Promise<void> {
    if (this.configured) return;
    this.configured = true;

    if (this.options.docsUrl !== undefined) {
      await this.setDocsUrl(this.options.docsUrl);
    }
    if (this.options.verboseHelp !== undefined) {
      await this.setVerboseHelp(this.options.verboseHelp);
    }
  }
}
