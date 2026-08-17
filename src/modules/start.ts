import type { SetupOptions } from 'typings/setup.ts'
import type { BootstrapServerOptions, WebServerTypes } from '@zanix/server'
import type { ActivatedApps } from '@zanix/app/runtime'
import type { BehaviorOverride, ResourceBinding } from '@zanix/app'

import { activateApps, bootstrapAppServer, deactivateApps } from '@zanix/app/runtime'
import { defineCoreMetadata, defineLocalMetadata, registerWorkerTaskerUrl } from 'utils/metadata.ts'
import logger from '@zanix/logger'
import { InternalError } from '@zanix/errors'
import {
  bootstrapServers,
  closeAllConnections,
  createStartLifecycleGuard,
  DEFAULT_APPLICATION,
  ProgramModule,
  resolveApplicationServerId,
  resolvePreviousApplicationServerId,
  type ServerID,
  webServerManager,
} from '@zanix/server'
import { defineCodeTemplatesDiscovery } from '@zanix/notifications'
import {
  createTemplatesDiscoveryGuard,
  defineLocalAdminApp,
  getLocalAdminSubApps,
} from '@zanix/admin'

/** The Application `options.admin` composes its embedded controllers under — see `start()`'s own doc. */
const ADMIN_APPLICATION = 'admin'

const allServers: ServerID[] = []

/** Set by the most recent `start()` call that declared at least one Zanix App via `apps` — read
 * by `stop()` so it can run `deactivateApps()` (its own `onStop` + resource `close()`) before
 * tearing down the servers those apps' routes were served from. `undefined` if `apps` was never
 * given any entries, or once `stop()` has cleared it (before calling `deactivateApps`, not after —
 * see `stop()`'s own doc) — `deactivateApps`/`ResourceRegistry.close()` aren't idempotent on their
 * own, so a second `stop()` call must see `undefined` here rather than re-running them. */
let activatedApps: ActivatedApps | undefined

/**
 * The signal-triggered shutdown wrapper registered by the most recently successful `start()` call
 * — a fresh closure per call (never reused), mirroring `worker.ts`'s own `startWorker()`
 * precedent. `stop()` reads this (its own first action, before `lifecycleGuard.markStopped()`) to
 * remove the exact same function reference `Deno.addSignalListener` was given — Deno's own signal-
 * listener removal uses function-reference equality, so a shared, general-purpose `stop()` (called
 * both directly by app code/tests and indirectly by this wrapper) can't rely on the wrapper
 * removing itself the way `worker.ts`'s single-purpose `shutdown` closure does. `undefined` once
 * removed (or before the first successful `start()`) — `stop()` only calls
 * `Deno.removeSignalListener` when this is set, so calling `stop()` twice in a row is a safe no-op
 * on this front, matching `markStopped()`'s own idempotency. `createStartLifecycleGuard`'s own
 * reentry guarantee (at most one `start()` "running" per process without an intervening `stop()`)
 * is what keeps registering/removing this safe to repeat across many start/stop cycles in the same
 * process without ever leaking a listener.
 */
let signalShutdown: (() => Promise<void>) | undefined

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

/**
 * Server types the admin server bootstraps — see `start()`'s `admin` option. Lists every
 * `WebServerTypes` member, not just the ones `@zanix/admin` composes routes for today (`rest`/
 * `graphql`/`socket`) — `AdminBootstrapServerOptions` accepts all of them (it's built generically
 * from `WebServerTypes`), so a type this loop silently skipped would type-check but be dropped at
 * runtime with no error. `assertAdminTypesExhaustive` below fails to compile instead of letting
 * this drift again the next time `@zanix/server` adds a type here.
 */
const ADMIN_TYPES = ['rest', 'graphql', 'socket', 'ssr'] as const

/**
 * Compile-time-only check that {@link ADMIN_TYPES} lists every `WebServerTypes` member — fails to
 * typecheck (not silently) if `@zanix/server` ever adds one this array doesn't also list.
 */
function assertAdminTypesExhaustive<_T extends never>(): void {}
assertAdminTypesExhaustive<Exclude<WebServerTypes, (typeof ADMIN_TYPES)[number]>>()

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
 * (`rest`/`graphql`/`socket`) only actually gets created once `@zanix/admin`'s own
 * `defineLocalAdminApp()` (activated here as a Zanix App, alongside `apps`) registers at least one
 * matching `'admin'`-Application route/resolver (currently: the triggers/service-token REST routes
 * always, the templates REST routes when DB-backed templates are enabled) — if none are active for
 * a type, that type is a no-op, same as the main server's own "no handlers found" case below. The
 * `'admin'` Application is shared process-wide, not scoped to this admin registration alone — see
 * `docs/admin-apis.md`'s "Scope" caveat if the app itself also registers its own routes under it.
 *
 * `options.apps` bootstraps named secondary Zanix Apps (`defineZanixApp()` manifests, each
 * wrapped as `{ definition, server?, uses? }` — see `ZanixAppBootstrapOptions`) alongside the
 * main one, each bound to its own Application (named after its own key in `apps`, which MUST
 * match that manifest's own `name`) — same route-registry partitioning as `admin`, so these never
 * leak onto the main app's or each other's routes. Resolved as ONE batch via
 * `@zanix/app/runtime`'s `activateApps` (so apps sharing a root resource, declared in
 * `options.resources`, resolve to the same instance), then served individually per entry that
 * declares its own `server` — an entry with no `server` registers (mount + jobs + resources +
 * `setup`/`onStart`/`onStop`) but is never served. `'main'` (== `DEFAULT_APPLICATION`) and
 * `'admin'` are reserved `apps` keys — the main app is configured via the top-level
 * `server`/`rootDir`, the admin server via the top-level `admin` — using either as an `apps` key
 * throws immediately.
 *
 * See `docs/admin-apis.md` for the full `admin` option shape (boolean vs. explicit per-type
 * config), the zero-config `PORT`/`PORT_<TYPE>` shared-listener story for single-port platforms
 * (Heroku, Render, etc.), and how this coexists in the same process with `ZanixAdminHub.start()`
 * (its own central-hub route set, `ADMIN_HUB_APPLICATION`) if both are wanted together.
 *
 * A successful `start()` also traps `SIGINT`/`SIGTERM` automatically (no opt-out, same as
 * `startWorker()`'s own established precedent) — either signal runs `stop()` (draining HTTP
 * requests via `Deno.serve()`'s own `.shutdown()`, then closing connector connections) before
 * exiting, instead of the process dying mid-request the moment an orchestrator (Docker, Kubernetes,
 * ...) sends its default stop signal.
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
    // between) currently owns, never wiping its not-yet-served routes. This "genuinely concurrent,
    // no await between the two calls" scenario is exactly the one `@zanix/server`'s `AsyncContext`
    // doc flags as worth being aware of: the isolation this relies on (this call's own `'main'`/
    // `'admin'`/named-`apps` Applications, and every `ProgramModule.defineApplication` scope those
    // apps' own `registerApp`/`setup(ctx)` open) is backed by Deno's `node:async_hooks`
    // compatibility layer, not a Deno-native API — see that doc for the current maturity caveat.
    // `BootSessionContainer` already has a dedicated concurrent-interleaving regression test for
    // its own half of this; `ApplicationContainer` now does too (`application.test.ts`).
    await ProgramModule.runBootSession(async () => {
      /** Define project metadata */

      registerWorkerTaskerUrl()
      adminEnabled = !!options.admin

      // The app's own auto-discovered controllers (`defineLocalMetadata`'s directory scan) are
      // explicitly attributed to the default Application (see `docs/HANDLERS.md`'s "Applications"
      // section) — already the default when no scope is active, but wrapped explicitly here so
      // ownership stays traceable to this one call site rather than an absence of one, and stays
      // correct even if this ever runs nested inside another `defineApplication` scope later.
      await defineCoreMetadata()
      await ProgramModule.defineApplication(
        DEFAULT_APPLICATION,
        () => defineLocalMetadata(options.rootDir),
      )

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

      /** Start `admin` (sugar over adding `@zanix/admin`'s own Zanix App to `apps`) and named
       * secondary Zanix Apps: ONE `activateApps()` call for the whole batch (so apps sharing a
       * root resource resolve to the same instance — the same reason `activateApps` itself takes
       * a list, not one app at a time), then one `bootstrapAppServer()` call per entry that
       * declared its own `server` (`admin` always does; a named entry with no `server` still
       * registers — mount + jobs + resources + `setup`/`onStart`/`onStop` — but is never
       * served). */

      const zanixApps = Object.entries(options.apps ?? {})

      for (const [name] of zanixApps) {
        if (name === DEFAULT_APPLICATION || name === ADMIN_APPLICATION) {
          throw new InternalError(
            `'${name}' is reserved (the main app is configured via the top-level 'server'/` +
              `'rootDir' options, the admin server via the top-level 'admin' option) — it cannot ` +
              `be used as an 'apps' key.`,
            { meta: { source: 'zanix', method: 'start' } },
          )
        }
      }

      for (const [key, { definition }] of zanixApps) {
        // `registerApp` (inside `activateApps`) opens its Application scope keyed by the
        // MANIFEST's own `name`, never by this dictionary key — if the two differ, the
        // `bootstrapAppServer(key, ...)` call below would filter for an Application that has no
        // routes at all, silently serving nothing instead of throwing. Reject the mismatch
        // explicitly instead: an app's identity comes from its own manifest, never from whatever
        // key it happens to be registered under.
        if (definition.definition.name !== key) {
          throw new InternalError(
            `'apps.${key}' declares a Zanix App manifest named '${definition.definition.name}' ` +
              `— the 'apps' key must match the manifest's own 'name'.`,
            { meta: { source: 'zanix', method: 'start' } },
          )
        }
      }

      const defs = zanixApps.map(([, { definition }]) => definition)
      const bindings: ResourceBinding[] = zanixApps.flatMap((
        [name, { uses }],
      ) => (uses ?? []).map((binding) => ({ appName: name, ...binding })))
      // See `ZanixAppBootstrapOptions.behaviors`'s own doc — each entry's `apps` key becomes the
      // override's `appName`, mirroring `uses`/`bindings` right above.
      const behaviorOverrides: BehaviorOverride[] = zanixApps.flatMap((
        [name, { behaviors }],
      ) =>
        Object.entries(behaviors ?? {}).map((
          [behaviorName, implementation],
        ) => ({
          appName: name,
          name: behaviorName,
          implementation,
        }))
      )

      // `admin` composes first (matching this sequence's own historical ordering — admin served
      // before any named app), via `@zanix/admin`'s own Zanix App manifest, never a bespoke
      // registration path of this package's own. `getLocalAdminSubApps()` (Triggers/Templates' own
      // physically-separate operations/mcp sub-apps — see that package's own `local-admin-app.ts`
      // doc) activates alongside it in the SAME `activateApps` call, so a future sub-app sharing a
      // root resource with `defineLocalAdminApp` still resolves to the same instance.
      const localAdminSubApps = adminEnabled ? getLocalAdminSubApps() : []
      if (adminEnabled) {
        defs.unshift(defineLocalAdminApp(), ...localAdminSubApps)
      }

      if (defs.length) {
        activatedApps = await activateApps(
          defs,
          options.resources ?? {},
          bindings,
          undefined,
          undefined,
          behaviorOverrides,
        )

        if (adminEnabled) {
          /** Start admin servers */

          const adminConfig = typeof options.admin === 'object' ? options.admin : {}

          // `admin.health`'s own explicit choice always wins; omitted, this inherits whatever
          // `server.health` resolves to — the embedded admin server shares the main server's port
          // by default, so its health decision defaults to matching. Previously never set at all
          // here, so `server.health` (even `false`) had zero effect on the embedded admin server —
          // a real bug: `health` is a sibling of the per-type fields on `BootstrapServerOptions`
          // (`server.rest`/etc.), not something the per-type loop below could ever pick up.
          const adminServers: BootstrapServerOptions = {
            health: adminConfig.health ?? options.server?.health,
          }
          for (const type of ADMIN_TYPES) {
            const { port, ...rest } = adminConfig[type] ?? {}
            // An explicit `admin.<type>.id`/`.previousId` always wins over the env-derived value —
            // same "explicit option beats env var" precedence every other Zanix option already
            // follows (e.g. `ZanixMongoConnector`'s `uri` vs. `MONGO_URI`). Needed to run more than
            // one admin-enabled process/instance distinguishably without relying on a single
            // process-wide `ADMIN_SERVER_ID` env var to tell them apart — `port` (right below)
            // already got this right; `id`/`previousId` previously didn't, silently discarding
            // whatever was passed even though `AdminBootstrapServerOptions`'s own type allows
            // setting them.
            const id = rest.id ??
              resolveApplicationServerId(ADMIN_APPLICATION, type)
            const previousId = type === 'graphql' ? undefined : rest.previousId ??
              resolvePreviousApplicationServerId(ADMIN_APPLICATION, type)
            adminServers[type] = {
              ...rest,
              // Omitted `admin.<type>.port` reuses whatever `server.<type>` resolves to, sharing
              // one listener by default — see `docs/admin-apis.md`. `PORT`/`PORT_<TYPE>` (if set)
              // still wins over both, applying uniformly to the main and admin servers of that
              // type alike (see `WebServerManager.getEnvPort`).
              port: port ?? options.server?.[type]?.port,
              // Anchored (id-prefixed) iff an explicit `id` was passed or `ADMIN_SERVER_ID` is
              // set — there is no auto-generated anchored id otherwise.
              // `ADMIN_SERVER_ID_PREVIOUS`/an explicit `previousId`, if set, keeps the old prefix
              // reachable alongside the new one for a manual rotation window — see
              // `resolvePreviousApplicationServerId`. `previousId` is never passed for `graphql`
              // regardless of source: `compileRuntime` rejects it for that type outright (rotating
              // it would compile an empty stub schema — see `RuntimeActivation.previousId`'s own
              // doc).
              id,
              previousId,
              // Unanchored (no `id`), this server would otherwise fall back to
              // `bootstrapServers`'s own generic per-type default (`'api'`/`'graphql'`/`'socket'`)
              // — the SAME default the main server (above, sharing the same port by default)
              // uses. Without an `id` from either source, sharing a port would then silently
              // collide: the second `create()` call's handler would clobber the first's at the
              // same dispatch key. Giving this server its own distinct default prefix keeps that
              // combination safe even without opting into anchoring — only applied when
              // unanchored; an anchored server's own id already avoids the collision, and an
              // explicit `admin.<type>.globalPrefix` (if any) always wins regardless.
              globalPrefix: rest.globalPrefix ??
                (id ? undefined : `admin-${type}`),
            }
          }

          // Not the last `bootstrapServers` call of this boot sequence, so it must not purge the
          // metadata (pending GraphQL resolvers, the route registry) the local/public call below
          // still needs to read. See `@zanix/server`'s `bootstrapServers` doc comment.
          const internalServers = await bootstrapAppServer(
            ADMIN_APPLICATION,
            adminServers,
            false,
          )

          allServers.push(...internalServers)

          // Serves each local admin sub-app's own auto-registered `/__zanix-ops/<name>/...`
          // operations-dispatch route (see `@zanix/app`'s `registerRemoteDispatchRoutes`) — without
          // this, a sub-app's `operations` would be reachable via same-process `ctx.remote()`
          // (zero-network) but NOT over real HTTP from another process.
          //
          // Deliberately does NOT reuse `adminServers.rest`'s own `id`/`globalPrefix`/`onCreate` —
          // `WebServerManager`'s per-port dispatch table is keyed by `dispatchKey` (the anchored
          // `serverID` when anchored, the raw `globalPrefix` otherwise — see `compileRuntime`'s own
          // doc), never derived from the Application name itself. Two Applications sharing the
          // exact same `id`/`globalPrefix` don't merge their routes under that key — the LATER
          // `create()` call's handler (bound to ONE Application) silently replaces the earlier
          // one's, clobbering it entirely (a real bug this fixes: it previously made
          // `ADMIN_APPLICATION`'s own `/admin/triggers`/`/admin/templates`/`/admin/service-token`
          // controllers unreachable whenever a sub-app shared its dispatch key). Each sub-app
          // instead resolves its OWN independent `id` (`resolveApplicationServerId(subAppName,
          // 'rest')`, almost always unset in practice) and falls back to its OWN name as
          // `globalPrefix` when unanchored — a distinct dispatch key from the embedded admin
          // server's and from every other sub-app's, safe to share the same port regardless of how
          // `admin` itself is configured. `onCreate` is deliberately not forwarded either — it's
          // the caller's own hook for the embedded admin server's identity specifically (e.g.
          // capturing its id for a later `webServerManager.info()` call), not something a sub-app
          // should also invoke. Never the last bootstrap call either — same reasoning as above.
          for (const { definition } of localAdminSubApps) {
            const subId = resolveApplicationServerId(definition.name, 'rest')
            const { onCreate: _onCreate, ...restConfig } = adminServers.rest ??
              {}
            // deno-lint-ignore no-await-in-loop
            const subAppServers = await bootstrapAppServer(definition.name, {
              health: adminServers.health,
              rest: {
                ...restConfig,
                id: subId,
                previousId: resolvePreviousApplicationServerId(
                  definition.name,
                  'rest',
                ),
                globalPrefix: subId ? undefined : definition.name,
              },
            }, false)
            allServers.push(...subAppServers)
          }
        }

        for (const [name, { server }] of zanixApps) {
          // Same helper `ZanixAppDefinition.serve()` (`@zanix/app`'s own dev-loop convenience)
          // calls for itself — never a second, parallel implementation of "per-type
          // `bootstrapServers({application: name})`, skip entirely if `server` is absent".
          // deno-lint-ignore no-await-in-loop
          const internalServers = await bootstrapAppServer(name, server, false)

          allServers.push(...internalServers)
        }
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

    // Docker's (and most orchestrators') default stop signal is SIGTERM; Deno's default behavior
    // on an untrapped SIGTERM is immediate termination — in-flight requests get dropped instead of
    // drained via `Deno.serve()`'s own built-in `.shutdown()` (which `webServerManager.stop()`
    // already calls correctly once triggered). Mirrors `worker.ts`'s own `startWorker()` precedent
    // — same two signals, a fresh closure per call — except `stop()` itself removes the listeners
    // (see `signalShutdown`'s own doc) rather than this closure removing itself, since `stop()` is
    // also called directly by app code/tests, not just from here.
    signalShutdown = async () => {
      logger.info(
        'Shutdown signal received, stopping Zanix servers...',
        'noSave',
      )
      try {
        await stop()
        Deno.exit(0)
      } catch (error) {
        // `attachGlobalErrorHandlers` (already attached via `@zanix/server`'s own webserver
        // module) only logs unhandled rejections, it never exits — a signal-triggered shutdown
        // must still terminate the process even if `stop()` itself rejects (e.g. an `onStop` hook
        // threw), so this can't just let the error propagate uncaught. Exit code 1 (vs. the clean
        // path's 0) signals an unclean shutdown to the orchestrator's own restart/alerting policy
        // — the servers are still fully torn down regardless, guaranteed by `stop()`'s own nested
        // `try/finally`, only the exit code differs.
        logger.error(
          'Zanix.stop() failed during signal-triggered shutdown',
          error,
        )
        Deno.exit(1)
      }
    }
    Deno.addSignalListener('SIGINT', signalShutdown)
    Deno.addSignalListener('SIGTERM', signalShutdown)
  } finally {
    lifecycleGuard.clearStarting()
  }
}

/**
 * Function to stop all servers
 *
 * Also called automatically on `SIGINT`/`SIGTERM` (see `start()`'s own doc) — the very first
 * thing this does is remove those signal listeners, if `start()` registered any, so a second
 * signal (or a second, direct `stop()` call) never re-triggers this teardown.
 *
 * If `apps` declared at least one Zanix App, its `onStop` hooks (and, after those settle, its
 * resources' own `close()`) run BEFORE the servers themselves stop — same ordering
 * `deactivateApps`'s own doc already guarantees, applied here at the whole-process level. Servers
 * still stop even if `deactivateApps` rejects (one or more `onStop` handlers failed) — that
 * failure propagates to this call's own rejection, but never prevents shutdown from completing.
 * Only ever runs ONCE per `start()` call, regardless of how many times `stop()` itself is called
 * afterward (directly, or via a signal) — neither `deactivateApps` nor a resource's own `close()`
 * is safe to invoke twice, so a repeat `stop()` call skips this stage entirely (see
 * `activatedApps`'s own doc).
 * Core DB/cache connector connections (`closeAllConnections()`) close last, only after the HTTP
 * servers themselves have finished draining in-flight requests — closing them earlier could fail a
 * request still being served. Same accepted trade-off as the rest of this function: a later
 * stage's own error can mask an earlier one, but no stage's failure ever skips a later one.
 */
export const stop: () => Promise<void> = async () => {
  if (signalShutdown) {
    Deno.removeSignalListener('SIGINT', signalShutdown)
    Deno.removeSignalListener('SIGTERM', signalShutdown)
    signalShutdown = undefined
  }

  lifecycleGuard.markStopped()
  try {
    if (activatedApps) {
      // Cleared BEFORE `deactivateApps` runs, same reasoning as `signalShutdown` above — so a
      // second `stop()` call (sequential, or racing this one) sees `undefined` immediately and
      // skips this stage entirely, rather than re-running every app's own `onStop` hook and
      // re-`close()`ing every resource a second time. Neither `deactivateApps` nor
      // `ResourceRegistry.close()` (in `@zanix/app`) is idempotent on its own — a second call
      // unconditionally re-runs both, and a resource's own `close()` isn't guaranteed safe to call
      // twice. Cleared regardless of whether the call below succeeds or rejects: like every other
      // stage here, `deactivateApps` is fire-once, not retried by a later `stop()` call.
      const apps = activatedApps
      activatedApps = undefined
      await deactivateApps(apps)
    }
  } finally {
    try {
      await webServerManager.stop(allServers)
    } finally {
      await closeAllConnections()
    }
  }
}
