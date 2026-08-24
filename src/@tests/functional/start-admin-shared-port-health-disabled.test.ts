import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')

/**
 * Regression for a real bug (found running a real consumer app, `admin: true` + `server.health:
 * false`): `start.ts`'s own `adminServers` object never copied `server.health` — the embedded
 * admin server's own `bootstrapAppServer()` call always got `health: undefined` (enabled with
 * defaults), completely ignoring whatever `server.health` was set to. Since admin shares the main
 * server's port by default and boots FIRST in the sequence, its own (always-on) health claimed the
 * shared port before the main server's own `bootstrapServers()` call — with `health: false` — ever
 * ran, so `/health` stayed reachable regardless of the setting. Fixed by having `adminServers.health`
 * default to `server.health` (an explicit `admin.health` still wins — see the sibling test,
 * `start-admin-shared-port-health-override.test.ts`).
 */
Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'start(): server.health: false disables /health even with admin embedded and sharing the same port',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    Deno.env.set('ADMIN_SERVER_ID', 'admin-shared-health-disabled-test')

    const SHARED_PORT = 4502
    let publicServerId: string | undefined

    await Zanix.bootstrap({
      admin: true,
      server: {
        rest: { port: SHARED_PORT, onCreate: (id) => (publicServerId = id) },
        health: false,
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    try {
      assert(publicServerId, 'the public REST server should have been created')
      const addr = webServerManager.info(publicServerId).addr
      assert(addr, 'the public REST server should be listening')

      const health = await fetch(`http://${addr.hostname}:${addr.port}/health`)
      assertEquals(health.status, 404)
      await health.body?.cancel()

      const ready = await fetch(`http://${addr.hostname}:${addr.port}/ready`)
      assertEquals(ready.status, 404)
      await ready.body?.cancel()
    } finally {
      Deno.env.delete('ADMIN_SERVER_ID')
      await Zanix.stop()
    }
  },
})
