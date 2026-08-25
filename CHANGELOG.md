# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

(nothing yet)

---

## [0.1.0] - 2026-08-25

Initial release. Hono integration for the apcore ecosystem, built against
Hono 4.13, apcore-js 0.27, apcore-toolkit 0.10, and apcore-mcp 0.18.

### Added

- **`HonoApcore` / `createApcore()`** — the single entry point. Owns the apcore
  `Registry` and `Executor`, the registration surface, and the optional MCP,
  CLI, and A2A services. `init()` is idempotent and does the whole startup
  sequence: discover extensions, register tools, load YAML bindings, scan
  routes, then start whichever surfaces were configured to run standalone.

- **`defineTool()` / `defineToolset()`** — the Hono counterpart to the NestJS
  adapter's `@ApTool` / `@ApModule` decorators. Hono has no classes or DI
  container to decorate, so a tool is a plain object carrying its own metadata
  and handler, and a toolset groups several under one namespace with shared
  tags and annotations.

  Per-parameter prose is declared with an explicit `params` field rather than
  inferred from JSDoc: JavaScript gives no run-time access to a function's
  leading comments the way Python reads a docstring, so a JSDoc-scanning
  implementation would silently never fire.

- **`HonoRouteScanner`** — scans a Hono app's route table and registers each
  route as a module that replays it in-process through `app.request()`, so an
  AI call runs the same code path as an HTTP call, middleware and error
  handlers included. Module IDs come from the path and verb (`GET /todos/:id`
  → `todos.get`), and behavioural annotations from the HTTP method per RFC 9110
  safe-method semantics. Supports include/exclude by path or module-ID regex,
  a module prefix, and per-route overrides including `skip`.

- **`apcore()` middleware** — puts the instance and a per-request apcore
  `Context` on the Hono context, with `getApcore()` / `getApcoreContext()`
  accessors and a `ContextVariableMap` augmentation so `c.get('apcore')` is
  typed. Accepts either an existing instance or plain options.

- **`HonoContextFactory`** — builds the apcore `Context` from a Hono context, a
  `Request`, or bare `Headers`. Identity resolves from `x-user-id`, then a
  Bearer token, then a bare `x-roles` header, then anonymous; `traceparent`
  supplies the trace id (W3C validation stays in the SDK) and
  `x-correlation-id` / `x-request-id` lands in `context.data`. A
  `resolveIdentity` override plugs in real authentication.

- **MCP surface** — `ApcoreMcpService` plus `mountMcp()`, which serves the MCP
  endpoint, the Tool Explorer, and `/health`, `/metrics`, `/usage` from the
  same Hono app and port. The mount bridges Hono's `Response` model to
  `apcore-mcp`'s Node `(req, res)` handler through the `HttpBindings` that
  `@hono/node-server` exposes on `c.env`, returning the already-sent sentinel;
  on a runtime without those bindings it answers `501` naming the reason.
  `ApcoreMcpService.start()` still runs a standalone server on its own port or
  over stdio.

- **CLI surface** — `ApcoreCliService`, and a `hono-apcore` binary with `scan`,
  `serve`, and `export`. The entry spec is `path[:export]`; an entry exporting a
  `HonoApcore` has its configuration honoured, and one that does not still gets
  an MCP surface, so `hono-apcore serve ./src/app.ts` works against an app that
  has never heard of apcore.

- **A2A surface** — `ApcoreA2aService`, standalone or embedded.

- **Schema adapters** — TypeBox (priority 100), Zod (50), and plain JSON Schema
  (30), tried highest-first through `SchemaExtractor`. The Zod adapter handles
  **both Zod 3 and Zod 4** and is entirely structural — Zod is never imported —
  so it works with whichever major version the host app installs, or none.

- **YAML bindings** — `ApBindingLoader` registers modules declared in YAML, with
  `resolverFromObjects()` for the common "map of service objects" case;
  `writeBindingsFile()` serialises scanned modules back out, which is what
  `hono-apcore scan --format yaml` produces.

- **`APCORE_*` configuration** — the canonical settings shared by every apcore
  framework integration, read from the environment via `loadSettings()` and
  overridable through `createApcore({ settings })`.

- **Examples** — `examples/demo` (hand-written tools *and* route scanning, JWT,
  ACL, system modules, Docker) and `examples/acl_demo` (routes governed by
  apcore ACL).

### Notes

- **`apcore-mcp`, `apcore-cli`, and `apcore-a2a` are optional peers and are not
  re-exported.** They are reached through lazy dynamic imports inside the
  services. The NestJS adapter re-exports their whole surface, but doing that
  here would load `apcore-mcp` — and with it `node:http` — on every
  `import 'hono-apcore'`, breaking a Workers, Deno, or Bun build of an app that
  never uses the MCP surface. Import those symbols from their own packages.
  `apcore-js` and `apcore-toolkit` are hard dependencies and *are* re-exported.

- **Numeric-enum handling differs from the NestJS adapter's Zod adapter.** A
  TypeScript numeric enum compiles to a reverse-mapped object
  (`enum Color { Red = 0 }` → `{ 0: 'Red', Red: 0 }`); the NestJS port keeps the
  *names*, which are not values a caller may send. This adapter keeps the
  forward entries (`[0]`) and only emits `type` when every surviving value
  shares one JSON type.
