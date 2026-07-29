import { assert } from '@std/assert'
import { stub } from '@std/testing/mock'
import { Query, Resolver, Socket, ZanixResolver, ZanixWebSocket } from '@zanix/server'
import Zanix from '../../../mod.ts'

/**
 * `start.ts` always attempts to bootstrap all 3 admin server types (rest/graphql/socket), but
 * `@zanix/server` only actually creates a given type once a genuinely `isInternal: true`
 * route/resolver/handler of that type exists — today, `defineAdminMetadata()` only ever
 * registers REST admin routes (triggers/templates), so nothing in the rest of the suite exercises
 * the graphql/socket admin `onCreate` closures. These throwaway fixtures give them one, mirroring
 * `@zanix/server`'s own `_InternalResolver`/`_InternalSocket` test pattern.
 */
@Resolver({ isInternal: true })
class _AdminScopeResolver extends ZanixResolver {
  @Query()
  public adminScopeProbe() {
    return 'internal'
  }
}

@Socket({ route: 'admin-scope-probe', isInternal: true })
class _AdminScopeSocket extends ZanixWebSocket {
  protected override onmessage() {
    return { message: 'internal' }
  }
}

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'start(): admin graphql/socket servers fire onCreate when isInternal routes exist',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    await Zanix.bootstrap()
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    assert(Deno.env.get('ADMIN_GRAPQHL_SERVER_ID'), 'ADMIN_GRAPQHL_SERVER_ID should have been set')
    assert(Deno.env.get('ADMIN_SOCKET_SERVER_ID'), 'ADMIN_SOCKET_SERVER_ID should have been set')

    Zanix.stop()
  },
})
