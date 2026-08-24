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
    'start(): admin.rest with no explicit port reuses whatever port server.rest resolves to (shared listener)',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    // There is no auto-generated anchored id anymore — set one explicitly so the admin server is
    // reachable at a known address.
    Deno.env.set('ADMIN_SERVER_ID', 'admin-shared-port-test')

    const SHARED_PORT = 4501
    let publicServerId: string | undefined

    await Zanix.bootstrap({
      admin: true,
      server: {
        rest: { port: SHARED_PORT, onCreate: (id) => (publicServerId = id) },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    const adminServerId = 'admin-shared-port-test-rest'
    assert(publicServerId, 'the public REST server should have been created')

    const adminAddr = webServerManager.info(adminServerId as never).addr
    const publicAddr = webServerManager.info(publicServerId as never).addr

    assert(adminAddr, 'the admin rest server should be listening')
    assert(publicAddr, 'the public rest server should be listening')
    assertEquals(adminAddr.port, SHARED_PORT)
    assertEquals(
      adminAddr.port,
      publicAddr.port,
      'admin and public REST servers should share one physical listener',
    )

    Deno.env.delete('ADMIN_SERVER_ID')
    await Zanix.stop()
  },
})
