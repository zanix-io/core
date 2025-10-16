import Zanix from '@zanix/core'
import { webServerManager } from '@zanix/server'
import { assert } from '@std/assert/assert'

Deno.test('Start module should init some servers', async () => {
  const servers: string[] = []
  const onCreate = (id: string) => {
    servers.push(id)
  }
  await Zanix.start({
    server: {
      rest: { onCreate },
      graphql: { onCreate },
      socket: { onCreate },
    },
  })

  assert(servers.length === 3)
  for (const server of servers) assert(webServerManager.info(server as never).addr)

  Zanix.stop()
})
