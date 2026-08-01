import type { BootstrapServerOptions, WebServerTypes } from '@zanix/server'

/**
 * Per-type config accepted by `SetupOptions.admin` — identical to `BootstrapServerOptions[K]`
 * except `application` is omitted: an admin sub-server is always bound to the `'admin'` Application
 * (see `modules/start.ts`'s admin bootstrap loop), so passing it here would be silently overridden
 * at runtime — this type turns that into a compile-time error instead. `id`/`previousId` are NOT
 * omitted (type-wise settable here) but are, in practice, always resolved from
 * `ADMIN_SERVER_ID`/`ADMIN_SERVER_ID_PREVIOUS` by `modules/start.ts` regardless of what's passed —
 * same pre-existing behavior as `id` always had.
 */
export type AdminBootstrapServerOptions = Partial<
  {
    [K in WebServerTypes]: Omit<NonNullable<BootstrapServerOptions[K]>, 'application'>
  }
>

/**
 * Configuration options used to set up server instances for various web server types and bootstrap the `Zanix` project
 *
 * This type allows partial configuration of one or more supported server types: `'graphql'`, `'rest'`, and `'socket'`.
 *
 * @property {BootstrapServerOptions} [server] - An optional object where each key is a web server type (`'graphql'`, `'rest'`, or `'socket'`),
 * and the value is a partial server configuration specific to that type.
 * @property {boolean | AdminBootstrapServerOptions} [admin] - Enables and configures the admin
 * server(s) (`@zanix/admin`'s triggers/templates/service-token routes) alongside the main one.
 * **Disabled by default.** See `docs/admin-apis.md` for the full breakdown; in short:
 * - `undefined` / `false` (default): no admin metadata is registered and no admin server boots at
 *   all. Run `ZanixAdmin.start()` as its own standalone deployment instead if you need these
 *   routes without embedding them in this process — never both in the same process (a runtime
 *   guard throws if you do).
 * - `true`: enabled. Each type (`rest`/`graphql`/`socket`) defaults to the same port `server`'s
 *   own config resolves to for that type, sharing one listener — unless `PORT`/`PORT_<TYPE>` says
 *   otherwise, which applies uniformly to both (see `@zanix/server`'s `bootstrapServers`).
 * - `AdminBootstrapServerOptions`: enabled, explicit per-type config, same shape as `server`
 *   **except `application` is not accepted** — an admin sub-server is always bound to the
 *   `'admin'` Application; passing it is a type error rather than a silent override. An explicit
 *   `admin.<type>.port` gets that type its own separate port instead of sharing.
 */
export type SetupOptions = {
  server?: BootstrapServerOptions
  admin?: boolean | AdminBootstrapServerOptions
}
