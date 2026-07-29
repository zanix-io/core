import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix from '../../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'service-exchange API: registered internal-only, 404s on every public server',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const publicServers: string[] = []

    await Zanix.bootstrap({
      server: {
        rest: { onCreate: (id) => publicServers.push(id) },
        graphql: { onCreate: (id) => publicServers.push(id) },
        socket: { onCreate: (id) => publicServers.push(id) },
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    const adminServerId = Deno.env.get('ADMIN_REST_SERVER_ID')
    assert(adminServerId, 'ADMIN_REST_SERVER_ID should have been set by the admin bootstrap')

    const adminAddr = webServerManager.info(adminServerId as never).addr
    assert(adminAddr, 'the admin rest server should be listening')

    const baseUrl = `http://${adminAddr.hostname}:${adminAddr.port}/${adminServerId}`
    const exchangeUrl = `${baseUrl}/admin/service-token`

    // Reachable on the internal server — proves `@zanix/core`'s bootstrap wires it at all. The
    // deep exchange-logic behavior (garbage rejection, a valid assertion minting a real
    // credential, the protocol header) is covered by `@zanix/admin`'s own tests, the actual owner
    // of `createServiceExchangeController` — see its `service-exchange.handler.test.ts` (unit) and
    // `service-exchange.test.ts` (functional).
    const reachable = await fetch(exchangeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assertion: 'x' }),
    })
    assertEquals(reachable.status, 400) // garbage assertion, but not a 404 — the route exists
    await reachable.body?.cancel()

    // Not registered on any public server at all — confirms isInternal isolation.
    const publicChecks = publicServers
      .map((id) => webServerManager.info(id as never))
      .filter((info) => info.type === 'rest')
      .map(async (info) => {
        const res = await fetch(
          `http://${info.addr?.hostname}:${info.addr?.port}/admin/service-token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assertion: 'x' }),
          },
        )
        assertEquals(res.status, 404)
        await res.body?.cancel()
      })
    await Promise.all(publicChecks)

    Zanix.stop()
  },
})
