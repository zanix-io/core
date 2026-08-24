import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix from '../../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'service-exchange API: registered on the admin Application only, 404s on every default-Application server',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    // There is no auto-generated anchored id anymore — the admin server is anchored (and thus
    // reachable at a known address) iff `ADMIN_SERVER_ID` is explicitly set.
    Deno.env.set('ADMIN_SERVER_ID', 'service-exchange-api-test')

    const publicServers: string[] = []

    await Zanix.bootstrap({
      admin: true,
      server: {
        rest: { onCreate: (id) => publicServers.push(id) },
        graphql: { onCreate: (id) => publicServers.push(id) },
        socket: { onCreate: (id) => publicServers.push(id) },
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    const adminServerId = 'service-exchange-api-test-rest'
    const adminAddr = webServerManager.info(adminServerId as never).addr
    assert(adminAddr, 'the admin rest server should be listening')

    const baseUrl = `http://${adminAddr.hostname}:${adminAddr.port}/${adminServerId}`
    const exchangeUrl = `${baseUrl}/admin/service-token`

    // Reachable on the admin Application's anchored server — proves `@zanix/core`'s bootstrap wires it at all. The
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

    // Not registered on any default-Application server at all — confirms Application isolation.
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

    Deno.env.delete('ADMIN_SERVER_ID')
    await Zanix.stop()
  },
})
