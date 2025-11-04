import { webServerManager } from '@zanix/server'
import { assertSpyCalls, stub } from '@std/testing/mock'
import { assert } from '@std/assert'
import Zanix from '../../../mod.ts'

/** mocks */
const consoleSuccess = stub(console, 'info')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'Start module should init servers with core modules',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')

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

    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait until mongo core connection

    assertSpyCalls(consoleSuccess, 7)
    assert(
      consoleSuccess.calls.some((call) => call.args[1].includes('MongoDB Connected Successfully')),
    )

    assert(servers.length === 3)
    for (const server of servers) assert(webServerManager.info(server as never).addr)

    Zanix.stop()
  },
})

Deno.test('clear mocks', () => {
  consoleSuccess.restore()
})
