import type { AppBootstrapOptions, SetupOptions } from 'typings/setup.ts'
import type { BootstrapServerOptions } from '@zanix/server'

import {
  defineAdminMetadata,
  defineCoreMetadata,
  defineLocalMetadata,
  registerWorkerTaskerUrl,
} from 'utils/metadata.ts'
import logger from '@zanix/logger'
import { InternalError } from '@zanix/errors'
import {
  bootstrapServers,
  createStartLifecycleGuard,
  DEFAULT_APPLICATION,
  ProgramModule,
  resolveApplicationServerId,
  resolvePreviousApplicationServerId,
  type ServerID,
  webServerManager,
} from '@zanix/server'
import { defineCodeTemplatesDiscovery } from '@zanix/notifications'
import { createTemplatesDiscoveryGuard } from '@zanix/admin'

/** The Application `options.admin` composes its embedded controllers under — see `start()`'s own doc. */
const ADMIN_APPLICATION = 'admin'

const allServers: ServerID[] = []

/**
 * Guards against overlapping/repeated `start()` calls — see `@zanix/server`'s
 * `createStartLifecycleGuard` for the exact races this covers and why. `overlapNote` preserves this
 * package's own extra clause (naming `admin` as the concrete symptom of a lost race) that
 * `@zanix/admin`'s own `ZanixAdminHub.start()` doesn't carry, since it has no equivalent option.
 */
const lifecycleGuard = createStartLifecycleGuard({
  startLabel: 'Zanix.start()',
  stopLabel: 'Zanix.stop()',
  source: 'zanix',
  overlapNote: '(e.g. `admin` on the first call being dropped) ',
})

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
 * `@zanix/server`'s route registry partitions routes by Application per route/resolver, so these
 * never leak onto the public `bootstrapServers` call further down, and the public app's own
 * (default-Application) routes never leak onto this admin server either. A given sub-server
 * (`rest`/`graphql`/`socket`) only actually gets created once `defineAdminMetadata()` registers at
 * least one matching `'admin'`-Application route/resolver (currently: the triggers/service-token
 * REST routes always, the templates REST routes when DB-backed templates are enabled) — if none
 * are active for a type, that type is a no-op, same as the main server's own "no handlers found"
 * case below. The `'admin'` Application is shared process-wide, not scoped to this admin
 * registration alone — see `docs/admin-apis.md`'s "Scope" caveat if the app itself also registers
 * its own routes under it.
 *
 * `options.apps` bootstraps named secondary apps alongside the main one (`server`/`rootDir`),
 * each bound to its own Application (named after its own key in `apps`) — same route-registry
 * partitioning as `admin`, so these never leak onto the main app's or each other's routes.
 * Bootstrapped sequentially, in declaration order — never concurrently — the same conservative
 * "no concurrent registry mutation" rule the `isStarting` guard below enforces for `start()`
 * itself applies here too, since every entry mutates the same process-wide route/DI/discovery
 * registries. `'main'` (== `DEFAULT_APPLICATION`) and `'admin'` are reserved `apps` keys — the
 * main app is configured via the top-level `server`/`rootDir`, the admin server via the top-level
 * `admin` — using either as an `apps` key throws immediately.
 *
 * See `docs/admin-apis.md` for the full `admin` option shape (boolean vs. explicit per-type
 * config), the zero-config `PORT`/`PORT_<TYPE>` shared-listener story for single-port platforms
 * (Heroku, Render, etc.), and how this coexists in the same process with `ZanixAdminHub.start()`
 * (its own central-hub route set, `ADMIN_HUB_APPLICATION`) if both are wanted together.
 */
export const start: (options?: SetupOptions) => Promise<void> = async (
  options: SetupOptions = {},
) => {
  lifecycleGuard.guardReentry()

  try {
    // The whole sequence below (composition + every `bootstrapServers()` call) runs under one
    // shared boot session (see `@zanix/server`'s `BootSessionContainer`) — so this call's own last
    // `bootstrapServers()` finalize (still free to sweep everything THIS sequence itself touched,
    // 'main'/'admin'/any named `apps`) preserves whichever Applications an independent,
    // concurrently-running sequence (e.g. `ZanixAdminHub.start()` fired without an `await` in
    // between) currently owns, never wiping its not-yet-served routes.
    await ProgramModule.runBootSession(async () => {
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
        ProgramModule.defineApplication(
          DEFAULT_APPLICATION,
          () => defineLocalMetadata(options.rootDir),
        ),
      ])

      // Genuinely independent of `admin`/`TEMPLATES_SERVICE_URL` — see `SetupOptions
      // .codeTemplatesDiscovery`'s own doc for why neither implies this. Registered under the
      // `'admin'` Application (matching where `ZANIX_ADMIN_SERVICES`'s `adminBaseUrl` conventionally
      // points once anchored) whenever `admin` is also enabled; the default Application otherwise,
      // since `'admin'` has no server backing it at all in that case — registering under it would
      // leave the route live in metadata but never actually served.
      if (options.codeTemplatesDiscovery) {
        const config = typeof options.codeTemplatesDiscovery === 'object'
          ? options.codeTemplatesDiscovery
          : {}
        const application = config.application ??
          (adminEnabled ? ADMIN_APPLICATION : DEFAULT_APPLICATION)
        const guards = config.guards ?? [createTemplatesDiscoveryGuard()]
        await ProgramModule.defineApplication(application, () => {
          defineCodeTemplatesDiscovery({ guards })
        })
      }

      if (adminEnabled) {
        await defineAdminMetadata()

        /** Start admin servers */

        const adminConfig = typeof options.admin === 'object' ? options.admin : {}

        const adminServers: BootstrapServerOptions = {}
        for (const type of ADMIN_TYPES) {
          const { port, ...rest } = adminConfig[type] ?? {}
          // An explicit `admin.<type>.id`/`.previousId` always wins over the env-derived value —
          // same "explicit option beats env var" precedence every other Zanix option already
          // follows (e.g. `ZanixMongoConnector`'s `uri` vs. `MONGO_URI`). Needed to run more than
          // one admin-enabled process/instance distinguishably without relying on a single
          // process-wide `ADMIN_SERVER_ID` env var to tell them apart — `port` (right below)
          // already got this right; `id`/`previousId` previously didn't, silently discarding
          // whatever was passed even though `AdminBootstrapServerOptions`'s own type allows setting
          // them.
          const id = rest.id ?? resolveApplicationServerId(ADMIN_APPLICATION, type)
          const previousId = type === 'graphql'
            ? undefined
            : rest.previousId ?? resolvePreviousApplicationServerId(ADMIN_APPLICATION, type)
          adminServers[type] = {
            ...rest,
            // Omitted `admin.<type>.port` reuses whatever `server.<type>` resolves to, sharing one
            // listener by default — see `docs/admin-apis.md`. `PORT`/`PORT_<TYPE>` (if set) still
            // wins over both, applying uniformly to the main and admin servers of that type alike
            // (see `WebServerManager.getEnvPort`).
            port: port ?? options.server?.[type]?.port,
            // Anchored (id-prefixed) iff an explicit `id` was passed or `ADMIN_SERVER_ID` is set —
            // there is no auto-generated anchored id otherwise. `ADMIN_SERVER_ID_PREVIOUS`/an
            // explicit `previousId`, if set, keeps the old prefix reachable alongside the new one
            // for a manual rotation window — see `resolvePreviousApplicationServerId`. `previousId` is
            // never passed for `graphql` regardless of source: `compileRuntime` rejects it for that
            // type outright (rotating it would compile an empty stub schema — see
            // `RuntimeActivation.previousId`'s own doc).
            id,
            previousId,
            application: ADMIN_APPLICATION,
            // Unanchored (no `id`), this server would otherwise fall back to `bootstrapServers`'s
            // own generic per-type default (`'api'`/`'graphql'`/`'socket'`) — the SAME default the
            // main server (above, sharing the same port by default) uses. Without an `id` from
            // either source, sharing a port would then silently collide: the second `create()`
            // call's handler would clobber the first's at the same dispatch key. Giving this server
            // its own distinct default prefix keeps that combination safe even without opting into
            // anchoring — only applied when unanchored; an anchored server's own id already avoids
            // the collision, and an explicit `admin.<type>.globalPrefix` (if any) always wins
            // regardless.
            globalPrefix: rest.globalPrefix ?? (id ? undefined : `admin-${type}`),
          }
        }

        // Not the last `bootstrapServers` call of this boot sequence, so it must not purge the
        // metadata (pending GraphQL resolvers, the route registry) the local/public call below
        // still needs to read. See `@zanix/server`'s `bootstrapServers` doc comment.
        const internalServers = await bootstrapServers(adminServers, { finalize: false })

        allServers.push(...internalServers)
      }

      /** Start named secondary apps, sequentially */

      for (const [name, config] of Object.entries(options.apps ?? {})) {
        if (name === DEFAULT_APPLICATION || name === ADMIN_APPLICATION) {
          throw new InternalError(
            `'${name}' is reserved (the main app is configured via the top-level 'server'/` +
              `'rootDir' options, the admin server via the top-level 'admin' option) — it cannot ` +
              `be used as an 'apps' key.`,
            { meta: { source: 'zanix', method: 'start' } },
          )
        }

        const { rootDir, server } = config as AppBootstrapOptions

        // deno-lint-ignore no-await-in-loop
        await ProgramModule.defineApplication(name, () => defineLocalMetadata(rootDir))

        const namedServers: BootstrapServerOptions = {}
        for (const [type, typeConfig] of Object.entries(server ?? {})) {
          namedServers[type as keyof BootstrapServerOptions] = {
            ...typeConfig,
            application: name,
            // deno-lint-ignore no-explicit-any
          } as any
        }

        // deno-lint-ignore no-await-in-loop
        const internalServers = await bootstrapServers(namedServers, { finalize: false })

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
    })
    lifecycleGuard.markRunning()
  } finally {
    lifecycleGuard.clearStarting()
  }
}

/**
 * Function to stop all servers
 */
export const stop: () => Promise<void> = async () => {
  lifecycleGuard.markStopped()
  await webServerManager.stop(allServers)
}
