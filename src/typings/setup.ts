import type {
  BootstrapServerOptions,
  HealthOptions,
  MiddlewareGuard,
  WebServerTypes,
} from '@zanix/server'
import type { ResourceBinding, RootResources, ZanixAppDefinition } from '@zanix/app'
import type {
  HttpRemoteDispatcher,
  RemoteInstanceOptions,
  ZanixAppServerOptions,
} from '@zanix/app/runtime'

/**
 * Per-type config accepted by `SetupOptions.admin` — identical to `BootstrapServerOptions[K]`
 * except `application` is omitted: an admin sub-server is always bound to the `'admin'` Application
 * (see `modules/start.ts`'s admin bootstrap block), so passing it here would be silently overridden
 * at runtime — this type turns that into a compile-time error instead. An explicit `id`/
 * `previousId` here always wins over the `ADMIN_SERVER_ID`/`ADMIN_SERVER_ID_PREVIOUS` env vars
 * (same "explicit option beats env var" precedence every other Zanix option follows) — omit them
 * to fall back to the env-derived value, same as before. `previousId` is never applied for
 * `graphql` regardless of source (`compileRuntime` rejects it for that type outright).
 *
 * Built generically from `WebServerTypes` (`rest`/`graphql`/`socket`/`ssr`), so every type
 * `bootstrapServers` itself accepts here type-checks — including `ssr`, even though `@zanix/admin`
 * doesn't compose any `ssr` routes of its own today. `modules/start.ts`'s own `ADMIN_TYPES` is kept
 * in sync with this (a compile-time check there fails if they ever diverge), so an `ssr` entry is
 * never silently dropped: it's a no-op unless your own app also composes an `ssr` handler under the
 * shared `'admin'` Application (see `docs/admin-apis.md`'s "Scope" section).
 *
 * `health` (a sibling of the per-type fields, not nested under one — see `start()`'s own doc)
 * defaults to whatever `SetupOptions.server.health` resolves to when omitted here — the embedded
 * admin server shares the main server's port by default, so by default it also shares its health
 * decision; set this explicitly only to make admin's own health independent of the main app's.
 */
export type AdminBootstrapServerOptions =
  & Partial<
    {
      [K in WebServerTypes]: Omit<
        NonNullable<BootstrapServerOptions[K]>,
        'application'
      >
    }
  >
  & { health?: boolean | HealthOptions }

/**
 * A Zanix App (`defineZanixApp()`'s manifest) declared via a named `SetupOptions.apps` entry.
 * This entry's own `apps` key MUST match `definition`'s own manifest `name` (an app's identity
 * comes from its manifest, never from whatever key it happens to be registered under) —
 * `start()` throws explicitly on a mismatch rather than silently serving nothing.
 */
export interface ZanixAppBootstrapOptions {
  /** `defineZanixApp()`'s own return value — never the raw, un-normalized manifest object passed
   * to it. */
  definition: ZanixAppDefinition
  /** Per-type server config, needed to actually SERVE this app's own routes — omit for an app
   * that only needs jobs/resources/lifecycle, no HTTP surface at all (see `ZanixAppServerOptions`'s
   * own doc). */
  server?: ZanixAppServerOptions
  /** This app's resource bindings — resolves each `dependencies` slot the manifest declared to a
   * concrete resource from `SetupOptions.resources`. This entry's own `apps` key is the binding's
   * `appName`; never repeated here. */
  uses?: Array<Omit<ResourceBinding, 'appName'>>
  /** Overrides for this app's own `behaviors` (see `@zanix/app`'s `BehaviorDeclaration` — a pure
   * function/strategy slot, distinct from `resources`/`uses`: no construction, no `close()`, no
   * health-gating, just a function). Each key must be a `behaviors` name the manifest itself
   * declared — `Zanix.start()` throws (before anything else is constructed) if a key here names a
   * behavior the app never declared, or if `apps` never declares this app at all. Unlike `uses`
   * (which names an ALTERNATIVE RESOURCE to resolve), the replacement implementation is given
   * directly — there's no construction step to defer. */
  behaviors?: Record<string, (...args: never[]) => unknown>
  /** Announces this app to the Control Plane Registry once its own local `onStart` completes, so
   * another Zanix App (in this same process or a genuinely different one) can reach it via
   * `ctx.remote('${this app's name}')` — see `@zanix/app/runtime`'s `RemoteInstanceOptions`. Same
   * shape and behavior `bootstrapRemoteApp`'s own `remoteInstances` option already gives a
   * standalone app; this is the equivalent for an app embedded via `Zanix.start()`'s `apps`
   * option, which previously had no way to reach the Control Plane at all — `start()` folds every
   * entry that sets this into ONE `activateApps()` call alongside every other named `apps` entry,
   * same batching `uses`/`behaviors` already get.
   *
   * **Presence of this field IS the decision** to run this app in `remote` mode for THIS process —
   * the manifest's own `runtime.mode` is only ever the author's default suggestion, never enforced
   * by itself (see `RemoteInstanceOptions`'s own doc). Omit to keep this app local-only for this
   * process, even if its own manifest declares `runtime: { mode: 'remote' }`. */
  remoteInstances?: RemoteInstanceOptions
}

/**
 * Named secondary apps to bootstrap alongside the main one (see `SetupOptions.apps`). `'main'` (==
 * `@zanix/server`'s `DEFAULT_APPLICATION`) is reserved for the main app itself, configured via the
 * top-level `server`/`rootDir` instead — using it as a key here throws. `'admin'` is also reserved
 * — the built-in admin server is configured via the top-level `admin` option instead, not through
 * `apps` — using it as an `apps` key throws for the same reason.
 */
export type AppsOptions = Record<string, ZanixAppBootstrapOptions>

/**
 * Options accepted by `SetupOptions.codeTemplatesDiscovery`'s object form.
 *
 * @property {MiddlewareGuard[]} [guards] - Overrides the default guard entirely. Defaults to
 * `@zanix/auth`'s `jwtValidationGuard({ permissions: [ADMIN_ROLE, ADMIN_TEMPLATES_ROLE], type:
 * ['user', 'api'] })` — the same role this process's own `/.well-known/zanix/templates` (DB-backed
 * templates Discovery, when `admin` composes it) already requires, so one role protects every
 * templates-shaped Discovery surface consistently. Pass `[]` explicitly to deliberately serve it
 * unauthenticated instead — never omitted silently.
 * @property {string} [application] - Which Application composes the route under. Defaults to the
 * `'admin'` Application when `admin` is enabled (matching where `ZANIX_ADMIN_SERVICES`'s
 * `adminBaseUrl` conventionally points for this process), or the default Application otherwise —
 * `admin`'s own server not existing at all when `admin` is disabled, registering under it in that
 * case would leave the route metadata live but never actually served.
 */
export type CodeTemplatesDiscoveryOptions = {
  guards?: MiddlewareGuard[]
  application?: string
}

/**
 * Configuration options used to set up server instances for various web server types and bootstrap the `Zanix` project
 *
 * This type allows partial configuration of one or more supported server types: `'graphql'`,
 * `'rest'`, `'socket'`, and `'ssr'`.
 *
 * @property {BootstrapServerOptions} [server] - An optional object where each key is a web server
 * type (`'graphql'`, `'rest'`, `'socket'`, or `'ssr'`), and the value is a partial server
 * configuration specific to that type.
 * @property {string | string[]} [rootDir] - Base directory (or directories) to auto-discover this
 * app's own handler/interactor/connector/provider/`.defs.ts` files from (see `@zanix/server`'s
 * `ZANIX_SERVER_MODULES`), resolved relative to the process's working directory. Defaults to
 * `'.'` — scan the whole project from `Deno.cwd()`, same as when this is omitted today. Useful to
 * scope discovery to a subdirectory (e.g. a monorepo package, or an isolated test fixture tree), or
 * to several of them at once. Does **not** provide isolation between multiple `start()` calls in
 * the same process — the underlying route/DI/discovery registries are still process-wide
 * singletons regardless of `rootDir`; see `start()`'s own `isStarting` guard for why two
 * overlapping calls are rejected outright rather than treated as independent instances.
 * @property {boolean | AdminBootstrapServerOptions} [admin] - Enables and configures the admin
 * server(s) (`@zanix/admin`'s triggers/templates/service-token routes). **Disabled by default.**
 * See `docs/admin-apis.md` for the full breakdown; in short:
 *   - `undefined` / `false` (default): no admin metadata is registered and no admin server boots
 *     at all. Run `ZanixAdminHub.start()` as its own standalone deployment instead if you need these
 *     routes without embedding them in this process. There is no runtime guard against also calling
 *     `ZanixAdminHub.start()` in THIS same process, regardless of whether `admin` is enabled here —
 *     the two are genuinely safe to coexist, in either order, even without an `await` between them:
 *     this option's own local admin CRUD lives under `ADMIN_APPLICATION`, `ZanixAdminHub`'s central
 *     aggregator/proxy lives under its own, distinct `ADMIN_HUB_APPLICATION` — two separate
 *     Applications whose routes never collide (see `@zanix/admin`'s own `start()` doc, and
 *     `core/src/@tests/functional/admin-hub-coexistence*.test.ts` for the regression coverage).
 *   - `true`: enabled. Each type (`rest`/`graphql`/`socket`/`ssr`) defaults to the same port
 *     `server`'s own config resolves to for that type, sharing one listener — unless
 *     `PORT`/`PORT_<TYPE>` says otherwise, which applies uniformly to both (see `@zanix/server`'s
 *     `bootstrapServers`). `@zanix/admin` doesn't compose any `ssr` routes of its own, so
 *     `admin.ssr` is only useful if your own app also composes an `ssr` handler under the shared
 *     `'admin'` Application.
 *   - `AdminBootstrapServerOptions`: enabled, explicit per-type config, same shape as `server`
 *     **except `application` is not accepted** — an admin sub-server is always bound to the
 *     `'admin'` Application; passing it is a type error rather than a silent override. An explicit
 *     `admin.<type>.port` gets that type its own separate port instead of sharing. `id`/
 *     `previousId` here have an env-var-derived fallback (`ADMIN_SERVER_ID`/
 *     `ADMIN_SERVER_ID_PREVIOUS`) — see `AdminBootstrapServerOptions`'s own doc for the precedence.
 * @property {AppsOptions} [apps] - Named secondary Zanix Apps (`defineZanixApp()` manifests)
 * bootstrapped alongside the main one, each on its own Application (see `@zanix/server`'s
 * `docs/handlers.md#applications`) so their routes/resolvers never leak onto the main app's or
 * each other's. Resolved as one batch (`@zanix/app/runtime`'s `activateApps`, so apps sharing a
 * root resource — see `resources` below — resolve to the same instance), then served
 * individually per entry that declares its own `server`. See `ZanixAppBootstrapOptions`.
 * `'main'`/`'admin'` are reserved keys (the main app is configured via the top-level
 * `server`/`rootDir`, the admin server via the top-level `admin`) and throw if used here.
 * @property {RootResources} [resources] - Root-level resources (e.g. a shared `mongo`/`redis`
 * connector) that a Zanix App declared in `apps` can bind its own `dependencies` slots to, via
 * that entry's own `uses` (see `ZanixAppBootstrapOptions`).
 * @property {HttpRemoteDispatcher} [dispatcher] - Overrides how `ctx.remote()` reaches a target
 * app not running in this same process, for every app in `apps` at once (`@zanix/app/runtime`'s
 * `activateApps`'s own 4th argument). Omitted (the default), this auto-detects the
 * `'controlPlane'` core-provider slot (registered only if `@zanix/app/core` was imported) and uses
 * a plain `HttpRemoteAdapter`; if that slot was never registered either, every `ctx.remote()` call
 * resolves local-only. Pass an `HttpRemoteAdapter` constructed with `mtls` options (or your own
 * `HttpRemoteDispatcher` implementation) only when the default auto-detected one isn't enough —
 * this always wins over it regardless. Independent of `ZanixAppBootstrapOptions.remoteInstances`:
 * that decides whether THIS process announces an app as reachable, this decides how THIS process
 * reaches other apps.
 * @property {boolean | CodeTemplatesDiscoveryOptions} [codeTemplatesDiscovery] - Exposes this
 * process's own in-code notification templates (`@zanix/notifications`'s `CODE_TEMPLATES`) under
 * `/.well-known/zanix/code-templates`, via `defineCodeTemplatesDiscovery()`. **Disabled by
 * default** — this is a genuinely separate decision from `TEMPLATES_SERVICE_URL` (Mode C,
 * consuming templates from elsewhere): a service can consume from a remote template source without
 * ever agreeing to expose its own catalog back (the target might not even be Zanix-based, or the
 * operator on the other end might simply never register this service to pull from at all — the
 * `POST admin/templates/sync` trigger `RemoteTemplateBackend` fires is already best-effort,
 * catching and logging its own failure, never a hard requirement). Enable this explicitly only once
 * you actually want some external central service to be able to pull your code templates as seed
 * data. `true` uses the default guard/Application (see `CodeTemplatesDiscoveryOptions`); pass an
 * object to override either.
 */
export type SetupOptions = {
  server?: BootstrapServerOptions
  rootDir?: string | string[]
  admin?: boolean | AdminBootstrapServerOptions
  apps?: AppsOptions
  resources?: RootResources
  dispatcher?: HttpRemoteDispatcher
  codeTemplatesDiscovery?: boolean | CodeTemplatesDiscoveryOptions
}

/**
 * Options accepted by `Zanix.compose()`'s second parameter — see that function's own doc for the
 * full "why admin, never apps" rationale.
 *
 * @property {boolean} [admin] - Also registers `@zanix/admin`'s built-in local admin app
 * (`defineLocalAdminApp()`) and its enabled sub-apps (`getLocalAdminSubApps()`) — the exact same
 * manifests `start()`'s own `admin` option composes — so their routes become visible via
 * `ProgramModule.routes.getRoutes('rest')` too. **Disabled by default**, matching `SetupOptions
 * .admin`'s own default. Verified safe to include here (unlike `SetupOptions.apps`, still excluded
 * — see `compose()`'s own doc): none of these manifests declare `dependencies`/`resources`/
 * `onStart`/`onStop`/`jobs`, so `activateApps()`'s own resource-resolution/lifecycle steps are
 * genuine no-ops for this specific, fixed set — this option can never construct a real connector,
 * start a timer, or leave anything needing an explicit `deactivateApps()`/teardown call.
 */
export type ComposeOptions = {
  admin?: boolean
}
