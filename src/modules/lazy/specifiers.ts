/**
 * The ONE place this package's own lazily-resolved cross-package real, versioned `jsr:` specifiers
 * are written down for RUNTIME (VALUE-level) use — every lazy `import()` call site across this
 * package (`setup.ts`'s `buildAssetsService`/`setup`, `start.ts`'s `compose`/`start`) resolves its
 * own constant from here instead of inlining the string, so a real version bump is a one-line
 * change here. Scoped by CONTENT TYPE (every plain specifier string constant this package needs,
 * full stop), not by which file consumes which constant — matching `@zanix/admin`'s own identical
 * `lazy-specifiers.ts` convention.
 *
 * `@zanix/space/assets-api`'s, `@zanix/datamaster/storage`'s/`/files`'s, and
 * `@zanix/notifications`'s (bare root) specifiers below are DELIBERATELY absent from
 * `deno.jsonc`'s own top-level `imports` map:
 * `nodeModulesDir: "auto"`-style npm-install resolution materializes every package a `deno.json`
 * DECLARES, regardless of whether reachable code actually imports it — a bare alias declared
 * there is, on its own, enough to trigger it (confirmed empirically). `buildAssetsService`'s own
 * dependencies (`sharp`/`svgo` transitively through `@zanix/space/assets-api`'s `AssetTransformer`
 * composition, `@aws-sdk/client-s3` through `S3ObjectStorage`, `mongoose` through
 * `MongoFileRepository`) only apply to a `setup({ assets })` caller, and `@zanix/notifications`'s
 * own `TemplateProvider` (reaching Handlebars and every template's own Zod schema, unconditionally,
 * from the same root entry file `TEMPLATES_BACKEND_ENV`/`TEMPLATES_MODEL_ENV`/
 * `defineCodeTemplatesDiscovery` live in — confirmed via that package's own `env.ts` doc comment,
 * which isolates those two constants in their own file for exactly this reason, one layer up) only
 * applies to a caller that actually configures `notifications`/`codeTemplatesDiscovery` — a service
 * that never opts into either must never pay for any of them merely by importing `@zanix/core`.
 * Each constant here is instead a fully-qualified specifier, resolved directly, with no import-map
 * indirection at all.
 *
 * Every `const specifier = SOME_CONSTANT` two-step at each call site (never `import(SOME_CONSTANT)`
 * inline) is deliberate, not incidental: Deno's own module graph builder only follows a dynamic
 * `import()` whose argument it can resolve as a literal at parse time — routing it through a
 * variable keeps a consumer that never triggers the matching gate out of that graph entirely.
 *
 * `setup.ts`'s own `AssetService`-typed singleton stays `unknown` for the same reason `import type`
 * doesn't sidestep this: `@zanix/space/assets-api`'s `AssetService` is defined in the same file
 * that unconditionally value-imports the real `AssetTransformer` composition, so resolving the type
 * alone still requires resolving that file's full import graph — `import type` only omits the
 * runtime binding, it does not skip module resolution, so the type-checker still has to load and
 * follow that file's own imports to read the type. See `getAssetsService`'s own doc for how a
 * caller recovers the real type at the point where it's actually needed.
 */

/** `@zanix/space`'s `./assets-api` subpath — `createAssetService`/`createAssetRepositoryOverFiles`,
 * runtime, value-level use only. */
export const SPACE_ASSETS_API_SPECIFIER = 'jsr:@zanix/space@^1.1.0/assets-api'

/** `@zanix/datamaster`'s `./storage` subpath — `S3ObjectStorage`/`createFallbackObjectStorage`/
 * `createLocalFilesystemObjectStorage`/`ensureLocalObjectsSynced`/the `S3_*` env var name
 * constants. */
export const DATAMASTER_STORAGE_SPECIFIER = 'jsr:@zanix/datamaster@^1.9.0/storage'

/** `@zanix/datamaster`'s `./files` subpath — `MongoFileRepository`/`registerFileModel`/
 * `FILE_MODEL_ENV`. */
export const DATAMASTER_FILES_SPECIFIER = 'jsr:@zanix/datamaster@^1.9.0/files'

/** `@zanix/notifications`'s bare root — `TEMPLATES_BACKEND_ENV`/`TEMPLATES_MODEL_ENV` (used by
 * `setup.ts`) and `defineCodeTemplatesDiscovery` (used by `start.ts`, already gated behind
 * `options.codeTemplatesDiscovery`). No narrower subpath currently exposes these — `/core`/
 * `/connectors`/`/templates-api` all either omit them or also pull in `TemplateProvider`'s own
 * Handlebars/Zod-backed template registries — so this points at the same already-published root
 * `core`'s own `deno.jsonc` used to import statically; only HOW it's resolved changes, from an
 * eager static import to a gated, lazy one. */
export const NOTIFICATIONS_SPECIFIER = 'jsr:@zanix/notifications@^1.0.0'

/** `@zanix/datamaster`'s `./core` subpath — zero-config Mongo/Redis connector registration,
 * side-effect only (no export this package reads by name). Used by `defineCoreMetadata`
 * (`utils/metadata.ts`), called unconditionally by `start()`/`startWorker()` — the laziness here
 * isn't about skipping the call, it's about not resolving (and so not materializing `mongoose`/
 * `redis`) merely by importing the module that DEFINES `defineCoreMetadata`, for a consumer that
 * never actually calls `start()`/`startWorker()` at all (e.g. one that only imports `.`/
 * `./bootstrap` to read a type). */
export const DATAMASTER_CORE_SPECIFIER = 'jsr:@zanix/datamaster@^1.9.0/core'

/** `@zanix/auth`'s `./core` subpath — zero-config session/auth connector registration,
 * side-effect only (no export this package reads by name). Same reasoning as
 * `DATAMASTER_CORE_SPECIFIER` above. */
export const AUTH_CORE_SPECIFIER = 'jsr:@zanix/auth@^1.0.0/core'

/** `@zanix/notifications`'s `./core` subpath — zero-config Mongo/`TemplateProvider` registration,
 * side-effect only (no export this package reads by name). Same reasoning as
 * `DATAMASTER_CORE_SPECIFIER` above. */
export const NOTIFICATIONS_CORE_SPECIFIER = 'jsr:@zanix/notifications@^1.0.0/core'

/** `@zanix/asyncmq`'s `./core` subpath — zero-config RabbitMQ connector/worker-provider
 * registration, side-effect only (no export this package reads by name). Same reasoning as
 * `DATAMASTER_CORE_SPECIFIER` above. */
export const ASYNCMQ_CORE_SPECIFIER = 'jsr:@zanix/asyncmq@^0.8.0/core'

/** `@zanix/admin`'s bare root — `createTemplatesDiscoveryGuard`/`defineLocalAdminApp`/
 * `getLocalAdminSubApps` (used by `start.ts`'s `compose`/`start`, gated behind
 * `options.admin`/`options.codeTemplatesDiscovery`). Its bare root bundles those three functions in
 * the same barrel as `TemplatesAdminRepository`/`TemplatesAdminService` (reaching
 * `@zanix/notifications`'s bare root, and transitively Handlebars, unconditionally) and
 * `TriggersAdminRepository`/`TriggersAdminService` (reaching `@zanix/database`, and transitively
 * `mongoose`/`redis`) — a plain static import would materialize all of that for every
 * `@zanix/core` consumer regardless of whether `admin`/`codeTemplatesDiscovery` is ever configured.
 * `@zanix/admin`'s own `/hub` subpath doesn't help here — it exposes only `ZanixAdminHub`, not
 * these three functions, which have no narrower subpath of their own today. */
export const ADMIN_SPECIFIER = 'jsr:@zanix/admin@^2.3.0'
