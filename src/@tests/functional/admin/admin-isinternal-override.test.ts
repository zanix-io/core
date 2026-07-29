import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix from '../../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'ADMIN_TRIGGERS_ISINTERNAL=false mounts /admin/triggers on the public server instead',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    Deno.env.set('ADMIN_TRIGGERS_ISINTERNAL', 'false')

    const publicServers: string[] = []
    await Zanix.bootstrap({
      server: {
        rest: { onCreate: (id) => publicServers.push(id) },
        graphql: { onCreate: (id) => publicServers.push(id) },
        socket: { onCreate: (id) => publicServers.push(id) },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    // No longer isInternal, so the built-in internal admin server never mounts it.
    const adminServerId = Deno.env.get('ADMIN_REST_SERVER_ID')
    if (adminServerId) {
      const adminAddr = webServerManager.info(adminServerId as never).addr
      if (adminAddr) {
        const res = await fetch(
          `http://${adminAddr.hostname}:${adminAddr.port}/${adminServerId}/admin/triggers/list`,
        )
        assertEquals(res.status, 404)
        await res.body?.cancel()
      }
    }

    // Reachable (auth-gated, not 404) on the public REST server instead.
    const restServers = publicServers
      .map((id) => webServerManager.info(id as never))
      .filter((info) => info.type === 'rest')
    assert(restServers.length > 0, 'a public REST server should have started')

    // Default `globalPrefix` for a REST server bootstrapped with no explicit options is `api`.
    await Promise.all(restServers.map(async (info) => {
      const res = await fetch(
        `http://${info.addr?.hostname}:${info.addr?.port}/api/admin/triggers/list`,
      )
      assertEquals(res.status, 401)
      await res.body?.cancel()
    }))

    Deno.env.delete('ADMIN_TRIGGERS_ISINTERNAL')
    Zanix.stop()
  },
})
