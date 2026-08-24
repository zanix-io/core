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
    'start({codeTemplatesDiscovery: {guards: []}}): an explicit empty guards array deliberately serves it unauthenticated',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    let mainServerId: string | undefined
    try {
      await Zanix.bootstrap({
        codeTemplatesDiscovery: { guards: [] },
        server: {
          rest: { onCreate: (id: string) => (mainServerId = id) },
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 1000))

      assert(mainServerId, 'the main rest server should have started')
      const info = webServerManager.info(mainServerId as never)
      assert(info.addr, 'the main rest server should be reachable')
      // Unanchored, no explicit globalPrefix — the main server's own generic `/api` default
      // applies (`opts.globalPrefix || (explicitId ? undefined : 'api')` — falsy-or, so even an
      // explicit empty string wouldn't opt out of it; see `@zanix/server`'s `webserver/mod.ts`).
      const response = await fetch(
        `http://${info.addr.hostname}:${info.addr.port}/api/.well-known/zanix/code-templates`,
      )
      assertEquals(response.status, 200)
      const body = await response.json()
      assertEquals(body.resourceType, 'code-templates')
      assert(Array.isArray(body.items) && body.items.length > 0)

      await Zanix.stop()
    } finally {
      Deno.env.delete('MONGO_URI')
      Deno.env.delete('REDIS_URI')
    }
  },
})
