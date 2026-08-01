import { assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import Zanix, { ZanixAdmin } from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')
stub(console, 'error')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'Zanix.start({admin:true}) followed by ZanixAdmin.start() in the same process throws instead of racing',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    await Zanix.bootstrap({ admin: true })
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    try {
      await assertRejects(
        () => ZanixAdmin.start(),
        Error,
        undefined,
      )
    } finally {
      Zanix.stop()
    }
  },
})
