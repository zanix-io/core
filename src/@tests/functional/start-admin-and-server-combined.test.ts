import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')

/**
 * Covers the literal Objective 1 use case: `admin` and `server.rest.globalPrefix` configured
 * together in a single `Zanix.start()` call — both must work simultaneously, on their own ports,
 * with the main app's own route reachable under its custom prefix and the admin server reachable
 * on its own configured port.
 */
Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'start(): admin: { rest: { port } } and server: { rest: { globalPrefix } } both work together in one call',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const MAIN_PORT = 4701
    const ADMIN_PORT = 4702
    let mainServerId: string | undefined
    let adminServerId: string | undefined

    await Zanix.bootstrap({
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
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    assert(mainServerId, 'the main REST server should have been created')
    const mainAddr = webServerManager.info(mainServerId as never).addr
    assert(mainAddr, 'the main REST server should be listening')
    assertEquals(mainAddr.port, MAIN_PORT)

    // The main app's own route, reachable under the explicit `globalPrefix` instead of the
    // generic `/api` default.
    const welcome = await fetch(
      `http://${mainAddr.hostname}:${mainAddr.port}/auth/welcome`,
    )
    assertEquals(welcome.status, 200)
    await welcome.body?.cancel()

    // The admin server got its own, separate listener — not sharing the main server's port.
    assert(adminServerId, 'the admin REST server should have been created')
    const adminAddr = webServerManager.info(adminServerId as never).addr
    assert(adminAddr, 'the admin rest server should be listening')
    assertEquals(adminAddr.port, ADMIN_PORT)
    assertNotEquals(adminAddr.port, mainAddr.port)

    // The admin service-token route exists (reachable, not a 404) — proves `defineAdminMetadata()`
    // actually ran and the admin server actually serves it. Unanchored (no `ADMIN_SERVER_ID`/
    // explicit `id`), the admin REST server's own distinct default `globalPrefix` (`admin-rest`)
    // applies — see `start.ts`'s own doc on why, and `docs/admin-apis.md`'s "Ports and
    // single-port platforms" section.
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

    Zanix.stop()
  },
})
