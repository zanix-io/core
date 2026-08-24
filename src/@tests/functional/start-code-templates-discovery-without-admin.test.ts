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
    "start({codeTemplatesDiscovery: true}) without admin: registers it under the default Application's own server instead (admin has no server backing it at all)",
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    let mainServerId: string | undefined
    try {
      await Zanix.bootstrap({
        codeTemplatesDiscovery: true,
        server: { rest: { onCreate: (id: string) => (mainServerId = id) } },
      })
      await new Promise((resolve) => setTimeout(resolve, 1000))

      assert(mainServerId, 'the main rest server should have started')
      const info = webServerManager.info(mainServerId as never)
      assert(info.addr, 'the main rest server should be reachable')
      // Unanchored, no explicit globalPrefix — the main server's own generic `/api` default
      // applies (see `start-admin-and-server-combined.test.ts`'s own comment on this).
      const response = await fetch(
        `http://${info.addr.hostname}:${info.addr.port}/api/.well-known/zanix/code-templates`,
      )
      assertEquals(response.status, 401)
      await response.body?.cancel()

      await Zanix.stop()
    } finally {
      Deno.env.delete('MONGO_URI')
      Deno.env.delete('REDIS_URI')
    }
  },
})
