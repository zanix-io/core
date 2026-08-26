// deno-coverage-ignore-file

import { Controller, Get, Socket, ZanixController, ZanixWebSocket } from '@zanix/server'
import { Query, Resolver, ZanixResolver } from '@zanix/server/graphql'

/** Sockets */
@Socket({ route: 'socket' })
class _Socket extends ZanixWebSocket {
  protected override onmessage() {
  }
}

/** Resolvers */
@Resolver()
class _Resolver extends ZanixResolver {
  @Query()
  public hello() {
  }
}

/** Controllers */
@Controller()
class _Controller extends ZanixController {
  @Get()
  public welcome() {
    return 'response'
  }
}
