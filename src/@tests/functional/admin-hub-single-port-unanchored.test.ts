import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix, { ZanixAdminHub } from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')
stub(console, 'error')

/**
 * Same single-port scenario as `admin-hub-single-port.test.ts`, but with zero anchoring config
 * (`ADMIN_SERVER_ID`/`ADMIN_HUB_SERVER_ID` both unset) — the true zero-extra-config Heroku case,
 * where sharing one port with no collision relies entirely on each unanchored sub-server's own
 * distinct default `globalPrefix` (`admin-rest`, `admin-hub`) — see `docs/admin-apis.md`'s "Ports
 * and single-port platforms" section. Kept in its own file, not a second test in
 * `admin-hub-single-port.test.ts` — see that file's own doc for why.
 */
Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'Zanix.start({admin:true, server}) and ZanixAdminHub.start() share one port with zero anchoring config (each gets its own default prefix)',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const SHARED_PORT = 4812
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
        `http://${adminAddr.hostname}:${adminAddr.port}/admin-rest/admin/service-token`,
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
        `http://${hubAddr.hostname}:${hubAddr.port}/admin-hub/triggers/list`,
      )
      assertEquals(triggers.status, 401) // unauthenticated, but the route exists (not a 404)
      await triggers.body?.cancel()
    } finally {
      await ZanixAdminHub.stop()
      await Zanix.stop()
    }
  },
})
