import { assert } from '@std/assert'
import { stub } from '@std/testing/mock'
import Zanix from '../../../mod.ts'

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'start(): rootDir scopes discovery to a relative subdirectory instead of the whole cwd',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    Deno.env.set('TRIGGERS_MODEL_NAME', 'false')

    const warnStub = stub(console, 'warn')
    stub(console, 'info')

    // A relative, empty subdirectory of the real project root — `rootDir` is resolved relative to
    // `Deno.cwd()` (same as `defineLocalMetadata`'s own default `'.'`), so finding zero handlers
    // here proves discovery was actually scoped to it, rather than silently falling back to
    // scanning the whole project (which always has `main.handler.ts` and would register at least
    // one route — see the sibling "no local handlers" test for that baseline).
    const relativeEmptyDir = `./.tmp-rootdir-test-${crypto.randomUUID()}`
    await Deno.mkdir(relativeEmptyDir)

    try {
      await Zanix.bootstrap({ rootDir: relativeEmptyDir })
    } finally {
      await Deno.remove(relativeEmptyDir, { recursive: true })
      Deno.env.delete('TRIGGERS_MODEL_NAME')
    }

    assert(
      warnStub.calls.some((call) =>
        call.args.some((arg) => String(arg).includes('The main server was not started'))
      ),
      'expected the "The main server was not started" warning — proves rootDir scoped discovery ' +
        'away from the project handlers that normally register',
    )

    await Zanix.stop()
    warnStub.restore()
  },
})
