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
    'admin templates API: registered on the admin Application only when TEMPLATES_MODEL_NAME is set',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    Deno.env.set('TEMPLATES_MODEL_NAME', 'zanix-templates')
    // There is no auto-generated anchored id anymore — set one explicitly so the admin server is
    // reachable at a known address.
    Deno.env.set('ADMIN_SERVER_ID', 'admin-templates-api-test')

    const publicServers: string[] = []

    try {
      await Zanix.bootstrap({
        admin: true,
        server: {
          rest: { onCreate: (id) => publicServers.push(id) },
        },
      })

      await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

      const adminServerId = 'admin-templates-api-test-rest'

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

      // `@zanix/admin`'s own `defineAdminMetadata()` also registers a read-only Discovery endpoint
      // alongside the CRUD one — proves it's reachable (auth-gated, same as CRUD) on the same admin
      // server, not just that registering it didn't throw.
      const discoveryUnauthenticated = await fetch(
        `${baseUrl}/.well-known/zanix/templates`,
      )
      assertEquals(discoveryUnauthenticated.status, 401)
      await discoveryUnauthenticated.body?.cancel()

      // Not registered on the default-Application server at all — confirms Application isolation.
      const publicChecks = publicServers
        .map((id) => webServerManager.info(id as never))
        .filter((info) => info.type === 'rest')
        .map(async (info) => {
          const publicUrl = `http://${info.addr?.hostname}:${info.addr?.port}`
          const res = await fetch(`${publicUrl}/admin/templates/list`)
          assertEquals(res.status, 404)
          await res.body?.cancel()

          const discoveryRes = await fetch(
            `${publicUrl}/.well-known/zanix/templates`,
          )
          assertEquals(discoveryRes.status, 404)
          await discoveryRes.body?.cancel()
        })
      await Promise.all(publicChecks)

      Zanix.stop()
    } finally {
      Deno.env.delete('TEMPLATES_MODEL_NAME')
      Deno.env.delete('ADMIN_SERVER_ID')
    }
  },
})
