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
    'Zanix.start() called again after a previous call already finished (no stop() in between) throws — and works again once stop() releases it',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    await Zanix.bootstrap()

    // Fully sequential — the first call already resolved, unlike `start-overlap-guard.test.ts`'s
    // still-in-flight scenario. `isRunning`, not `isStarting`, is what catches this one.
    await assertRejects(
      () => Zanix.bootstrap(),
      Error,
      'is still running',
    )

    Zanix.stop()

    // The guard was released by `stop()` — a fresh `start()` must succeed again, not stay
    // permanently blocked by the earlier rejection.
    await Zanix.bootstrap()

    Zanix.stop()
  },
})
