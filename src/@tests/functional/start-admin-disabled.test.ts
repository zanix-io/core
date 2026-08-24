import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'start(): admin is disabled by default — no admin server boots, no admin routes exist',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    let mainServerId: string | undefined

    await Zanix.bootstrap({
      server: { rest: { onCreate: (id) => (mainServerId = id) } },
    })
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    assert(mainServerId, 'the main REST server should have been created')
    const addr = webServerManager.info(mainServerId as never).addr
    assert(addr, 'the main REST server should be listening')

    // `/admin/service-token` always exists once `defineAdminMetadata()` runs — a 404 here proves
    // it never did, i.e. no admin server/metadata was registered at all.
    const res = await fetch(
      `http://${addr.hostname}:${addr.port}/api/admin/service-token`,
      {
        method: 'POST',
      },
    )
    assertEquals(res.status, 404)
    await res.body?.cancel()

    await Zanix.stop()
  },
})
