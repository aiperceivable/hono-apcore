# SDK upgrade assessment

This upgrade was checked against the published npm packages, their declarations
and implementation, and the ecosystem repositories' changelogs. Package versions
in both lockfiles match the targets below. The hono-apcore release version remains
unchanged; these changes are recorded under Unreleased.

| Package | Previously locked | Upgraded |
| --- | --- | --- |
| apcore-js | 0.32.2 | 0.32.3 |
| apcore-toolkit | 0.14.0 | 0.14.1 |
| apcore-mcp | 0.23.1 | 0.23.3 |
| apcore-cli | 0.12.5 | 0.12.7 |
| apcore-a2a | 0.8.3 | 0.8.5 |

All five SDKs require Node.js 20+. The adapter's engine requirement now matches;
CI already uses Node.js 20. Optional surface packages remain lazily imported.

## Patch upgrade assessment (2026-10-26)

The five published packages retain the interfaces used by the adapter. CLI
`createCli`/`GroupedModuleGroup`, MCP `serve`/`asyncServe`, A2A
`serve`/`asyncServe`, and toolkit binding/scanner APIs require no signature or
option changes. The existing CLI executor bridge and lazy surface loading stay
in place. Real CLI integration tests, embedded MCP requests, and A2A HTTP skill
discovery and execution exercise these boundaries with the upgraded packages.

One adapter change is necessary to carry SDK cancellation through Hono route
replay. The scanner now passes `Context.signal` into `app.request()` and rejects
an already-aborted context before invoking a route. Since `app.request()` runs
in process, it does not provide native fetch's automatic response-body abort:
the adapter explicitly cancels the owned response reader, releases its lock,
and awaits asynchronous stream cancellation cleanup. This applies to JSON, text
and error responses, and includes cancellation before response headers arrive.

Core 0.32.3's `CancelToken.drain()` tracks module bodies after prompt cancellation.
The adapter keeps route and response-producer cleanup within that body, allowing
the lifecycle owner to await it. Handlers must cooperate with
`c.req.raw.signal`; arbitrary route code that ignores cancellation can still keep
drain pending. Do not call a token's drain from inside its own module execution.

Toolkit 0.14.1's HTTP proxy cancellation, full-response deadlines, authentication
and OpenAPI timeout fixes are inherited where those SDK APIs are used. They do
not automatically fix Hono's separate in-process replay path, which is why the
scanner adaptation above is required. No duplicate toolkit implementation is added.

The following sections also retain the broader integration decisions introduced
in hono-apcore 0.2.0.

## Required adapter changes

### Runtime annotations and bindings

`FunctionModule` expects SDK camelCase annotations. The old conversion passed
toolkit's snake_case serialization into it, losing `requiresApproval`,
`openWorld`, cache TTL and cache-key settings. Runtime registration now passes
the SDK annotations directly. YAML and CLI projections use snake_case at their
own boundaries. Tool annotations follow `Partial<ModuleAnnotations>`, enabling
`discoverable` and `extra` without another hand-maintained field list.

`ApBindingLoader` now uses toolkit's `parseBindingDocument`, retaining the Hono
closure resolver. It inherits toolkit 0.14's unknown-key and paired-schema
checks and snake_case annotation decoding. Export/import retains module version,
metadata, examples and sparse display overlays. A quiet in-memory projection
builds surface metadata with toolkit 0.14's precedence and validation rules.
The SDK's public `DisplayResolver` writes to stdout, so parity tests compare
against it while registration keeps JSON and protocol output free of diagnostics.

Migration rules:

- Use Node.js 20 or newer.
- Put custom binding entry fields under `metadata`.
- Provide both `input_schema` and `output_schema`, or omit both in loose mode.
- Use `bindings: []` for an intentionally empty binding list. Blank documents
  and `{}` remain accepted for compatibility; unknown non-empty documents fail.
- YAML annotations use `requires_approval`, `open_world`, `cache_ttl`, etc.;
  TypeScript tool definitions use `requiresApproval`, `openWorld`, `cacheTtl`.
- Runtime-only binding modes such as `auto_schema` and `schema_ref` belong to
  the core SDK runtime loader; the Hono closure loader uses toolkit's pure-data
  format and rejects them.

### CLI

The old service used only positional `createCli` arguments and did not inject
the Hono registry or executor. The updated service supplies both, explicitly
mounts the SDK's `GroupedModuleGroup` commands, and projects descriptor
annotations into the wire spelling CLI 0.12 reads.

CLI 0.12 also calls `callWithTrace(id, inputs, options)`, whereas core 0.32 uses
`callWithTrace(id, inputs, context, options)`. A narrow executor bridge translates
this signature, builds the CLI identity context, and resolves named strategies
through the SDK. Calls execute on the host executor, including its middleware,
ACL and approval policy. The bridge installs a terminal fallback only when the
host has no approval handler, preserving any application-supplied handler.
The fallback handles effective ACL/policy approval requirements as well as
module annotations. CLI `--yes` and timeout options are scoped to each call and
cleared afterward; a completed annotation prompt is not repeated. Stream calls
carry the same CLI identity context as ordinary and traced calls.

### Core configuration and execution

`createApcore` accepts a shared SDK `config` and `executorOptions` for strategy,
approval handler, policy, toggle state and event emitter. Explicit extension roots
from the Config are discovered during `init`. Existing `acl`, `middleware` and
`extensionsDir` options retain their precedence.

`ap.executor.callWithTrace()` supports SDK strategy objects and strategy names;
`addStepMiddleware()` exposes the SDK's step lifecycle hooks. Named strategy
factories start with neutral governance providers, then the running executor
binds its current providers, including runtime policy changes and clearing.
The raw registry and executor remain available for advanced SDK APIs.

```ts
import { Config, createApcore, defineTool } from 'hono-apcore';
import { AlwaysDenyHandler, ExecutionPolicy } from 'apcore-js';

const ap = createApcore({
  config: new Config({ project: { name: 'jobs' } }),
  executorOptions: {
    approvalHandler: new AlwaysDenyHandler(), // replace with your approval provider
    policy: new ExecutionPolicy([], { strict: true }),
  },
  tools: [defineTool({
    id: 'jobs.run',
    description: 'Run a background job',
    metadata: { async: true },
    annotations: { readonly: true, extra: { mcp_async: 'true' } },
    handler: async () => ({ done: true }),
  })],
  mcp: { async: { enabled: true, maxConcurrent: 4, maxTasks: 100 } },
});
await ap.init();
const [output, trace] = await ap.executor.callWithTrace('jobs.run');
await ap.close();
```

### MCP and A2A options

MCP async-task controls are forwarded in embedded and standalone modes.
Embedded `dynamic` honors the constructor configuration. Per-start `mcpAcl`
and `mcpMiddleware` overrides are renamed consistently with constructor options.
Async jobs can declare `metadata.async: true` or the SDK's `extra.mcp_async`
annotation. Async task storage and lifecycle remain owned by the MCP bridge.

A2A now forwards `pushNotifications`, `sysModules` and `discloseRefusalReason`.
Refusal detail disclosure remains opt-in. Existing A2A execution timeout options
continue to reach the upstream implementation.

## Improvements inherited from the SDKs

These behaviors stay delegated to the upstream implementation:

- Core governance providers bound to execution gates, scoped timeout
  cancellation, collect-all preflight checks, canonical JSON Pointer
  diagnostics, reference-aware redaction and sensitive logging captures.
- Core strict schema conversion fixes, including optional enum constraints.
- MCP runtime-faithful discovery schemas, preserving optionality and explicit
  nulls independently of OpenAI strict exports.
- MCP output schemas and structured content for modern protocol requests,
  generated from redacted JSON text. Streamable HTTP requests must carry their
  negotiated `mcp-protocol-version` header.
- A2A timeout propagation and canonical validation diagnostics.

Toolkit's OpenAPI ID normalization affects its OpenAPI scanner and upstream
OpenAPI backends. Hono's route scanner derives its own established route IDs,
so existing Hono route IDs are retained. Device authorization and remote
OpenAPI import remain directly accessible through their SDK packages; they
do not need a duplicate Hono implementation.

## Verification coverage

Regression tests exercise native SDK behavior through the Hono integration:

- Approval denial without handler execution; runtime/YAML/CLI annotation parity.
- Configured pipelines and extension-root discovery; visibility and async metadata.
- Binding metadata, versions, examples and display round trips; invalid structures.
- Pipeline tracing and step hooks; real CLI calls, middleware, named strategies,
  terminal approval checks and preservation of the host approval handler.
- Real embedded MCP discovery/calls, nullable/free-form input, optional enum
  strict exports, structured content and local-reference redaction.
- New MCP and A2A options at the service boundaries.
- ACL-derived CLI approval across ordinary, traced and streamed calls;
  invocation-scoped `--yes`, single terminal prompts and repeated program builds.
- Live policy clearing/replacement during named traces; display projection parity
  with the SDK and real child-process JSON/stdin-stdout protocol checks.

## MCP stdio isolation

The former 0.23.1 startup-logger limitation is fixed upstream in 0.23.3. Hono
continues to use the SDK's high-level `serve()` directly, inheriting its stdio
output lease and execution cleanup draining. A real child-process regression
launches `hono-apcore serve --transport stdio`, initializes an MCP client, lists
and calls a tool, and closes the session. Startup/shutdown hooks, module console
logs and direct `process.stdout.write()` diagnostics arrive on stderr without
protocol parse errors. A separate low-level transport test still covers quiet
display registration. Output produced by application imports before `serve()`
acquires stdio is outside that SDK session's isolation boundary.

Source references:
[core changelog](https://github.com/aiperceivable/apcore-typescript/blob/main/CHANGELOG.md),
[toolkit changelog](https://github.com/aiperceivable/apcore-toolkit-typescript/blob/main/CHANGELOG.md),
[MCP changelog](https://github.com/aiperceivable/apcore-mcp-typescript/blob/main/CHANGELOG.md),
[CLI changelog](https://github.com/aiperceivable/apcore-cli-typescript/blob/main/CHANGELOG.md),
[A2A changelog](https://github.com/aiperceivable/apcore-a2a-typescript/blob/main/CHANGELOG.md).
