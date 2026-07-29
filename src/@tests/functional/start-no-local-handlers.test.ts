import { assert } from '@std/assert'
import { stub } from '@std/testing/mock'
import Zanix from '../../../mod.ts'

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'start(): logs "No server was started" when defineLocalMetadata() finds zero handlers',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    Deno.env.set('TRIGGERS_MODEL_NAME', 'false')

    const warnStub = stub(console, 'warn')
    stub(console, 'info')

    // `defineLocalMetadata()` scans `Deno.cwd()` for `.handler.ts`/etc. files — every other test
    // in this suite runs from the real project directory, where `main.handler.ts` always
    // registers at least one public route. Temporarily pointing `cwd` at a fresh, empty
    // directory is the only way to genuinely exercise `start.ts`'s "no server was started"
    // warning, rather than forcing it with a mock.
    const originalCwd = Deno.cwd()
    const emptyDir = await Deno.makeTempDir()
    // Some core dependencies (e.g. `@zanix/asyncmq`'s RabbitMQ provider setup) look up
    // `deno.json`/`deno.jsonc` relative to `Deno.cwd()` on their own — an empty-but-otherwise-
    // valid config file keeps that lookup happy without registering any handler files.
    await Deno.writeTextFile(`${emptyDir}/deno.json`, '{}')

    try {
      Deno.chdir(emptyDir)
      await Zanix.bootstrap()
    } finally {
      Deno.chdir(originalCwd)
      await Deno.remove(emptyDir, { recursive: true })
      // `Deno.env` is real OS-process environment, shared across every test file in this run —
      // must not leak into files that assert on TRIGGERS_MODEL_NAME being unset.
      Deno.env.delete('TRIGGERS_MODEL_NAME')
    }

    assert(
      warnStub.calls.some((call) =>
        call.args.some((arg) => String(arg).includes('No server was started'))
      ),
      'expected the "No server was started" warning to have been logged',
    )

    Zanix.stop()
  },
})
