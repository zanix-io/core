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
    'admin triggers API: registered on the admin Application via Zanix.bootstrap(), rejects unauthenticated',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    // There is no auto-generated anchored id anymore — set one explicitly so the admin server is
    // reachable at a known address.
    Deno.env.set('ADMIN_SERVER_ID', 'admin-apis-test')

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

    const adminServerId = 'admin-apis-test-rest'

    const adminInfo = webServerManager.info(adminServerId as never)
    const adminAddr = adminInfo.addr
    assert(adminAddr, 'the admin rest server should be listening')

    // A non-default Application's server is assigned its own UUID as global prefix (see
    // `WebServerManager.create`), so its routes live under `/{serverId}/...`, not at the root.
    const baseUrl = `http://${adminAddr.hostname}:${adminAddr.port}/${adminServerId}`

    // Proves `defineAdminMetadata()` actually registered the route (auth-gated, reachable, not a
    // 404) — not just that the import didn't throw. The deep auth-behavior checks (the `api`-type
    // token path, a garbage-token 403, a valid request's 200) are covered by `@zanix/admin`'s own
    // tests, the actual owner of `createTriggersAdminController` — see its
    // `local-triggers.handler.test.ts` (unit) and `triggers-admin-api.test.ts` (functional).
    const unauthenticated = await fetch(`${baseUrl}/admin/triggers/list`)
    assertEquals(unauthenticated.status, 401)
    await unauthenticated.body?.cancel()

    // Not registered on the default-Application server at all — confirms Application isolation.
    const publicChecks = publicServers
      .map((id) => webServerManager.info(id as never))
      .filter((info) => info.type === 'rest')
      .map(async (info) => {
        const publicUrl = `http://${info.addr?.hostname}:${info.addr?.port}`
        const res = await fetch(`${publicUrl}/admin/triggers/list`)
        assertEquals(res.status, 404)
        await res.body?.cancel()
      })
    await Promise.all(publicChecks)

    Deno.env.delete('ADMIN_SERVER_ID')
    Zanix.stop()
  },
})
