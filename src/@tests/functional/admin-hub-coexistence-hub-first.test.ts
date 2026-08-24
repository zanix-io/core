import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix, { ZanixAdminHub } from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')
stub(console, 'error')

/**
 * The reversed-order counterpart of `admin-hub-coexistence.test.ts`'s "core first" case — the
 * reported bug was order-dependent (whichever sequence's own `finalize: true` call happened to run
 * first "won"), so both orders need coverage. Kept in its OWN file rather than a second test
 * alongside "core first": both call `Zanix.bootstrap({ server: {...} })` against the same default
 * `rootDir`, and a second `defineLocalMetadata()` scan in the SAME process would `import()` the
 * exact same fixture specifier a second time — a no-op under Deno's module cache, so the second
 * call's own routes would never actually re-register. Separate files get separate module graphs.
 */
Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'ZanixAdminHub.start() and Zanix.start({admin:true, server}) fired without an await between them both serve all their routes (hub first)',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const MAIN_PORT = 4714
    const ADMIN_PORT = 4715
    const HUB_PORT = 4716
    let mainServerId: string | undefined
    let adminServerId: string | undefined
    let hubServerId: string | undefined

    // Reversed call order from `admin-hub-coexistence.test.ts` — the reported bug was
    // order-dependent (whichever sequence's own `finalize: true` call happened to run first
    // "won"), so both orders need coverage.
    const hubPromise = ZanixAdminHub.start({
      rest: { port: HUB_PORT, onCreate: (id) => (hubServerId = id) },
    })
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

    await Promise.all([hubPromise, corePromise])
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    try {
      assert(mainServerId, 'the main REST server should have been created')
      const mainAddr = webServerManager.info(mainServerId as never).addr
      assert(mainAddr, 'the main REST server should be listening')
      assertEquals(mainAddr.port, MAIN_PORT)
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
      assertEquals(serviceToken.status, 400)
      await serviceToken.body?.cancel()

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
      assertNotEquals(triggers.status, 404)
      await triggers.body?.cancel()
    } finally {
      await ZanixAdminHub.stop()
      await Zanix.stop()
    }
  },
})
