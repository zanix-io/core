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
    'admin.rest.globalPrefix is additive: /admin/triggers moves to /{id}/{globalPrefix}/admin/triggers, not both',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    // There is no auto-generated anchored id anymore — set one explicitly so the admin server is
    // reachable at a known address.
    Deno.env.set('ADMIN_SERVER_ID', 'admin-globalprefix-test')

    await Zanix.bootstrap({
      admin: { rest: { globalPrefix: 'ops' } },
    })

    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    const adminServerId = 'admin-globalprefix-test-rest'

    const adminAddr = webServerManager.info(adminServerId as never).addr
    assert(adminAddr, 'the admin rest server should be listening')

    const baseUrl = `http://${adminAddr.hostname}:${adminAddr.port}/${adminServerId}`

    // Additive: the configured globalPrefix segment is required for the route to resolve.
    const combined = await fetch(`${baseUrl}/ops/admin/triggers/list`)
    assertEquals(combined.status, 401) // auth-gated, but reachable — not a 404
    await combined.body?.cancel()

    // The bare (no globalPrefix) path from before this option existed no longer matches.
    const bare = await fetch(`${baseUrl}/admin/triggers/list`)
    assertEquals(bare.status, 404)
    await bare.body?.cancel()

    Deno.env.delete('ADMIN_SERVER_ID')
    Zanix.stop()
  },
})
