import { assertSpyCalls, stub } from '@std/testing/mock'
import { assert } from '@std/assert'
import Zanix from '../../../mod.ts'

/** mocks */
const consoleSuccess = stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'Start module should init servers with core modules',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    await Zanix.bootstrap()

    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait until mongo core connection

    assertSpyCalls(consoleSuccess, 8)
    assert(
      consoleSuccess.calls.some((call) => call.args[1].includes('MongoDB Connected Successfully')),
    )
    assert(
      consoleSuccess.calls.some((call) => call.args[1].includes('Redis Connected Successfully')),
    )

    Zanix.stop()
  },
})

Deno.test('clear mocks', () => {
  consoleSuccess.restore()
})
