import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'start({codeTemplatesDiscovery: true, admin: true}): registers /.well-known/zanix/code-templates under the admin server, guarded by default',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    let adminServerId: string | undefined
    try {
      await Zanix.bootstrap({
        admin: { rest: { onCreate: (id: string) => (adminServerId = id) } },
        codeTemplatesDiscovery: true,
      })
      await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

      assert(adminServerId, 'the admin rest server should have started')
      const info = webServerManager.info(adminServerId as never)
      assert(info.addr, 'the admin rest server should be reachable')
      // Unanchored (no ADMIN_SERVER_ID/explicit id), the admin REST server's own distinct default
      // globalPrefix (`admin-rest`) applies — see `start-admin-and-server-combined.test.ts`.
      const response = await fetch(
        `http://${info.addr.hostname}:${info.addr.port}/admin-rest/.well-known/zanix/code-templates`,
      )
      // Default guard (ADMIN_ROLE/ADMIN_TEMPLATES_ROLE) rejects an unauthenticated request — this
      // alone already proves the route exists and IS guarded (a missing route would 404, not 401).
      assertEquals(response.status, 401)
      await response.body?.cancel()

      await Zanix.stop()
    } finally {
      Deno.env.delete('MONGO_URI')
      Deno.env.delete('REDIS_URI')
    }
  },
})
