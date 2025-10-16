import {
  Controller,
  Get,
  Query,
  Resolver,
  Socket,
  ZanixController,
  ZanixResolver,
  ZanixWebSocket,
} from '@zanix/server'

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
