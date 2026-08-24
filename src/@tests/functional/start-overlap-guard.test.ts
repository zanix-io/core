import { assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import Zanix from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')
stub(console, 'error')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'Zanix.start() called again before a first, still-in-flight call resolves throws instead of racing',
  fn: async () => {
    Deno.env.delete('MONGO_URI')
    Deno.env.delete('REDIS_URI')

    // Deliberately not awaited — this is exactly the scenario that used to silently drop
    // `admin: true` on the first call (see `start.ts`'s `isStarting` doc): a second call's
    // synchronous prefix ran before the first call resumed past its own first `await`, clobbering
    // shared module state the first call would read back later.
    const first = Zanix.bootstrap({ admin: true })

    await assertRejects(
      () => Zanix.bootstrap(),
      Error,
      'was called again before a previous call in this process finished',
    )

    // The first call, unaffected by the rejected second one, must still complete normally.
    await first

    await Zanix.stop()
  },
})
