import { assert } from '@std/assert'
import { stub } from '@std/testing/mock'
import { ProgramModule, Socket, webServerManager, ZanixWebSocket } from '@zanix/server'
import { Query, Resolver, ZanixResolver } from '@zanix/server/graphql'
import Zanix from '../../../mod.ts'

/**
 * `defineAdminMetadata()` always registers the REST triggers admin route, but graphql/socket
 * admin servers are only created once a genuinely `'admin'`-Application resolver/socket exists
 * (see `start-admin-scope.test.ts`) — these throwaway fixtures give this file its own, since
 * `Zanix.bootstrap()` clears resolver/socket registration metadata after boot
 * (`cleanupInitializationsMetadata`), so a second boot in another test file can't reuse them.
 */
await ProgramModule.defineApplication('admin', () => {
  @Resolver()
  class _AdminServerIdResolver extends ZanixResolver {
    @Query()
    public adminServerIdProbe() {
      return 'internal'
    }
  }

  @Socket({ route: 'admin-server-id-probe' })
  class _AdminServerIdSocket extends ZanixWebSocket {
    protected override onmessage() {
      return { message: 'internal' }
    }
  }
})

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'start(): ADMIN_SERVER_ID pins the admin servers to a stable, per-type suffixed id',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    Deno.env.set('ADMIN_SERVER_ID', 'custom-billing')

    try {
      await Zanix.bootstrap({ admin: true })
      await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

      assert(
        webServerManager.info('custom-billing-rest' as never).addr,
        'rest server should be reachable under the ADMIN_SERVER_ID-derived id',
      )
      assert(
        webServerManager.info('custom-billing-graphql' as never).addr,
        'graphql server should be reachable under the ADMIN_SERVER_ID-derived id',
      )
      assert(
        webServerManager.info('custom-billing-socket' as never).addr,
        'socket server should be reachable under the ADMIN_SERVER_ID-derived id',
      )

      await Zanix.stop()
    } finally {
      Deno.env.delete('ADMIN_SERVER_ID')
    }
  },
})
