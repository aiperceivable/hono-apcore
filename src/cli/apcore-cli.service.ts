import { CallbackApprovalHandler, Context as ApcoreContext, createApprovalResult, Executor } from 'apcore-js';
import type { ApprovalResult, Context } from 'apcore-js';
import { annotationsToDict } from 'apcore-toolkit';
import type { CreateCliOptions } from 'apcore-cli';
import { ApcoreExecutor } from '../core/executor.js';
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
  private readonly callOptions = new WeakMap<object, {
    autoApprove: boolean;
    timeout?: number;
    moduleId: string;
  }>();

  constructor(
    private readonly registry: ApcoreRegistry,
    private readonly options: ApcoreCliOptions = {},
    private readonly executor?: ApcoreExecutor,
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

    const executor = this.executor ?? new ApcoreExecutor(new Executor({ registry: this.registry.raw }));
    const raw = executor.raw;
    let approvalOptions = { autoApprove: false, timeout: undefined as number | undefined };
    // Child Contexts share data, so approval options follow nested SDK calls
    // without adding integration keys to the public context or global state.
    const callOptions = this.callOptions;
    const cliContext = (context?: Context | null): Context =>
      context ?? (cli.buildCliContext() as Context | null) ?? ApcoreContext.create();
    const runWithContext = async <T>(id: string, context: Context | null | undefined, run: (ctx: Context) => Promise<T>): Promise<T> => {
      const ctx = cliContext(context);
      callOptions.set(ctx.data, { ...approvalOptions, moduleId: id });
      try {
        return await run(ctx);
      } finally {
        callOptions.delete(ctx.data);
      }
    };
    const fallback = new CallbackApprovalHandler(async (request) => {
      const options = callOptions.get(request.context.data);
      // CLI's own annotation precheck has already completed for the root
      // command. Nested calls and ACL/policy-only requirements still ask here.
      if (
        options?.moduleId === request.moduleId &&
        this.registry.getDefinition(request.moduleId)?.annotations?.requiresApproval
      ) {
        return createApprovalResult({ status: 'approved', approvedBy: 'cli_precheck' });
      }
      const terminal = new cli.CliApprovalHandler(options?.autoApprove, options?.timeout);
      const result = await terminal.requestApproval({
        module_id: request.moduleId,
        requires_approval: true,
        annotations: annotationsToDict(request.annotations),
      });
      return createApprovalResult({
        status: result.status as ApprovalResult['status'],
        approvedBy: result.approved_by as string | undefined,
        reason: result.reason as string | undefined,
      });
    });
    // CLI 0.12 reads wire-format annotation keys. Keep that projection at
    // the surface boundary; the shared Registry retains SDK annotations.
    const registry: NonNullable<CreateCliOptions['registry']> = {
      list: () => this.registry.list(),
      getDefinition: (id) => {
        const definition = this.registry.getDefinition(id);
        return definition ? {
          ...definition,
          annotations: annotationsToDict(definition.annotations) ?? undefined,
        } : null;
      },
    };
    // Adapt the CLI's two-argument stream and third-position trace options.
    // Only supply its approval fallback when the host has no handler.
    const cliExecutor = {
      registry,
      call: (id: string, input: Record<string, unknown>, context?: Context | null) =>
        runWithContext(id, context, (ctx) => raw.call(id, input, ctx)),
      validate: raw.validate.bind(raw),
      stream: async function* (id: string, input: Record<string, unknown>) {
        const ctx = cliContext();
        callOptions.set(ctx.data, { ...approvalOptions, moduleId: id });
        try {
          yield* raw.stream(id, input, ctx);
        } finally {
          callOptions.delete(ctx.data);
        }
      },
      callWithTrace: (id: string, input: Record<string, unknown>, options?: { strategy?: string }) =>
        runWithContext(id, undefined, (ctx) => executor.callWithTrace(id, input, ctx, options)),
      describePipeline: raw.describePipeline.bind(raw),
      listStrategies: raw.listStrategies.bind(raw),
      currentStrategy: raw.currentStrategy,
      governanceState: raw.governanceState.bind(raw),
      setAcl: raw.setAcl.bind(raw),
      setApprovalHandler: () => {
        if (!raw.governanceState().approvalHandlerConfigured) raw.setApprovalHandler(fallback);
      },
    };
    const bridge = cliExecutor as unknown as NonNullable<CreateCliOptions['executor']>;
    const program = cli.createCli({
      extensionsDir: extensionsDir ?? this.options.extensionsDir,
      progName: this.options.progName,
      allOptions: this.options.verboseHelp ?? false,
      registry,
      executor: bridge,
    });
    program.hook('preAction', (_parent, command) => {
      const options = command.opts();
      approvalOptions = { autoApprove: options.yes === true, timeout: options.approvalTimeout };
    });
    const modules = new cli.GroupedModuleGroup(registry, bridge);
    for (const name of modules.listCommands()) {
      const command = modules.getCommand(name);
      if (command) program.addCommand(command);
    }
    return program;
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
