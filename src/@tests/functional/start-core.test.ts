import { assertSpyCalls, stub } from '@std/testing/mock'
import { assert } from '@std/assert'
import { isDlqResourceEnabled, isTriggersResourceEnabled } from '@zanix/database'
import { isTemplatesResourceEnabled } from '@zanix/notifications'
import { getLocalAdminSubApps } from '@zanix/admin'
import Zanix from '../../../mod.ts'

/** mocks */
const consoleSuccess = stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'Start module should init servers with core modules',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    // `health: false` on both `admin` and `server` — unrelated to this test's own concern (core
    // modules bootstrapping); left on, its own route logs (2 per port — 3 unshared admin ports
    // plus whatever the auto-discovered main app resolves to, since no `server` config was given
    // before) would inflate the exact count below for a reason orthogonal to what this test
    // actually checks. `server: { health: false }` alone (no type named) still auto-discovers
    // everything else, same as omitting `server` entirely — see `bootstrapServers`'s own doc.
    await Zanix.bootstrap({
      admin: { health: false },
      server: { health: false },
    })

    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait until mongo core connection

    // Computed instead of hardcoded — a fixed magic number silently goes stale the moment
    // `@zanix/admin` changes which of triggers/templates/dlq registers by default (already
    // happened once: adding the `admin-dlq` local sub-app broke a hardcoded `22`). Each term below
    // mirrors the exact condition `@zanix/admin`'s own `defineAdminMetadata()` checks, so this stays
    // correct however triggers/templates/dlq's own defaults evolve — including triggers ever
    // becoming opt-in like templates/dlq already are, not just the reverse.
    const CORE_CONNECT_LINES = 2 // "MongoDB Connected Successfully" + "Redis Connected Successfully"
    // The auto-discovered main app: 1 route line each for rest/socket/graphql + 1 "server is
    // running" line each — independent of admin/triggers/templates/dlq state entirely.
    const MAIN_APP_LINES = 6
    // `/admin/service-token` (service-credential exchange) — the only admin route always composed
    // under `ADMIN_APPLICATION`, regardless of triggers/templates/dlq — see `defineAdminMetadata`'s
    // own doc.
    const ADMIN_SERVICE_EXCHANGE_ROUTES = 1
    // The shared `ADMIN_APPLICATION` rest server's own "is running" line — logged once the moment
    // `admin: true` is set, even with every resource-specific controller below turned off (the
    // service-exchange controller alone is enough to start it).
    const ADMIN_SERVER_RUNNING_LINES = 1
    // `createTriggersAdminController` (list/get/create/update/delete = 5) + its Discovery endpoint.
    const TRIGGERS_REST_LINES = 6
    // `createTemplatesController` (list/get/create/update/delete = 5) + this package's own
    // `createTemplatesSyncController` (sync = 1) + Discovery.
    const TEMPLATES_REST_LINES = 7
    // `createDlqAdminController` (list/get/push/requeue/discard/remove = 6) + its Discovery endpoint.
    const DLQ_REST_LINES = 7
    // `admin-triggers`/`admin-templates`/`admin-dlq` — the local sub-apps' own operations-dispatch
    // routes and servers (`getLocalAdminSubApps()`). Gated by the SAME triggers/templates/dlq
    // conditions as their REST controllers above (`isTriggersResourceEnabled()`/
    // `isTemplatesResourceEnabled('local')`/`isDlqResourceEnabled()`, mirrored via `@zanix/admin`'s
    // own `admin-resource-gates.ts`) — a resource's sub-app composes if and only if its REST
    // controller does; see `local-admin-app.ts`'s own doc. 2 routes + 1 "server is running" line
    // each. Read at assertion time (not hardcoded as `* 3`) so this count tracks BOTH a future
    // 4th/5th sub-app AND whichever of triggers/templates/dlq are actually enabled by this test's
    // own env, rather than assuming every sub-app always contributes to it regardless of
    // configuration.
    const LOCAL_SUB_APP_LINES = getLocalAdminSubApps().length * 3

    const adminRestRoutes = ADMIN_SERVICE_EXCHANGE_ROUTES +
      (isTriggersResourceEnabled() ? TRIGGERS_REST_LINES : 0) +
      (isTemplatesResourceEnabled('local') ? TEMPLATES_REST_LINES : 0) +
      (isDlqResourceEnabled() ? DLQ_REST_LINES : 0)

    assertSpyCalls(
      consoleSuccess,
      CORE_CONNECT_LINES + MAIN_APP_LINES + adminRestRoutes + ADMIN_SERVER_RUNNING_LINES +
        LOCAL_SUB_APP_LINES,
    )
    assert(
      consoleSuccess.calls.some((call) => call.args[1].includes('MongoDB Connected Successfully')),
    )
    assert(
      consoleSuccess.calls.some((call) => call.args[1].includes('Redis Connected Successfully')),
    )

    await Zanix.stop()
  },
})

Deno.test('clear mocks', () => {
  consoleSuccess.restore()
})
