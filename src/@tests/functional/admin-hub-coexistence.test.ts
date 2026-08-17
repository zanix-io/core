import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix, { ZanixAdminHub } from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')
stub(console, 'error')

/**
 * Regression coverage for a real bug: `Zanix.start({ admin: true })`'s own embedded admin routes
 * and `ZanixAdminHub.start()`'s own aggregator routes used to corrupt each other's registration
 * when fired without a sequential `await` between them (whichever sequence's own `finalize: true`
 * call ran first would wipe the other's not-yet-served routes from the shared process-global
 * registry) — fixed by `@zanix/server`'s boot-session isolation (`BootSessionContainer`) plus
 * giving `ZanixAdminHub` its own distinct Application (`ADMIN_HUB_APPLICATION`, `'admin-hub'`,
 * separate from the embedded admin's `'admin'`). The reversed call order is covered separately
 * (`admin-hub-coexistence-hub-first.test.ts`) — kept in its own FILE rather than a second test in
 * this one: both tests call `Zanix.bootstrap({ server: {...} })` against the same default
 * `rootDir`, and a second `defineLocalMetadata()` scan in the SAME process would `import()` the
 * exact same fixture specifier a second time — a no-op under Deno's module cache, so the second
 * call's own routes would never actually re-register. Separate files get separate module graphs.
 */
Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'Zanix.start({admin:true, server}) and ZanixAdminHub.start() fired without an await between them both serve all their routes (core first)',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const MAIN_PORT = 4711
    const ADMIN_PORT = 4712
    const HUB_PORT = 4713
    let mainServerId: string | undefined
    let adminServerId: string | undefined
    let hubServerId: string | undefined

    // Deliberately NOT awaited between the two calls — mirrors the reported bug's exact repro:
    // both sequences register/boot concurrently, interleaved by the event loop.
    const corePromise = Zanix.bootstrap({
      admin: {
        rest: { port: ADMIN_PORT, onCreate: (id) => (adminServerId = id) },
      },
      server: {
        rest: {
          port: MAIN_PORT,
          globalPrefix: 'auth',
          onCreate: (id) => (mainServerId = id),
        },
      },
    })
    const hubPromise = ZanixAdminHub.start({
      rest: { port: HUB_PORT, onCreate: (id) => (hubServerId = id) },
    })

    await Promise.all([corePromise, hubPromise])
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    try {
      // The business server's own route — previously observed to vanish ("main server was not
      // started because no corresponding handlers were found") when interleaved with a concurrent
      // ZanixAdminHub boot.
      assert(mainServerId, 'the main REST server should have been created')
      const mainAddr = webServerManager.info(mainServerId as never).addr
      assert(mainAddr, 'the main REST server should be listening')
      assertEquals(mainAddr.port, MAIN_PORT)
      const welcome = await fetch(
        `http://${mainAddr.hostname}:${mainAddr.port}/auth/welcome`,
      )
      assertEquals(welcome.status, 200)
      await welcome.body?.cancel()

      // The embedded local admin's own route (`/admin/service-token`, always registered).
      assert(
        adminServerId,
        'the embedded admin REST server should have been created',
      )
      const adminAddr = webServerManager.info(adminServerId as never).addr
      assert(adminAddr, 'the embedded admin REST server should be listening')
      assertEquals(adminAddr.port, ADMIN_PORT)
      assertNotEquals(adminAddr.port, mainAddr.port)
      const serviceToken = await fetch(
        `http://${adminAddr.hostname}:${adminAddr.port}/admin-rest/admin/service-token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assertion: 'x' }),
        },
      )
      assertEquals(serviceToken.status, 400) // garbage assertion, but not a 404 — the route exists
      await serviceToken.body?.cancel()

      // ZanixAdminHub's own aggregator route — the route that was silently dropped in the
      // reported bug.
      assert(
        hubServerId,
        'the ZanixAdminHub REST server should have been created',
      )
      const hubAddr = webServerManager.info(hubServerId as never).addr
      assert(hubAddr, 'the ZanixAdminHub REST server should be listening')
      assertEquals(hubAddr.port, HUB_PORT)
      const triggers = await fetch(
        `http://${hubAddr.hostname}:${hubAddr.port}/admin-hub/triggers/list`,
      )
      assertNotEquals(triggers.status, 404) // unauthenticated (401), but the route exists
      await triggers.body?.cancel()
    } finally {
      await ZanixAdminHub.stop()
      Zanix.stop()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'Zanix.start() WITHOUT admin enabled does NOT block ZanixAdminHub.start() afterward — either side can be the one to expose admin',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    await Zanix.bootstrap()

    const adminServers = await ZanixAdminHub.start()
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    assert(
      adminServers.length,
      'ZanixAdminHub.start() should have started at least one server',
    )

    await ZanixAdminHub.stop()
    Zanix.stop()
  },
})
