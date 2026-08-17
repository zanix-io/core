import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'

// The reserved core-connector-slot registry (`ConnectorCoreModules[slot].registered`, in
// `@zanix/server`) is a process-wide singleton with no reset — once any test in this shared
// `deno test` process registers `'search'` (many do, transitively, via `Zanix.bootstrap()`), it
// stays registered for the rest of the process. Reproducing "decorated before the owning package
// registered it" therefore requires a genuinely separate process (its own module graph) — exactly
// like the real bug (a Worker/tasker with its own module graph, evaluated before `defineCoreMetadata`
// ran). See `../../modules/{worker,tasker}.ts` for the fixed call order this guards.
const fixturesDir = join(
  dirname(fromFileUrl(import.meta.url)),
  'fixtures',
  'reserved-slot',
)
const projectRoot = join(
  dirname(fromFileUrl(import.meta.url)),
  '..',
  '..',
  '..',
)

async function runFixture(script: string) {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['run', '--allow-all', join(fixturesDir, script)],
    cwd: projectRoot,
    stdout: 'piped',
    stderr: 'piped',
  })
  const { code, stdout, stderr } = await command.output()
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  }
}

Deno.test({
  name: 'defineCoreMetadata() before defineLocalMetadata() lets a local file rewrite a reserved ' +
    "core connector slot (worker.ts/tasker.ts's fixed order)",
  fn: async () => {
    const result = await runFixture('core-before-local.ts')
    assertEquals(
      result.code,
      0,
      `expected the subprocess to succeed — stderr: ${result.stderr}`,
    )
    assertStringIncludes(result.stdout, 'OK')
  },
})

Deno.test({
  name: 'defineLocalMetadata() before defineCoreMetadata() throws when a local file rewrites a ' +
    "reserved core connector slot (regression guard against reintroducing worker.ts/tasker.ts's " +
    'old, broken order)',
  fn: async () => {
    const result = await runFixture('local-before-core.ts')
    // The rejection surfaces as an `unhandledrejection` that `@zanix/server`'s own global handler
    // (installed transitively — see `utils/errors/process.ts`) catches and logs rather than
    // crashing the process with a non-zero exit code, so `code` alone can't distinguish
    // pass/fail here — asserting `'OK'` never printed (the script never got past the throwing
    // `defineLocalMetadata` call) plus the specific error in stderr is the reliable signal.
    assert(
      !result.stdout.includes('OK'),
      `expected no 'OK' — stdout: ${result.stdout}`,
    )
    assertStringIncludes(result.stderr, 'reserved core connector slot')
  },
})
