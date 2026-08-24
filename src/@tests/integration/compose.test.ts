import { assert, assertEquals } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { ProgramModule } from '@zanix/server'
import Zanix from '../../../mod.ts'

/** Same computation `reserved-slot-order.test.ts` uses for its own subprocess fixtures — the
 * script below needs to live INSIDE the project root so its `@zanix/server`/`./mod.ts` imports
 * resolve against this project's own `deno.json`/import map (Deno's bare-specifier resolution
 * depends on the entry module's own location, not the spawned process's `cwd` alone — see
 * `@zanix/cli`'s own `discoverRoutes` for the same, independently confirmed constraint). */
const projectRoot = join(dirname(fromFileUrl(import.meta.url)), '..', '..', '..')

/**
 * `Zanix.compose()` registers the same decorator metadata `Zanix.bootstrap()` itself registers
 * before it actually boots (cross-package core provider/connector slots + this project's own
 * auto-discovered handlers) — but must never touch real infrastructure. Deliberately does NOT set
 * `sanitizeOps`/`sanitizeResources: false` (unlike `start-core.test.ts`, which does exactly that
 * because it genuinely starts real servers) — leaving Deno's default sanitizers on is itself the
 * regression guard: if `compose()` ever grew a call to `activateApps()`/`bootstrapServers()`, an
 * open listener would fail this test via a leaked-resource error, with no other assertion needed
 * to catch it.
 */
Deno.test('Zanix.compose() registers metadata without starting any server', async () => {
  assert(!globalThis['_connectorExecuted' as never])
  assert(!globalThis['_interactorExecuted' as never])
  assert(!globalThis['_dslExecuted' as never])
  assert(!globalThis['_handlerExecuted' as never])

  // No `MONGO_URI`/`REDIS_URI` set — proves `defineCoreMetadata()`'s cross-package core imports
  // (datamaster/auth/notifications/asyncmq) never attempt a real connection on their own, same
  // guarantee `reserved-slot-order.test.ts`'s own subprocess fixtures already rely on.
  await Zanix.compose()

  // `defineLocalMetadata()`'s half of the contract — same fixture files/globals
  // `utils.test.ts`'s own `defineLocalMetadata files` test asserts, proving `compose()` really
  // drives the local auto-discovery scan, not just the core one.
  assert(globalThis['_connectorExecuted' as never])
  assert(globalThis['_interactorExecuted' as never])
  assert(globalThis['_dslExecuted' as never])
  assert(globalThis['_handlerExecuted' as never])
})

/**
 * The actual contract a static consumer (e.g. `zanix generate openapi`) needs: a real
 * `@Controller`/`@Get`-decorated route is not just imported by `compose()`'s auto-discovery scan,
 * but genuinely persisted in `ProgramModule.routes` and reachable via `@zanix/server`'s own public
 * `getRoutes('rest')` accessor afterward. Nothing in `compose()`'s own sequence
 * (`defineCoreMetadata()`, `defineApplication()`) resets or wipes route metadata — only a real
 * `bootstrapServers()` call does that (`cleanupInitializationsMetadata`, never invoked by
 * `compose()`), so this is never at risk of racing a reset.
 *
 * The fixture is written to, and removed from, a throwaway temp directory at runtime — same
 * pattern as `start-root-dir.test.ts`'s own `rootDir`-scoping test — rather than a checked-in
 * fixture file. `defineLocalMetadata()`'s default (`dir: '.'`) scan (used by the test above, and
 * by every other functional test that omits `rootDir`) walks the WHOLE repo tree, not just one
 * subdirectory — a permanent fixture file anywhere under the repo, even nested under `@tests/`,
 * would still be picked up by, and inflate the hardcoded route count in,
 * `start-core.test.ts`'s own `MAIN_APP_LINES` assertion (confirmed empirically: an earlier version
 * of this fixture broke it). `rootDir` scoping to a throwaway directory avoids that blast radius
 * entirely, the same reason `start-root-dir.test.ts` uses one for the opposite assertion (finding
 * nothing).
 */
Deno.test({
  name:
    'Zanix.compose(rootDir) registers a real route reachable via ProgramModule.routes.getRoutes',
  fn: async () => {
    const relativeDir = `./.tmp-compose-route-test-${crypto.randomUUID()}`
    await Deno.mkdir(relativeDir)

    try {
      await Deno.writeTextFile(
        `${relativeDir}/compose-route.handler.ts`,
        `import { Controller, Get, ZanixController } from '@zanix/server'\n\n` +
          `@Controller({ prefix: 'compose-route-fixture' })\n` +
          `export class _ComposeRouteFixtureController extends ZanixController {\n` +
          `  @Get('')\n` +
          `  public check() {\n` +
          `    return { ok: true }\n` +
          `  }\n` +
          `}\n`,
      )

      await Zanix.compose(relativeDir)
    } finally {
      await Deno.remove(relativeDir, { recursive: true })
    }

    const routes = ProgramModule.routes.getRoutes('rest')
    const entry = routes?.['main:/compose-route-fixture/GET']
    assertEquals(entry?.path, '/compose-route-fixture')
    assertEquals(entry?.application, 'main')
  },
})

/**
 * `Zanix.compose(rootDir, { admin: true })`'s own contract: `@zanix/admin`'s built-in
 * `/admin/service-token` route (always registered, unconditionally — see
 * `createServiceExchangeController`'s own doc) becomes visible via `ProgramModule.routes
 * .getRoutes('rest')`, under the `'admin'` Application — without starting any server or activating
 * any real infrastructure. Same regression guard as the plain `compose()` test above: Deno's
 * default sanitizers stay ON (`sanitizeOps`/`sanitizeResources` never disabled here) — if
 * `{ admin: true }` ever grew a real resource construction or a leaked timer/connection,
 * this test would fail via a leaked-resource error with no further assertion needed.
 */
Deno.test(
  'Zanix.compose(rootDir, { admin: true }) registers @zanix/admin routes without starting any server',
  async () => {
    await Zanix.compose(undefined, { admin: true })

    const routes = ProgramModule.routes.getRoutes('rest')
    const entry = routes?.['admin:/admin/service-token/POST']
    assertEquals(entry?.path, '/admin/service-token')
    assertEquals(entry?.application, 'admin')
  },
)

/**
 * The default (`options` omitted, or `{ admin: false }`/omitted `admin`) must stay exactly what it
 * was before this option existed — `admin`-scoped routes are never registered unless explicitly
 * asked for. Runs in a real subprocess (its own fresh `ProgramModule` module graph) so this
 * assertion is never at risk of a false negative from the test above (in this same file, same
 * process) having already registered `/admin/service-token` on the shared registry.
 *
 * Also doubles as this task's own concrete proof of "zero real side effects, nothing needing
 * explicit teardown": the subprocess runs `Zanix.compose(rootDir, { admin: true })` with no
 * `Zanix.stop()`/`deactivateApps()` call of its own at all, and no `MONGO_URI`/`REDIS_URI`/AMQP
 * config set — `command.output()` only resolves once the subprocess's own event loop has drained
 * and it has exited *on its own*; a leaked timer, an open DB/AMQP connection, or a listening server
 * would hang this `await` (and this test) rather than let the assertions below ever run.
 */
Deno.test(
  'Zanix.compose(rootDir, { admin: true }) exits cleanly on its own — no leaked resource/timer, ' +
    'and Zanix.compose(rootDir) (no admin option) never registers @zanix/admin routes',
  async () => {
    const withAdminScript = `
      import Zanix from './mod.ts'
      import { ProgramModule } from '@zanix/server'

      await Zanix.compose(undefined, { admin: true })

      const routes = ProgramModule.routes.getRoutes('rest') ?? {}
      console.log(JSON.stringify(Object.keys(routes)))
    `
    const withoutAdminScript = `
      import Zanix from './mod.ts'
      import { ProgramModule } from '@zanix/server'

      await Zanix.compose()

      const routes = ProgramModule.routes.getRoutes('rest') ?? {}
      console.log(JSON.stringify(Object.keys(routes)))
    `

    async function runInSubprocess(script: string) {
      const scriptPath = await Deno.makeTempFile({ dir: projectRoot, suffix: '.ts' })
      try {
        await Deno.writeTextFile(scriptPath, script)
        const command = new Deno.Command(Deno.execPath(), {
          args: ['run', '--allow-all', scriptPath],
          cwd: projectRoot,
          stdout: 'piped',
          stderr: 'piped',
        })
        return await command.output()
      } finally {
        await Deno.remove(scriptPath).catch(() => {})
      }
    }

    const withAdmin = await runInSubprocess(withAdminScript)
    assert(
      withAdmin.success,
      `expected the { admin: true } subprocess to exit cleanly on its own — stderr: ` +
        new TextDecoder().decode(withAdmin.stderr),
    )
    const withAdminRouteKeys: string[] = JSON.parse(
      new TextDecoder().decode(withAdmin.stdout).trim(),
    )
    assert(
      withAdminRouteKeys.includes('admin:/admin/service-token/POST'),
      `expected 'admin:/admin/service-token/POST' among: ${JSON.stringify(withAdminRouteKeys)}`,
    )

    const withoutAdmin = await runInSubprocess(withoutAdminScript)
    assert(
      withoutAdmin.success,
      `expected the subprocess to succeed — stderr: ${
        new TextDecoder().decode(withoutAdmin.stderr)
      }`,
    )
    const withoutAdminRouteKeys: string[] = JSON.parse(
      new TextDecoder().decode(withoutAdmin.stdout).trim(),
    )
    assert(
      !withoutAdminRouteKeys.some((key) => key.startsWith('admin:')),
      `expected no 'admin:'-prefixed route, got: ${JSON.stringify(withoutAdminRouteKeys)}`,
    )
  },
)
