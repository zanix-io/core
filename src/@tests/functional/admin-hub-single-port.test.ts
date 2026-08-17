import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix, { ZanixAdminHub } from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')
stub(console, 'error')

/**
 * Single-port-platform regression (Heroku, Render, Railway, ...): the main app, the embedded local
 * admin (`admin: true`), and `ZanixAdminHub.start()`'s own central aggregator ALL sharing the exact
 * same port in one process — the real constraint those platforms impose (one exposed port per
 * dyno/process), as opposed to `admin-hub-coexistence.test.ts`'s three-distinct-ports scenario.
 *
 * Relies on nothing beyond what `docs/admin-apis.md`'s "Ports and single-port platforms" section
 * already documents: `admin.rest` with no explicit port reuses `server.rest`'s port, and each
 * server anchored via a distinct id gets its own stable prefix — this test is the first to actually
 * exercise all three sharing ONE port at once, rather than each documented mechanism in isolation.
 * The zero-config (unanchored) variant is covered separately
 * (`admin-hub-single-port-unanchored.test.ts`) — kept in its own FILE for the same reason
 * `admin-hub-coexistence-hub-first.test.ts` is: both tests call `Zanix.bootstrap({server:{...}})`
 * against the same default `rootDir`, and a second `defineLocalMetadata()` scan in the SAME process
 * would `import()` the exact same fixture specifier a second time — a no-op under Deno's module
 * cache, so the second call's own routes would never actually re-register.
 */
Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'Zanix.start({admin:true, server}) and ZanixAdminHub.start() can all share exactly one port (Heroku-style single-port deployment)',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    Deno.env.set('ADMIN_SERVER_ID', 'sp-admin')
    Deno.env.set('ADMIN_HUB_SERVER_ID', 'sp-hub')

    const SHARED_PORT = 4811
    let mainServerId: string | undefined
    let adminServerId: string | undefined
    let hubServerId: string | undefined

    await Zanix.bootstrap({
      admin: {
        rest: { port: SHARED_PORT, onCreate: (id) => (adminServerId = id) },
      },
      server: {
        rest: {
          port: SHARED_PORT,
          globalPrefix: 'auth',
          onCreate: (id) => (mainServerId = id),
        },
      },
    })
    await ZanixAdminHub.start({
      rest: { port: SHARED_PORT, onCreate: (id) => (hubServerId = id) },
    })
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    try {
      assert(mainServerId, 'the main REST server should have been created')
      const mainAddr = webServerManager.info(mainServerId as never).addr
      assert(mainAddr, 'the main REST server should be listening')
      assertEquals(mainAddr.port, SHARED_PORT)
      const welcome = await fetch(
        `http://${mainAddr.hostname}:${mainAddr.port}/auth/welcome`,
      )
      assertEquals(welcome.status, 200)
      await welcome.body?.cancel()

      assert(
        adminServerId,
        'the embedded admin REST server should have been created',
      )
      const adminAddr = webServerManager.info(adminServerId as never).addr
      assert(adminAddr, 'the embedded admin REST server should be listening')
      assertEquals(adminAddr.port, SHARED_PORT)
      const serviceToken = await fetch(
        `http://${adminAddr.hostname}:${adminAddr.port}/sp-admin-rest/admin/service-token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assertion: 'x' }),
        },
      )
      assertEquals(serviceToken.status, 400) // garbage assertion, but not a 404 — the route exists
      await serviceToken.body?.cancel()

      assert(
        hubServerId,
        'the ZanixAdminHub REST server should have been created',
      )
      const hubAddr = webServerManager.info(hubServerId as never).addr
      assert(hubAddr, 'the ZanixAdminHub REST server should be listening')
      assertEquals(hubAddr.port, SHARED_PORT)
      const triggers = await fetch(
        `http://${hubAddr.hostname}:${hubAddr.port}/sp-hub-rest/triggers/list`,
      )
      assertEquals(triggers.status, 401) // unauthenticated, but the route exists (not a 404)
      await triggers.body?.cancel()
    } finally {
      await ZanixAdminHub.stop()
      Zanix.stop()
      Deno.env.delete('ADMIN_SERVER_ID')
      Deno.env.delete('ADMIN_HUB_SERVER_ID')
    }
  },
})
