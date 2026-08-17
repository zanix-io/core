import { assertSpyCalls, stub } from '@std/testing/mock'
import { assert } from '@std/assert'
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

    // Includes the admin server's own triggers-admin, triggers-discovery, and service-exchange
    // routes (templates-admin isn't registered here — TEMPLATES_MODEL_NAME/DATABASE_TEMPLATES
    // aren't set in this test), plus the two local admin sub-apps' own operations-dispatch routes
    // and servers (`getLocalAdminSubApps()` — `admin-triggers`/`admin-templates`, always activated
    // alongside `defineLocalAdminApp` regardless of REST config — see `local-admin-app.ts`'s own
    // doc): 2 routes + 1 "server is running" line each, +6 over the pre-sub-app baseline of 16.
    assertSpyCalls(consoleSuccess, 22)
    assert(
      consoleSuccess.calls.some((call) => call.args[1].includes('MongoDB Connected Successfully')),
    )
    assert(
      consoleSuccess.calls.some((call) => call.args[1].includes('Redis Connected Successfully')),
    )

    Zanix.stop()
  },
})

Deno.test('clear mocks', () => {
  consoleSuccess.restore()
})
