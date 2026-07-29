import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import Zanix from '../../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'admin templates API: registered internal-only when TEMPLATES_MODEL_NAME is set',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    Deno.env.set('TEMPLATES_MODEL_NAME', 'zanix-templates')

    const publicServers: string[] = []

    try {
      await Zanix.bootstrap({
        server: {
          rest: { onCreate: (id) => publicServers.push(id) },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

      const adminServerId = Deno.env.get('ADMIN_REST_SERVER_ID')
      assert(adminServerId, 'ADMIN_REST_SERVER_ID should have been set')

      const adminInfo = webServerManager.info(adminServerId as never)
      const adminAddr = adminInfo.addr
      assert(adminAddr, 'the admin rest server should be listening')

      const baseUrl = `http://${adminAddr.hostname}:${adminAddr.port}/${adminServerId}`

      // Proves `defineAdminMetadata()`'s TEMPLATES_MODEL_NAME branch actually registered the
      // route (auth-gated, reachable, not a 404) — not just that the import didn't throw. The
      // deep auth-behavior checks are covered by `@zanix/admin`'s own tests, the actual owner of
      // `createTemplatesController` — see its `templates.handler.test.ts` (unit) and
      // `templates-admin-api.test.ts` (functional).
      const unauthenticated = await fetch(`${baseUrl}/admin/templates/list`)
      assertEquals(unauthenticated.status, 401)
      await unauthenticated.body?.cancel()

      // Not registered on the public server at all — confirms isInternal isolation.
      const publicChecks = publicServers
        .map((id) => webServerManager.info(id as never))
        .filter((info) => info.type === 'rest')
        .map(async (info) => {
          const publicUrl = `http://${info.addr?.hostname}:${info.addr?.port}`
          const res = await fetch(`${publicUrl}/admin/templates/list`)
          assertEquals(res.status, 404)
          await res.body?.cancel()
        })
      await Promise.all(publicChecks)

      Zanix.stop()
    } finally {
      Deno.env.delete('TEMPLATES_MODEL_NAME')
    }
  },
})
