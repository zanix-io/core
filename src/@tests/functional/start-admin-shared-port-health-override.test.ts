import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')

/**
 * `admin.health`'s own explicit choice wins over `server.health` when both are given — same
 * "explicit option beats inherited default" precedence `port`/`id` already follow for admin. Own
 * file, same reason as `start-admin-shared-port-health-disabled.test.ts`'s own comment on this
 * point — sharing a file with another real `Zanix.bootstrap()`/`Zanix.stop()` cycle is flaky here
 * (`stop()` is fire-and-forget by convention in these tests, so its cleanup can still be in flight
 * when the next test's own `bootstrap()` starts).
 */
Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'start(): an explicit admin.health overrides server.health, even sharing the same port',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    Deno.env.set('ADMIN_SERVER_ID', 'admin-shared-health-override-test')

    const SHARED_PORT = 4503
    let publicServerId: string | undefined

    await Zanix.bootstrap({
      admin: { health: true },
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

      // Admin's own explicit `health: true` claimed the shared port first (admin boots before the
      // main server in `start()`'s own sequence) — reachable even though `server.health` said false.
      const health = await fetch(`http://${addr.hostname}:${addr.port}/health`)
      assertEquals(health.status, 200)
      await health.body?.cancel()
    } finally {
      Deno.env.delete('ADMIN_SERVER_ID')
      Zanix.stop()
    }
  },
})
