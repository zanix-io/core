import type { SetupOptions } from 'typings/setup.ts'
import type { BootstrapServerOptions } from '@zanix/server'

import {
  defineAdminMetadata,
  defineCoreMetadata,
  defineLocalMetadata,
  registerWorkerTaskerUrl,
} from 'utils/metadata.ts'
import logger from '@zanix/logger'
import {
  bootstrapServers,
  DEFAULT_APPLICATION,
  ProgramModule,
  releaseAdminRegistration,
  resolveAdminServerId,
  resolvePreviousAdminServerId,
  type ServerID,
  webServerManager,
} from '@zanix/server'

const allServers: ServerID[] = []
/** Set once per boot that actually enabled `admin` — read by `stop()` to release the guard. */
let adminEnabled = false

/** Server types the admin server bootstraps — see `start()`'s `admin` option. */
const ADMIN_TYPES = ['rest', 'graphql', 'socket'] as const

/**
 * Main function to start all servers
 * @param options
 *
 * @remarks
 * `options.admin` (disabled by default) mounts `@zanix/admin`'s built-in triggers/templates/
 * service-token routes as a second server, bound to the `'admin'` Application — anchored
 * (id-prefixed) whenever `ADMIN_SERVER_ID` is set, a plain unprefixed server otherwise (see
 * `docs/HANDLERS.md`'s "Applications" and "Anchored servers" sections) — alongside the main one —
 * `@zanix/server`'s route registry partitions routes by Application per
 * route/resolver, so these never leak onto the public `bootstrapServers` call further down, and the
 * public app's own (default-Application) routes never leak onto this admin server either. A given
 * sub-server (`rest`/`graphql`/`socket`) only actually gets created once `defineAdminMetadata()`
 * registers at least one matching `'admin'`-Application route/resolver (currently: the
 * triggers/service-token REST routes always, the templates REST routes when DB-backed templates
 * are enabled) — if none are active for a type, that type is a no-op, same as the main server's own
 * "no handlers found" case below. The `'admin'` Application is shared process-wide, not scoped to
 * this admin registration alone — see `docs/admin-apis.md`'s "Scope" caveat if the app itself also
 * registers its own routes under it.
 *
 * See `docs/admin-apis.md` for the full `admin` option shape (boolean vs. explicit per-type
 * config), the zero-config `PORT`/`PORT_<TYPE>` shared-listener story for single-port platforms
 * (Heroku, Render, etc.), and why this must never run in the same process as `ZanixAdmin.start()`.
 */
export const start: (options?: SetupOptions) => Promise<void> = async (
  options: SetupOptions = {},
) => {
  /** Define project metadata */

  registerWorkerTaskerUrl()
  adminEnabled = !!options.admin

  // The app's own auto-discovered controllers (`defineLocalMetadata`'s directory scan) are
  // explicitly attributed to the default Application (see `docs/HANDLERS.md`'s "Applications"
  // section) — already the default when no scope is active, but wrapped explicitly here so
  // ownership stays traceable to this one call site rather than an absence of one, and stays
  // correct even if this ever runs nested inside another `defineApplication` scope later.
  await Promise.all([
    defineCoreMetadata(),
    ProgramModule.defineApplication(DEFAULT_APPLICATION, defineLocalMetadata),
  ])

  if (adminEnabled) {
    // `defineAdminMetadata()` itself calls `guardSingleAdminRegistration('core')` first — see
    // `utils/metadata.ts` — so the same protection applies even if it's ever called directly.
    await defineAdminMetadata()

    /** Start admin servers */

    const adminConfig = typeof options.admin === 'object' ? options.admin : {}

    const adminServers: BootstrapServerOptions = {}
    for (const type of ADMIN_TYPES) {
      const { port, ...rest } = adminConfig[type] ?? {}
      const adminId = resolveAdminServerId(type)
      adminServers[type] = {
        ...rest,
        // Omitted `admin.<type>.port` reuses whatever `server.<type>` resolves to, sharing one
        // listener by default — see `docs/admin-apis.md`. `PORT`/`PORT_<TYPE>` (if set) still wins
        // over both, applying uniformly to the main and admin servers of that type alike (see
        // `WebServerManager.getEnvPort`).
        port: port ?? options.server?.[type]?.port,
        // Anchored (id-prefixed) iff `ADMIN_SERVER_ID` is set — there is no auto-generated
        // anchored id. `ADMIN_SERVER_ID_PREVIOUS`, if also set, keeps the old prefix reachable
        // alongside the new one for a manual rotation window — see `resolvePreviousAdminServerId`.
        // Not passed for `graphql`: `compileRuntime` rejects `previousId` for that type outright
        // (rotating it would compile an empty stub schema — see `RuntimeActivation.previousId`'s
        // own doc), so this admin bootstrap must not pass one for it regardless of the env var.
        id: adminId,
        previousId: type === 'graphql' ? undefined : resolvePreviousAdminServerId(type),
        application: 'admin',
        // Unanchored (no `adminId`), this server would otherwise fall back to `bootstrapServers`'s
        // own generic per-type default (`'api'`/`'graphql'`/`'socket'`) — the SAME default the main
        // server (above, sharing the same port by default) uses. Without `ADMIN_SERVER_ID` set,
        // sharing a port would then silently collide: the second `create()` call's handler would
        // clobber the first's at the same dispatch key. Giving this server its own distinct
        // default prefix keeps that combination safe even without opting into anchoring — only
        // applied when unanchored; an anchored server's own id already avoids the collision, and an
        // explicit `admin.<type>.globalPrefix` (if any) always wins regardless.
        globalPrefix: rest.globalPrefix ?? (adminId ? undefined : `admin-${type}`),
      }
    }

    // Not the last `bootstrapServers` call of this boot sequence, so it must not purge the
    // metadata (pending GraphQL resolvers, the route registry) the local/public call below still
    // needs to read. See `@zanix/server`'s `bootstrapServers` doc comment.
    const internalServers = await bootstrapServers(adminServers, { finalize: false })

    allServers.push(...internalServers)
  }

  /** Start local servers */

  // The last call of the sequence — finalizes as usual (default `finalize: true`).
  const localServers = await bootstrapServers(options.server)

  if (!localServers.length) {
    logger.warn(
      'The main server was not started because no corresponding handlers were found.',
      'noSave',
    )
  }

  allServers.push(...localServers)
}

/**
 * Function to stop all servers
 */
export const stop: () => Promise<void> = async () => {
  await webServerManager.stop(allServers)
  if (adminEnabled) releaseAdminRegistration('core')
}
