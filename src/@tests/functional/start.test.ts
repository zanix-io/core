import { webServerManager } from '@zanix/server'
import { stub } from '@std/testing/mock'
import { assert, assertFalse } from '@std/assert'
import Zanix from '../../../mod.ts'

/** mocks */
const consoleSuccess = stub(console, 'info')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'Start module should init servers',
  fn: async () => {
    Deno.env.delete('MONGO_URI')
    Deno.env.delete('REDIS_URI')

    const servers: string[] = []
    const onCreate = (id: string) => {
      servers.push(id)
    }
    await Zanix.bootstrap({
      server: {
        rest: { onCreate },
        graphql: { onCreate },
        socket: { onCreate },
      },
    })

    assertFalse(
      consoleSuccess.calls.some((call) => call.args[1].includes('MongoDB Connected Successfully')),
    )
    assertFalse(
      consoleSuccess.calls.some((call) => call.args[1].includes('Redis Connected Successfully')),
    )

    assert(servers.length === 3)
    for (const server of servers) assert(webServerManager.info(server as never).addr)

    Zanix.stop()
  },
})

Deno.test('clear mocks', () => {
  consoleSuccess.restore()
})
