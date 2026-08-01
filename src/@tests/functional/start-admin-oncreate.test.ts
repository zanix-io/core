import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import Zanix from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'start(): an explicit admin.<type>.onCreate is invoked with the created (anchored) id',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    // There is no auto-generated anchored id anymore — set one explicitly so `onCreate` fires
    // with a known, predictable id instead of a random bookkeeping one.
    Deno.env.set('ADMIN_SERVER_ID', 'admin-oncreate-test')

    let adminServerId: string | undefined

    await Zanix.bootstrap({
      admin: { rest: { onCreate: (id) => (adminServerId = id) } },
    })
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    assert(adminServerId, 'admin.rest.onCreate should have been called with the created id')
    assertEquals(adminServerId, 'admin-oncreate-test-rest')

    Deno.env.delete('ADMIN_SERVER_ID')
    Zanix.stop()
  },
})
