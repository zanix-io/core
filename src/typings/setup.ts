import type { BootstrapServerOptions, MiddlewareGuard, WebServerTypes } from '@zanix/server'

/**
 * Per-type config accepted by `SetupOptions.admin` — identical to `BootstrapServerOptions[K]`
 * except `application` is omitted: an admin sub-server is always bound to the `'admin'` Application
 * (see `modules/start.ts`'s admin bootstrap block), so passing it here would be silently overridden
 * at runtime — this type turns that into a compile-time error instead. An explicit `id`/
 * `previousId` here always wins over the `ADMIN_SERVER_ID`/`ADMIN_SERVER_ID_PREVIOUS` env vars
 * (same "explicit option beats env var" precedence every other Zanix option follows) — omit them
 * to fall back to the env-derived value, same as before. `previousId` is never applied for
 * `graphql` regardless of source (`compileRuntime` rejects it for that type outright).
 */
export type AdminBootstrapServerOptions = Partial<
  {
    [K in WebServerTypes]: Omit<NonNullable<BootstrapServerOptions[K]>, 'application'>
  }
>

/**
 * Per-type config accepted by a named entry of `SetupOptions.apps`. There is no env-var-derived
 * `id`/`previousId` fallback here: that resolution (`ADMIN_SERVER_ID`/`ADMIN_SERVER_ID_PREVIOUS`)
 * is exclusive to the top-level `admin` option — a named app only ever uses whatever
 * `id`/`previousId`/`port` is passed explicitly in `server`.
 *
 * @property {string | string[]} [rootDir] - Directory (or directories) to auto-discover this
 * app's own handler/interactor/connector/provider/`.defs.ts` files from, scoped to its own
 * Application (named after this entry's own key in `apps`) — never mixed with the main app's or
 * any other named app's discovery. Resolved relative to the process's working directory, same as
 * the top-level `rootDir`.
 * @property {BootstrapServerOptions} [server] - Same shape as the top-level `server` option,
 * **except `application` is not accepted** — this app is always bound to its own Application
 * (named after its own key in `apps`), passing it is a type error rather than a silent override.
 */
export type AppBootstrapOptions = {
  rootDir?: string | string[]
  server?: Partial<
    { [K in WebServerTypes]: Omit<NonNullable<BootstrapServerOptions[K]>, 'application'> }
  >
}

/**
 * Named secondary apps to bootstrap alongside the main one (see `SetupOptions.apps`). `'main'` (==
 * `@zanix/server`'s `DEFAULT_APPLICATION`) is reserved for the main app itself, configured via the
 * top-level `server`/`rootDir` instead — using it as a key here throws. `'admin'` is also reserved
 * — the built-in admin server is configured via the top-level `admin` option instead, not through
 * `apps` — using it as an `apps` key throws for the same reason.
 */
export type AppsOptions = Record<string, AppBootstrapOptions>

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
 * This type allows partial configuration of one or more supported server types: `'graphql'`, `'rest'`, and `'socket'`.
 *
 * @property {BootstrapServerOptions} [server] - An optional object where each key is a web server type (`'graphql'`, `'rest'`, or `'socket'`),
 * and the value is a partial server configuration specific to that type.
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
 *     routes without embedding them in this process — never both in the same process (a runtime
 *     guard throws if you do, whenever `admin` is actually enabled on this side and
 *     `ZanixAdminHub.start()` also runs, in either order).
 *   - `true`: enabled. Each type (`rest`/`graphql`/`socket`) defaults to the same port `server`'s
 *     own config resolves to for that type, sharing one listener — unless `PORT`/`PORT_<TYPE>`
 *     says otherwise, which applies uniformly to both (see `@zanix/server`'s `bootstrapServers`).
 *   - `AdminBootstrapServerOptions`: enabled, explicit per-type config, same shape as `server`
 *     **except `application` is not accepted** — an admin sub-server is always bound to the
 *     `'admin'` Application; passing it is a type error rather than a silent override. An explicit
 *     `admin.<type>.port` gets that type its own separate port instead of sharing. `id`/
 *     `previousId` here have an env-var-derived fallback (`ADMIN_SERVER_ID`/
 *     `ADMIN_SERVER_ID_PREVIOUS`) — see `AdminBootstrapServerOptions`'s own doc for the precedence.
 * @property {AppsOptions} [apps] - Named secondary apps bootstrapped alongside the main one, each
 * on its own Application (see `@zanix/server`'s `docs/HANDLERS.md#applications`) so their
 * routes/resolvers never leak onto the main app's or each other's. Bootstrapped in declaration
 * order, sequentially — never concurrently — before the main app's own (finalizing) bootstrap. See
 * `AppBootstrapOptions`. `'main'`/`'admin'` are reserved keys (the main app is configured via the
 * top-level `server`/`rootDir`, the admin server via the top-level `admin`) and throw if used here.
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
  codeTemplatesDiscovery?: boolean | CodeTemplatesDiscoveryOptions
}
