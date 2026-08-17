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
    "ADMIN_TRIGGERS_APPLICATION=main mounts /admin/triggers on the default Application's server instead",
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    Deno.env.set('ADMIN_TRIGGERS_APPLICATION', 'main')
    // There is no auto-generated anchored id anymore — set one explicitly so the admin server (still
    // created for the always-registered service-exchange route) is reachable at a known address.
    Deno.env.set('ADMIN_SERVER_ID', 'triggers-override-test')

    const defaultServers: string[] = []
    await Zanix.bootstrap({
      admin: true,
      server: {
        rest: { onCreate: (id) => defaultServers.push(id) },
        graphql: { onCreate: (id) => defaultServers.push(id) },
        socket: { onCreate: (id) => defaultServers.push(id) },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    // No longer composed under the 'admin' Application, so the built-in admin server never mounts it.
    const adminServerId = 'triggers-override-test-rest'
    const adminAddr = webServerManager.info(adminServerId as never).addr
    if (adminAddr) {
      const res = await fetch(
        `http://${adminAddr.hostname}:${adminAddr.port}/${adminServerId}/admin/triggers/list`,
      )
      assertEquals(res.status, 404)
      await res.body?.cancel()
    }

    // Reachable (auth-gated, not 404) on the default Application's REST server instead.
    const restServers = defaultServers
      .map((id) => webServerManager.info(id as never))
      .filter((info) => info.type === 'rest')
    assert(
      restServers.length > 0,
      "a default Application's REST server should have started",
    )

    // Default `globalPrefix` for an unanchored REST server with no explicit options is `api`.
    await Promise.all(restServers.map(async (info) => {
      const res = await fetch(
        `http://${info.addr?.hostname}:${info.addr?.port}/api/admin/triggers/list`,
      )
      assertEquals(res.status, 401)
      await res.body?.cancel()
    }))

    Deno.env.delete('ADMIN_TRIGGERS_APPLICATION')
    Deno.env.delete('ADMIN_SERVER_ID')
    Zanix.stop()
  },
})
