# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-08-26

### Fixed

- **The root `.` and `./bootstrap` entry points no longer materialize `amqplib`, `graphql`, or
  `redis` for a consumer that never uses the features that need them.** Three causes:
  - `@zanix/app`/`@zanix/app/runtime`'s pin floor moves from `^0.2.0` to `^0.2.1` —
    `@zanix/app@0.2.0` pinned a pre-split `@zanix/server` that bundled `graphql`/`amqplib`
    unconditionally into its webserver/discovery machinery; `0.2.1` doesn't.
  - `defineCoreMetadata` (`utils/metadata.ts`) resolved `@zanix/datamaster/core`/`@zanix/auth/core`/
    `@zanix/notifications/core`/`@zanix/asyncmq/core` via literal `import()` calls — Deno's static
    module graph follows a literal dynamic `import()` the same as a static one, so all four
    materialized merely by importing `.`/`./bootstrap`. Routed through non-literal specifiers
    (`modules/lazy/specifiers.ts`), matching this file's existing `ADMIN_SPECIFIER`/
    `DATAMASTER_STORAGE_SPECIFIER` pattern. `@zanix/asyncmq/core`'s own pin also moves from the
    stale `^0.7.0` to `^0.8.0`, matching `/jobs`/`/worker`.
  - `modules/jobs/triggers.ts`/`setup.ts`'s combined `@zanix/database` alias (pointed at the bare
    `@zanix/datamaster` root) splits into `@zanix/datamaster/database` and `@zanix/datamaster/dlq` —
    the two subpaths that actually define the symbols each file uses.
- **`Zanix.setup({ assets })`'s dependencies no longer materialize for every consumer.**
  `modules/setup.ts` used to unconditionally import `@zanix/space/assets-api` (→ `sharp`/`svgo`),
  `@zanix/datamaster/storage` (→ `@aws-sdk/client-s3`), and `@zanix/datamaster/files` (→ `mongoose`)
  — reachable the moment `mod.ts` builds the `Zanix` class, regardless of whether `assets` was ever
  configured. All three now resolve lazily via `@zanix/helpers`'s
  `lazyFunction`/`lazyClass`/`lazyValue` (see `modules/lazy-specifiers.ts`) and are gone from
  `deno.jsonc`'s `imports` map.
- **`notifications.templatesBackend`/`templatesModel` (`Zanix.setup()`) and `codeTemplatesDiscovery`
  (`Zanix.start()`/`bootstrap()`) no longer force-resolve `@zanix/notifications`'s bare root for a
  caller that never sets either** — same lazy-resolution fix as `assets`, above.
  `defineCoreMetadata()` still unconditionally loads `@zanix/notifications/core` as part of its own
  always-on zero-config wiring sweep (alongside the other three `/core` subpaths above); this fix
  narrows `setup`/`start`'s own options only.

### Changed (breaking)

- **`Zanix.setup()` is now `async`, returning `Promise<void>`** — `assets`'s lazy resolution (above)
  always goes through a real `await`. A caller that never passes `assets` sees identical
  synchronous-completion behavior; a caller that does must `await Zanix.setup(...)` before calling
  `Zanix.getAssetsService()`.
- **`Zanix.getAssetsService()` now returns `unknown` instead of `AssetService`** — the real type
  lives in `@zanix/space/assets-api`, whose own file unconditionally imports the real
  `AssetTransformer` (and so `sharp`/`svgo`); even `import type` would have re-materialized it for
  every consumer. Cast at the point you already import `@zanix/space/assets-api` for real:

  ```typescript
  import type { AssetService } from '@zanix/space/assets-api'

  defineSpaceApp({ assetsApi: { service: Zanix.getAssetsService() as AssetService } })
  ```
- **`mod.ts` no longer re-exports `AssetKind`/`AssetRecord`/`AssetService`/`AssetStatus`/
  `AssetTransformRequest`/`AssetVariant`/`AssetVariantBase`/`AudioAssetVariant`/
  `CreateAssetCommand`/`ImageAssetVariant`/`ThumbnailAssetVariant`/`UploadedAsset`/
  `VideoAssetVariant`/`VideoBreakpointName`/`VoiceAudioFormat`/`VoiceAudioTransformOptions`** —
  these existed only to type `Zanix.getAssetsService()`'s old return value (above). Import them
  directly from `@zanix/space/assets-api` instead.

## [2.0.0] - 2026-08-24

### Added

- **`Zanix.compose(rootDir?, options?)`** — registers this project's own decorator metadata
  (cross-package core provider/connector slots plus this project's own auto-discovered handlers,
  attributed to the default Application) without starting any server or activating any real
  infrastructure. For a process that only needs to introspect what `Zanix.start()`/
  `Zanix.bootstrap()` WOULD register (e.g. a static OpenAPI generator reading `@zanix/server`'s
  `ProgramModule.routes.getRoutes('rest')` afterward). `options.admin: true` additionally registers
  `@zanix/admin`'s built-in local admin app and its enabled sub-apps — verified safe (none of those
  manifests declare `dependencies`/`resources`/`onStart`/`onStop`/`jobs`, so no real resource
  activation ever happens for this fixed set). Still deliberately excludes `apps` composition — a
  project's own named `apps` are neither statically discoverable nor guaranteed side-effect-free to
  activate — see `compose()`'s own doc comment for the full rationale.
- **`ConfigOptions.assets` / `Zanix.getAssetsService()` / `AssetService`** — unlike every other
  `Zanix.setup()` option (env vars only), `assets` also constructs real infrastructure and
  self-registers it, the same "construct real infrastructure, self-register it globally" shape
  `logger.elastic` already has. `Zanix.setup({ assets })` builds `@zanix/datamaster/storage`'s
  `S3ObjectStorage` (+ an optional local fallback/migration when `assets.localDir` is given) and
  `@zanix/datamaster/files`'s `MongoFileRepository` (adapted via `@zanix/space/assets-api`'s
  `createAssetRepositoryOverFiles`), wires them into a real `AssetService`, and registers it — read
  it back with `Zanix.getAssetsService()`. The `s3Endpoint`/`s3AccessKey`/`s3SecretKey`/
  `s3Bucket`/`encrypt`/`encryptVersion`/`filesModelName` fields each set their own
  `S3_*`/`FILE_MODEL_NAME` env var, same "already-set env var wins" precedence as every other
  `Zanix.setup()` option. See
  [README: Assets](README.md#assets-zanixsetup-assets--builds-a-real-assetservice).
- **`ConfigOptions.errors.uncaughtMonitor`** — wires `@zanix/server`'s new `UncaughtErrorMonitor`
  (process-wide uncaught-exception/unhandled-rejection tracking), alongside the existing
  `errors.logThrottle` (see Changed, below, for that field's own rename). No env-var fallback,
  explicit options only, same as `logThrottle`.
- **`/admin/dlq`** — the `@zanix/admin@^2.0.0` bump (this same release, see Changed below) brings a
  fourth built-in admin API online, alongside `/admin/triggers`/`/admin/templates`/
  `/admin/service-token`: manage `@zanix/datamaster`'s persisted Dead Letter Queue entries at
  runtime (`push`/`get`/`list`/`requeue`/`discard`/`remove`). Opt-in, the same shape as
  `/admin/templates` — only registered once `DLQ_MODEL_NAME` is set (see
  `Zanix.setup({ dlq:
  { modelName } })`, already present in this package before this release).
  `Zanix.start({ admin:
  true })`/`Zanix.compose(rootDir, { admin: true })` already activate it
  automatically — both call `@zanix/admin`'s own `getLocalAdminSubApps()` generically, with no
  per-resource list of its own — so no code change was needed in this package's own
  `start()`/`compose()` to enable it. This release adds: `ADMIN_DLQ_ROLE`/`DlqAdminClient`
  (re-exported from `@zanix/admin`) and
  `createDlqAdminController`/`DiscardDLQEntryRTO`/`DLQEntryIdParamsRTO`/`ListDLQEntriesRTO`/
  `PushDLQEntryRTO`/`RequeueDLQEntryRTO` (re-exported from `@zanix/datamaster/dlq-api`, the real
  data owner — same "re-exported from the real owner unchanged" shape triggers/templates already
  have) to this package's own `mod.ts`, a regression test proving the route is registered/auth-gated
  via `Zanix.bootstrap()`, and full documentation. See
  [docs/admin-apis.md](docs/admin-apis.md#-admin-apis).

### Changed

- **BREAKING: `ConfigOptions.errorLogThrottle` is renamed to `ConfigOptions.errors.logThrottle`**,
  now grouped alongside the new `errors.uncaughtMonitor` (see Added, above) under one `errors` block
  — both are "how many times before something happens" counters over an error stream, configured the
  same way. `errorLogThrottle: {...}` becomes `errors: { logThrottle: {...} }`; the option's own
  shape is otherwise unchanged. No dual-read compat shim.
- **BREAKING: `setup()`'s logger auto-detect and `ConfigOptions.notifications` follow
  `@zanix/datamaster`/`@zanix/notifications`'s own selector-based env-var renames.**
  - `logger.elastic`'s zero-config auto-detect now reads `SEARCH_ENGINE` (`'elasticsearch'` or
    `'opensearch'` enables it; `'meilisearch'` never does) instead of checking
    `ELASTICSEARCH_URL`/`OPENSEARCH_URL` for presence.
  - `ConfigOptions.notifications.databaseTemplates: boolean` is replaced by
    `notifications.templatesBackend: 'local' | 'remote'`, setting the renamed `TEMPLATES_BACKEND`
    instead of the now-removed `DATABASE_TEMPLATES`. `notifications.templatesModel` is unchanged,
    but only takes effect alongside `templatesBackend: 'local'`.

  No dual-read/compat shim, matching both upstream packages' own hard-rename stance. Requires
  `@zanix/datamaster` and `@zanix/notifications` versions carrying their own renames.
- `createTriggersAdminController`, `CreateTriggerRTO`, `UpdateTriggerRTO`, `TriggerModelParamsRTO`
  now source from `@zanix/datamaster/triggers-api`; `CreateTemplateRTO`, `UpdateTemplateRTO`,
  `TemplateParamsRTO` now source from `@zanix/notifications/templates-api` — the packages that
  actually author them. No change to the public symbols this package exports.

### Fixed

- `deno lint`'s own `@zanix/utils` plugin (`deno-zanix-plugin`) is now version-pinned (`^3.0.0`),
  matching every other `@zanix/utils` import in `deno.jsonc` — it used to resolve unpinned, so a
  lint run could silently pick up a newer, unreviewed plugin version.

## [1.1.0] - 2026-08-17

### Added

- **`SetupOptions.resources`** — root-level resources a named Zanix App's own `dependencies` can
  bind against, via that entry's own `uses` (see `ZanixAppBootstrapOptions`).
- **`ZanixAppBootstrapOptions.behaviors`** — overrides for a named `apps.<name>` entry's own
  `behaviors` (see `@zanix/app`'s new `AppDefinition.behaviors`/`ctx.behavior(name)`): a pure
  function/strategy slot, distinct from `resources`/`uses` (no construction, no `close()`, no
  health-gating — just a function). Each key must be a `behaviors` name that app's own manifest
  declared; `Zanix.start()` throws, before anything else is constructed, if a key names a behavior
  the app never declared or if `apps` never declares that app at all — same fail-fast posture `uses`
  already has for an unknown `dependencies` slot.
  ```ts
  await Zanix.start({
    apps: {
      billing: {
        definition: billingApp,
        behaviors: { calculateDiscount: (order) => order.total * 0.1 },
      },
    },
  })
  ```
  Requires a `@zanix/app` version with `behaviors`/`ctx.behavior()` support (not yet released as of
  this entry — see that package's own CHANGELOG).
- **`Zanix.start({admin: true})` now also activates `@zanix/admin`'s local Triggers/Templates
  `operations`/`mcp` sub-apps** (`getLocalAdminSubApps()` — `admin-triggers`/`admin-templates`,
  physically separated from `defineLocalAdminApp` into their own Zanix Apps this release — see
  `@zanix/admin`'s own CHANGELOG), each bootstrapped with its own `bootstrapAppServer()` call so
  their own `/__zanix-ops/<name>/...` operations-dispatch route is reachable over real HTTP, not
  just same-process `ctx.remote()`. Always activated regardless of `TRIGGERS_MODEL_NAME`/
  `DATABASE_TEMPLATES` (the REST-controller gating in `defineAdminMetadata`), same as before this
  rename. `ctx.remote('admin-triggers')`/`ctx.remote('admin-templates')` reach them now, not
  `ctx.remote('admin')` — safe, since this surface was only ever exercised by tests, never a real
  external caller.
- **`admin.health`** — mirrors `@zanix/server`'s new `server.health` for the embedded admin server:
  `boolean | HealthOptions`, own explicit value if given, otherwise inherits whatever
  `server.health` resolves to (same "explicit option beats inherited default" precedence `port`/
  `id`/`previousId` already follow for admin). Fixes a real bug found running a real consumer app:
  the embedded admin server previously always got `health: undefined` (enabled with defaults) —
  `server.health` (even `false`) had zero effect on it, since `start.ts`'s own `adminServers` object
  never copied that field over at all.
- `Zanix.start()`/`bootstrap()` now traps `SIGINT`/`SIGTERM` automatically (no opt-out) — either
  signal runs `Zanix.stop()` before exiting, draining in-flight HTTP requests via `Deno.serve()`'s
  own `.shutdown()` instead of the process dying mid-request the moment an orchestrator (Docker,
  Kubernetes, ...) sends its default stop signal. Mirrors `startWorker()`'s own existing
  `SIGINT`/`SIGTERM` precedent. `Zanix.stop()` itself now also closes connector connections
  (`closeAllConnections()`) after the HTTP servers finish draining — previously only `stopWorker()`
  did this, leaving `Zanix.stop()`-triggered shutdowns with open DB/cache connections.
- `ConfigOptions.dlq` on `Zanix.setup()`: `modelName`/`encryptPayload`/`defaultLeaseMs`, setting
  `DLQ_MODEL_NAME`/`DLQ_ENCRYPT_PAYLOAD`/`DLQ_DEFAULT_LEASE_MS` for `@zanix/datamaster`'s
  `DLQProvider` — same env-var-bridge shape and "already-set env var always wins" precedence as the
  existing `database`/`notifications` options. See
  [README: General configuration](README.md#general-configuration-zanixsetup).

### Removed

- **BREAKING**: `AppBootstrapOptions` (`SetupOptions.apps`'s legacy `{ rootDir, server }` shape) is
  removed entirely — every `apps.<name>` entry is now a `defineZanixApp()` manifest
  (`ZanixAppBootstrapOptions`, `{ definition, server?, uses? }`). `AppsOptions` narrows from
  `Record<string, AppBootstrapOptions | ZanixAppBootstrapOptions>` to
  `Record<string,
  ZanixAppBootstrapOptions>`. No consumer of this legacy shape was found within
  this workspace; removed with the risk accepted that an external consumer may still exist.
  `AppBootstrapOptions` is no longer exported from `@zanix/core`. Named apps are resolved as one
  batch via `@zanix/app/runtime`'s `activateApps` (so apps sharing a root resource — see the new
  `SetupOptions.resources` — resolve to the same instance) instead of each getting its own
  `defineLocalMetadata`/`bootstrapServers` call in isolation.

### Fixed

- **`start()`, `startWorker()`, and `modules/tasker.ts`** now all run `defineCoreMetadata()` to
  completion before `defineLocalMetadata()` starts, instead of racing/reversing the two. Previously:
  `startWorker()`/`tasker.ts` awaited `defineLocalMetadata()` before `defineCoreMetadata()` —
  reversed order, deterministically wrong; `start()` ran both concurrently via `Promise.all`, which
  only worked in practice because `defineCoreMetadata()`'s plain package imports usually resolve
  before `defineLocalMetadata()`'s filesystem scan, never a guaranteed ordering. Either way, a local
  file rewriting a reserved core connector/provider slot (e.g. a consumer's own Elasticsearch
  connector decorated `@Connector({ slot: 'search' })`) could be evaluated before the owning
  package's `/core` entrypoint had registered that slot in that process's own module graph — most
  visibly in a Worker/tasker process, throwing
  `Cannot decorate '<Class>' with slot "<slot>": this is a reserved core connector slot, but it
  hasn't been registered yet in this module context`.
  The new order also matches what `startWorker()`'s own doc comment already described.
  Regression-covered by two real subprocess runs (own module graph, like a real Worker) in
  `@tests/integration/reserved-slot-order.test.ts`.
- **`start()`'s new local admin sub-app bootstrap (see Added, above) no longer reuses the embedded
  admin server's own `id`/`globalPrefix`/`onCreate`.** Found while wiring it: `@zanix/server`'s
  `WebServerManager` keys its per-port dispatch table by `dispatchKey` (the anchored `serverID` when
  anchored, the raw `globalPrefix` otherwise) — never derived from the Application name. Two
  Applications sharing the exact same `id`/`globalPrefix` don't merge their routes under that key;
  the LATER `create()` call's handler (bound to ONE Application) silently replaces the earlier
  one's. Reusing `adminServers` verbatim for the new sub-apps made `ADMIN_APPLICATION`'s own
  `/admin/triggers`/`/admin/templates`/`/admin/service-token` controllers 404 whenever a sub-app
  registered after them on the same port — caught via real HTTP fetches in
  `admin-hub-coexistence*.test.ts`/`start-admin-and-server-combined.test.ts`/
  `start-code-templates-discovery-with-admin.test.ts`, not by any unit-level test. Each sub-app now
  resolves its own independent `id` and falls back to its own name as `globalPrefix` when
  unanchored.
- **`admin.ssr` no longer type-checks as a no-op.** `AdminBootstrapServerOptions` is built
  generically from `@zanix/server`'s `WebServerTypes` (`rest`/`graphql`/`socket`/`ssr`), so
  `admin: { ssr: {...} }` always compiled — but `start.ts`'s own `ADMIN_TYPES` was a hand-copied
  `['rest', 'graphql', 'socket']`, one type short, so an `ssr` entry was silently dropped at runtime
  with no error. `ADMIN_TYPES` now lists all four, with a compile-time check
  (`assertAdminTypesExhaustive`) that fails to build instead of silently drifting again the next
  time `@zanix/server` adds a type. `@zanix/admin` doesn't compose any `ssr` routes of its own
  today, so this is a no-op unless your own app also composes an `ssr` handler under the shared
  `'admin'` Application.
- **`Zanix.stop()` called twice in a row no longer re-runs a Zanix App's `onStop` hooks and
  re-`close()`s its resources a second time.** `start.ts`'s own `activatedApps` (set once `apps`/
  `admin` activates at least one Zanix App) was read by `stop()` but never cleared afterward —
  unlike `signalShutdown`, which already followed this pattern. Neither `deactivateApps` nor
  `ResourceRegistry.close()` (both in `@zanix/app`) guards against being called twice on their own,
  so a direct `stop()` call followed by a signal-triggered one (or two signals in quick succession)
  silently fired every app's own `onStop` twice and attempted to close already-closed resources
  again. `activatedApps` is now cleared before `deactivateApps` runs, matching the idempotency
  `stop()`'s own doc already promised. Regression-covered in `start-shutdown-signal.test.ts` (an
  `onStop` spy asserted to fire exactly once across two `stop()` calls).

## [1.0.0] - 2026-08-03

### Added

- **`SetupOptions.codeTemplatesDiscovery`** — exposes this process's own in-code notification
  templates (`@zanix/notifications`'s `CODE_TEMPLATES`) under `/.well-known/zanix/code-templates`,
  via `defineCodeTemplatesDiscovery()`. **Disabled by default** — deliberately independent of
  `TEMPLATES_SERVICE_URL` (Mode C): consuming templates from a remote source doesn't imply agreeing
  to expose your own catalog back (the target might not even be Zanix-based, and
  `RemoteTemplateBackend`'s own sync trigger is already best-effort, never a hard requirement — see
  `@zanix/notifications`'s `docs/templates.md`). `true` guards it with `@zanix/admin`'s new
  `createTemplatesDiscoveryGuard()` (`ADMIN_ROLE`/`ADMIN_TEMPLATES_ROLE`) — the same guard that
  already protects `/.well-known/zanix/templates`, shared from one place instead of each side
  inlining its own `jwtValidationGuard(...)` construction — one role for every templates-shaped
  Discovery surface. Pass an object to override `guards` (`[]` to deliberately serve it
  unauthenticated) or `application`. Registered under the `'admin'` Application when `admin` is also
  enabled (matching where `ZANIX_ADMIN_SERVICES`'s `adminBaseUrl` conventionally points), the
  default Application otherwise — `admin` has no server backing it at all when disabled, so
  registering under it in that case would leave the route live in metadata but never actually
  served. New exported `CodeTemplatesDiscoveryOptions` type.
- **`SetupOptions.apps`** — named secondary apps bootstrapped alongside the main one, each on its
  own Application, sequentially, before the main app's own (finalizing) bootstrap. Each entry has
  its own `rootDir` (auto-discovery, scoped away from the main app's and every other named app's)
  and `server` (explicit-only `id`/`previousId`/`port`/etc., no env fallback). `'main'` and
  `'admin'` are reserved keys and throw if used here — the main app is configured via the top-level
  `server`/`rootDir`, the admin server via the top-level `admin` option. See `docs/admin-apis.md`
  and `AppBootstrapOptions`'s own JSDoc.
- **`SetupOptions.rootDir`** (top-level and per `apps` entry) now accepts `string[]` in addition to
  a single `string` — auto-discovery scans every listed directory. Required `@zanix/utils`'s
  `collectFiles` to gain the same multi-root support (a local-only dependency bump for now, not yet
  published).
- An explicit `admin.<type>.id`/`.previousId` now wins over the `ADMIN_SERVER_ID`/
  `ADMIN_SERVER_ID_PREVIOUS` env vars, matching the "explicit option beats env var" precedence every
  other Zanix option already follows — previously these were silently discarded in favor of the
  env-derived value regardless of what was passed. Needed to run more than one admin-enabled
  instance of a service distinguishably without relying on a single process-wide env var.
- A second `Zanix.start()`/`Zanix.bootstrap()` call overlapping a first one still in flight (e.g.
  called twice back to back without `await`ing the first) now throws immediately instead of racing
  against the same process-wide route/DI/discovery registries and silently corrupting state (e.g.
  dropping `admin` on the first call).
- A second `Zanix.start()`/`Zanix.bootstrap()` call issued **after** a previous one already finished
  successfully in the same process, without an intervening `Zanix.stop()`, now throws immediately
  instead of silently registering a second, independent set of servers — same guard added to
  `ZanixAdminHub.start()`. At most one running `Zanix`/`ZanixAdminHub` server per process, always —
  call `stop()` before starting again. Both guards are now implemented via `@zanix/server`'s new
  shared `createStartLifecycleGuard`, replacing this package's own hand-rolled module-level booleans
  — same behavior, one fewer place to keep in sync with `@zanix/admin`'s own copy.

- `SetupOptions` (the type for `Zanix.start()`/`Zanix.bootstrap()`'s own `options` argument,
  including the new `admin` field below) is now re-exported from `mod.ts`, matching the existing
  `ConfigOptions` re-export for `Zanix.setup()` — previously there was no way to name this type from
  outside the package.
- **`ADMIN_TRIGGERS_APPLICATION`/`ADMIN_TEMPLATES_APPLICATION`** env vars (default `'admin'`,
  matching today's behavior) rebind either built-in admin API onto a different Application's Runtime
  — e.g. set to `'main'` to mount `/admin/triggers`/`/admin/templates` on the default Application's
  own unanchored server instead, for a deployment that genuinely can't isolate the anchored admin
  server. **Supersedes the `0.3.0`-era `ADMIN_TRIGGERS_ISINTERNAL`/`ADMIN_TEMPLATES_ISINTERNAL` env
  vars** (renamed — the old names described a public/internal visibility toggle, but the real effect
  was always a Runtime-rebinding, not a visibility one; see `docs/admin-apis.md`'s "Rebinding a
  capability to a different Application" section). The route path itself stays fixed either way;
  each admin capability now registers itself inside its own
  `ProgramModule.defineApplication(name, ...)` call rather than inheriting one implicitly from an
  outer wrap.
- `admin.<type>.globalPrefix` is no longer silently dropped: it's now inserted as an extra path
  segment right after the admin sub-server's own id
  (`{ADMIN_SERVER_ID}-<type>/{globalPrefix}/
  admin/triggers` instead of
  `{ADMIN_SERVER_ID}-<type>/admin/triggers`). Omitting it keeps today's exact path.
- A read-only **`/.well-known/zanix/templates`** endpoint is now registered alongside
  `/admin/templates` (same Application, same `ADMIN_ROLE`/`ADMIN_TEMPLATES_ROLE` gate) — built on
  `@zanix/server`'s new Discovery mechanism (`@zanix/admin`'s `createTemplatesDiscoveryProvider()`),
  for a central sync job/aggregator to snapshot this service's current templates without going
  through the authenticated CRUD surface. See `docs/admin-apis.md` and `@zanix/server`'s
  `docs/handlers.md#discovery`.

### Changed (breaking)

- **`Zanix.start({ admin: true })` may now safely run in the same process as `ZanixAdminHub.start()`
  — supersedes `0.5.0`'s mutual-exclusion guard, which is removed.** `@zanix/server`'s new
  boot-session isolation (`BootSessionContainer`, preserving whichever Applications a DIFFERENT,
  still-in-flight `start()` sequence currently owns from `finalize` cleanup) plus `@zanix/admin`'s
  own split of `ZanixAdminHub`'s route set onto a distinct Application (`ADMIN_HUB_APPLICATION`,
  `'admin-hub'`, no longer `'admin'`) make the combination safe, even fired without a sequential
  `await` between the two calls. See `@zanix/admin`'s own CHANGELOG and
  `docs/admin-architecture.md#running-both-servers`. `releaseAdminRegistration('core')` calls (in
  `start()`'s failure path and in `stop()`) are removed along with the guard they paired with.
- `Zanix.start()`'s own admin bootstrap now resolves its stable id via `@zanix/server`'s new generic
  `resolveApplicationServerId('admin', type)`/`resolvePreviousApplicationServerId('admin', type)`,
  replacing the removed `resolveAdminServerId`/`resolvePreviousAdminServerId` — same
  `ADMIN_SERVER_ID`/ `ADMIN_SERVER_ID_PREVIOUS` env vars, no observable behavior change for this
  package's own callers.
- **The admin server is now disabled by default.** `Zanix.start()` used to always register
  `@zanix/admin`'s triggers/templates/service-token routes and bootstrap a second, anchored,
  `'admin'`-Application server for them; now it doesn't unless you pass a new `admin` option:
  ```typescript
  await Zanix.start({ admin: true }) // restores prior behavior
  await Zanix.start({ admin: { rest: { port: 4000 } } }) // enabled, explicit config
  ```
  See `docs/admin-apis.md`'s "The `admin` option" section for the full shape, including the
  zero-config `PORT`/`PORT_<TYPE>` shared-listener story for single-port platforms
  (Heroku/Render/Railway) and why the unconfigured per-type port now defaults to reusing whichever
  port `server`'s own config resolves to, instead of a fixed literal.
- `SetupOptions.admin`'s per-type config (`AdminBootstrapServerOptions`, newly exported) no longer
  accepts `application` or `anchored` — an admin sub-server is always bound to the `'admin'`
  Application and always `anchored: true`; passing either is now a compile-time type error instead
  of a silent override.
- Running `Zanix.start({ admin: true })` and `ZanixAdminHub.start()` in the same process now throws
  a clear `InternalError` instead of silently corrupting shared route/resolver metadata (see
  `@zanix/server`'s `guardSingleAdminRegistration`) — this was always unsafe, just silent before.
  The already-documented "this service's own API + a separate `ZanixAdminHub` hub" pattern is
  unaffected: it only needs `Zanix.start()`'s new default (`admin` left `false`).
- **This package no longer owns any admin-domain composition logic of its own.** The
  `/admin/triggers`/`/admin/templates`/`/admin/service-token` controller-building and
  `ADMIN_TRIGGERS_APPLICATION`/`ADMIN_TEMPLATES_APPLICATION` env-var handling moved to
  `@zanix/admin`'s own `defineAdminMetadata(owner)` — this package's own `defineAdminMetadata()` is
  now a thin wrapper delegating to it. No observable behavior change for a
  `Zanix.start({ admin: ...
  })` caller; internal only, for consistency with how every other
  `/core`-suffixed sibling package (`@zanix/datamaster`, `@zanix/auth`, `@zanix/notifications`,
  `@zanix/asyncmq`) already owns its own composition logic rather than having it defined here.

### Fixed

- Documented that the `'admin'` Application's route bucket is shared process-wide, not scoped to
  this admin registration alone — see `docs/admin-apis.md`'s "Scope" caveat.

Requires `@zanix/server@^3.0.0` or later (the Application/`anchored`/`Runtime` model this release's
own admin bootstrap and env-var rebinding depend on, the shared `resolveAdminServerId`/
`guardSingleAdminRegistration` helpers, and the removed `ADMIN_*_PORT` constants this package no
longer imports) and `@zanix/admin@^0.3.0` or later (owns `defineAdminMetadata` as of that version).

## [0.3.1] - 2026-07-30

### Fixed

- Sequenced `defineLocalMetadata()` to run before either `bootstrapServers()` call, alongside
  `defineAdminMetadata()`/`defineCoreMetadata()`, so every app-level `registerModel()`/
  `@Provider`/`@Controller`/`@Resolver` side effect is guaranteed to complete before a `postBoot`
  connector (e.g. the Mongo connector) can initialize — previously the connector could drain the
  model registry before the app's own models had registered, surfacing as
  `ERR_MONGO_MODEL_NOT_FOUND`.

  Requires `@zanix/server@^2.1.2` or later — this reorder depends on a companion fix there that
  gives `bootstrapServers()` a `{ finalize }` option so cleanup of sequence-scoped metadata (GraphQL
  resolvers, routes) only runs on the last call of a multi-call boot sequence, instead of after
  every individual call — otherwise the internal admin call's cleanup wipes the public server's
  not-yet-served GraphQL resolvers before it ever starts.

## [0.3.0] - 2025-07-28

### Added

- `ADMIN_TRIGGERS_ISINTERNAL`/`ADMIN_TEMPLATES_ISINTERNAL` env vars (default `true`, matching
  today's behavior) to opt either built-in admin API out of `isInternal` — for a deployment that,
  for whatever reason, wants `/admin/triggers`/`/admin/templates` on its public server instead. The
  route path itself stays fixed either way. Internally, both routes are built by `@zanix/admin`'s
  own `createTriggersAdminController(options)`/`createTemplatesController(options)` factories
  (`defineAdminMetadata()` resolves `isInternal` from the env vars above and passes it straight
  through, pinning `prefix: 'admin/templates'` for the latter) instead of plain classes, since
  `@Controller`'s `isInternal`/`prefix` are decorator-time (static) config.
- Built-in internal-only admin APIs, `/admin/triggers` and `/admin/templates`, for managing
  `@zanix/datamaster`'s persisted triggers and `@zanix/notifications`'s templates at runtime
  (`ADMIN_ROLE`/`ADMIN_TRIGGERS_ROLE`/`ADMIN_TEMPLATES_ROLE`).
- `Zanix.setup()` for cross-cutting configuration: error-log throttling, logger/Elasticsearch
  wiring, and `@zanix/datamaster`/`@zanix/notifications` config.
- `Zanix.startWorker()`/`Zanix.stopWorker()` — bootstraps the current process as a standalone
  AsyncMQ worker instead of a web server, for a process that only runs background jobs. Loads the
  same cross-package core dependencies as `Zanix.start()` (including `@zanix/datamaster`'s built-in
  `mail`/`request` trigger job handlers), then hands off to `@zanix/asyncmq`'s own worker bootstrap
  and keeps the process alive until stopped (`Zanix.stopWorker()`, which closes connector
  connections, or a `SIGINT`, which also terminates the process).
- `X-Znx-Admin-Protocol` response header on every admin API response, versioning the admin
  protocol's request/response shapes independently of this package's own semver
  (`ADMIN_PROTOCOL_HEADER`, `ADMIN_PROTOCOL_VERSION`). `ADMIN_PROTOCOL_HEADER` (the header name) is
  re-exported from `@zanix/server`, which actually defines it, so `@zanix/notifications` can use the
  same name without depending on `@zanix/core`; `ADMIN_PROTOCOL_VERSION` (the version number) is
  owned by `@zanix/admin` (see `Changed` below) and re-exported here unchanged.
- `ADMIN_SERVER_ID` env var to pin the admin API's URL path prefix to a stable, per-type suffixed id
  across restarts, instead of the random one `@zanix/server` generates by default — needed once an
  external caller (e.g. a future centralized `zanix-admin` service) requires a fixed address to
  reach this service's admin API at.
- `TriggersAdminClient`/`TemplatesAdminClient` — thin `RestClient`-based HTTP clients for calling
  another service's own `/admin/triggers`/`/admin/templates` API remotely, so a consumer (e.g.
  `@zanix/admin`'s `TriggersAggregator`) reuses this single client implementation instead of a
  hand-rolled one that can drift from what the controllers actually accept.
- `CreateTemplateRTO`/`UpdateTemplateRTO`/`TemplateParamsRTO`, `TemplatesAdminRepository`/`Service`,
  `TriggersAdminRepository`/`Service`, `TriggerModelParamsRTO`, and
  `CreateTriggerRTO`/`UpdateTriggerRTO` also exported from `mod.ts` — see `Changed` below for where
  they're actually defined and why.
- Built-in internal-only `/admin/service-token` API — machine-to-machine credential exchange per
  `@zanix/auth`'s `docs/service-credential.md`. Always registered, unauthenticated by design (the
  caller has no session yet — the whole point of calling it is to obtain one). A thin wrapper around
  `@zanix/auth`'s new `exchangeServiceCredential`: POST `{ assertion }` (a JWT signed with the
  calling service's own key via `createServiceAssertion`), get back a real `type: 'api'` access
  token scoped to whatever `SERVICE_PERMISSIONS_<serviceId>`/ `SERVICE_RATE_LIMIT_<serviceId>` the
  operator configured for it. Carries the same `X-Znx-Admin-Protocol` header as the other two admin
  APIs.

### Changed

- `/admin/triggers`/`/admin/templates` now accept either a human admin's `type: 'user'` token or a
  machine caller's `type: 'api'` one on the same route (`AuthTokenValidation`'s `type` option now
  takes `['user', 'api']`, via `@zanix/auth`'s new array support) — unblocks
  `@zanix/notifications`'s `RemoteTemplateBackend` (and any other machine caller) from
  authenticating against these APIs without reusing a human-shaped session as a stopgap.
- **The admin domain now lives entirely in `@zanix/admin`, not here** — `ADMIN_ROLE`/
  `ADMIN_TEMPLATES_ROLE`/`ADMIN_TRIGGERS_ROLE`, the protocol registry (`ADMIN_PROTOCOL_VERSION`/
  `ADMIN_PROTOCOL_SUPPORTED_VERSIONS`, negotiated via `@zanix/server`'s generic `versionProtocol`
  option — see that package's own CHANGELOG), `TemplatesAdminService`/`Repository` + RTOs,
  `TriggersAdminService`/`Repository` + RTOs (the local, single-service CRUD business logic, not
  just the wire contract), the `/admin/service-token` controller
  (`createServiceExchangeController`), and `TemplatesAdminClient`/`TriggersAdminClient`. This
  package depends on `@zanix/admin` and re-exports the same symbols from its own `mod.ts` unchanged,
  so no consumer import needs to change. Previously `@zanix/admin` depended on `@zanix/core` to
  reuse a subset of these (an inverted dependency inconsistent with every other Zanix library, none
  of which depend on `@zanix/core` — it depends on them), and its own `/templates` controller
  duplicated `@zanix/core`'s `/admin/templates` controller almost verbatim. `@zanix/core`'s
  `defineAdminMetadata()` now calls `@zanix/admin`'s
  `createTriggersAdminController`/`createTemplatesController`/`createServiceExchangeController`
  directly — no local wrapper files, no duplicate controller classes. No public API change for
  existing `@zanix/core` consumers.
- `ZanixAdminHub` (`@zanix/admin`'s own reference deployable entrypoint) is now re-exported as a
  named export from `@zanix/core`'s `mod.ts`, so a team that wants both roles — this service's own
  business API, plus the centralized admin hub — can do so via `@zanix/core` alone. `Zanix.start()`
  and `ZanixAdminHub.start()` resolve their own public REST server's port from the same env-var
  fallback chain, so calling both in the same process needs a distinct `port` passed to at least one
  of them.
- The admin protocol is no longer purely informational: `@zanix/admin`'s controllers now configure
  `@zanix/server`'s generic `versionProtocol` option, which validates a caller's own declared
  `X-Znx-Admin-Protocol` request header against what it still understands, rejecting an unrecognized
  version with `400 Bad Request` instead of silently processing a request shape it may not actually
  understand. No behavior change for any existing caller — none send this header today, and absence
  always defaults to the current version.
- Removed the dead re-export of `adminProtocolInterceptor`/`adminProtocolGuard` — `@zanix/admin`
  deleted both functions in favor of `@zanix/server`'s generic `versionProtocol` option (see that
  package's own CHANGELOG), and nothing in this package ever called them directly. Neither was ever
  part of a released `@zanix/core` version.

## [0.2.3] - 2025-12-11

### Added

- AsyncMQ core library support.

## [0.2.2] - 2025-11-27

### Added

- Zanix Notifications core library support.

## [0.2.0] - 2025-11-19

### Changed

- Updated dependencies to their latest versions.

## [0.1.4] - 2025-11-04

### Added

- Zanix database core connector load

## [0.1.3] - 2025-10-23

### Changed

- Internal server definitions

## [0.1.2] - 2025-10-22

### Changed

- Server starting

## [0.1.1] - 2025-10-16

### Fixed

- Import modules from local

## [0.1.0] - 2025-10-16
