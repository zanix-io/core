import { assert, assertFalse } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'start(): an explicit admin.<type>.id wins over ADMIN_SERVER_ID, instead of being silently discarded',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    // Set to something DIFFERENT from the explicit id below — proves the explicit option wins
    // over the env var, not just that it's respected when the env var happens to be unset.
    Deno.env.set('ADMIN_SERVER_ID', 'env-derived')

    try {
      await Zanix.bootstrap({ admin: { rest: { id: 'explicit-id' } } })
      await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

      assert(
        webServerManager.info('explicit-id' as never).addr,
        'the explicitly-passed id should have been used as-is',
      )
      assertFalse(
        webServerManager.info('env-derived-rest' as never)?.addr,
        'the env-derived id must NOT have been used once an explicit id was passed',
      )

      await Zanix.stop()
    } finally {
      Deno.env.delete('ADMIN_SERVER_ID')
    }
  },
})
