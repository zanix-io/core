import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import {
  ProgramModule,
  Query,
  Resolver,
  Socket,
  ZanixResolver,
  ZanixWebSocket,
} from '@zanix/server'
import Zanix from '../../../mod.ts'

/**
 * `start.ts` always attempts to bootstrap all 3 admin server types (rest/graphql/socket), but
 * `@zanix/server` only actually creates a given type once a genuinely `'admin'`-Application
 * route/resolver/handler of that type exists — today, `defineAdminMetadata()` only ever
 * registers REST admin routes (triggers/templates), so nothing in the rest of the suite exercises
 * the graphql/socket admin `onCreate` closures. These throwaway fixtures give them one, mirroring
 * `@zanix/server`'s own `_InternalResolver`/`_InternalSocket` test pattern.
 */
await ProgramModule.defineApplication('admin', () => {
  @Resolver()
  class _AdminScopeResolver extends ZanixResolver {
    @Query()
    public adminScopeProbe() {
      return 'internal'
    }
  }

  @Socket({ route: 'admin-scope-probe' })
  class _AdminScopeSocket extends ZanixWebSocket {
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
  name: "start(): admin graphql/socket servers fire onCreate when 'admin'-Application routes exist",
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    // There is no auto-generated anchored id anymore — set one explicitly so each `onCreate`
    // fires with a known, predictable id instead of a random bookkeeping one.
    Deno.env.set('ADMIN_SERVER_ID', 'admin-scope-test')

    let graphqlId: string | undefined
    let socketId: string | undefined

    await Zanix.bootstrap({
      admin: {
        graphql: { onCreate: (id) => (graphqlId = id) },
        socket: { onCreate: (id) => (socketId = id) },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    assertEquals(graphqlId, 'admin-scope-test-graphql')
    assertEquals(socketId, 'admin-scope-test-socket')

    Deno.env.delete('ADMIN_SERVER_ID')
    Zanix.stop()
  },
})
