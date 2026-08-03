import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import Zanix from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')
stub(console, 'error')

const APP_A_HANDLER = `
import { Controller, Get, ZanixController } from '@zanix/server'

@Controller('a')
class OnlyAController extends ZanixController {
  @Get('only')
  public onlyA() {
    return 'a'
  }
}
`

const APP_B_HANDLER = `
import { Controller, Get, ZanixController } from '@zanix/server'

@Controller('b')
class OnlyBController extends ZanixController {
  @Get('only')
  public onlyB() {
    return 'b'
  }
}
`

// Distinct route paths from APP_A_HANDLER/APP_B_HANDLER above — route paths are unique per
// (path, method) across the WHOLE process regardless of Application (see
// `RouteContainer.defineTargetRoutes`), and `finalize:false`-registered routes (every named `apps`
// entry) are never purged afterward. Reusing the same literal path in a later `Deno.test` within
// this same file/process would collide with what an earlier test already registered.
const ROOTDIR_ARR_A_HANDLER = `
import { Controller, Get, ZanixController } from '@zanix/server'

@Controller('rootdir-arr-a')
class RootDirArrAController extends ZanixController {
  @Get('only')
  public onlyA() {
    return 'a'
  }
}
`

const ROOTDIR_ARR_B_HANDLER = `
import { Controller, Get, ZanixController } from '@zanix/server'

@Controller('rootdir-arr-b')
class RootDirArrBController extends ZanixController {
  @Get('only')
  public onlyB() {
    return 'b'
  }
}
`

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'start(): two named apps each get their own Application, own rootDir discovery, own server — no route leaks between them',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const emptyMainDir = `./.tmp-apps-main-${crypto.randomUUID()}`
    const dirA = `./.tmp-apps-a-${crypto.randomUUID()}`
    const dirB = `./.tmp-apps-b-${crypto.randomUUID()}`
    await Deno.mkdir(emptyMainDir)
    await Deno.mkdir(dirA)
    await Deno.mkdir(dirB)
    await Deno.writeTextFile(`${dirA}/only-a.handler.ts`, APP_A_HANDLER)
    await Deno.writeTextFile(`${dirB}/only-b.handler.ts`, APP_B_HANDLER)

    const PORT_A = 4601
    const PORT_B = 4602

    try {
      await Zanix.bootstrap({
        // Without this, the main app's own default `rootDir` ('.') would scan the whole project —
        // including dirA/dirB, created below, as ordinary subdirectories of it — and import their
        // handlers itself, under the DEFAULT Application, before the `apps` loop ever gets a
        // chance to (dynamic `import()` caches by URL, so the decorator only ever runs once, under
        // whichever scan reaches it first). Scoping the main app away from them is what makes this
        // a genuine test of the `apps` loop's own discovery, not an artifact of scan ordering.
        rootDir: emptyMainDir,
        apps: {
          appA: { rootDir: dirA, server: { rest: { port: PORT_A } } },
          appB: { rootDir: dirB, server: { rest: { port: PORT_B } } },
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

      // appA's own route is reachable on appA's own server. Unanchored (no `id`) REST servers fall
      // back to `bootstrapServers`'s own generic `/api` prefix — same default the main app's own
      // server uses (see `start.ts`'s admin-loop comment on this same default).
      const ownA = await fetch(`http://localhost:${PORT_A}/api/a/only`)
      assertEquals(ownA.status, 200)
      await ownA.body?.cancel()

      // appB's own route is reachable on appB's own server.
      const ownB = await fetch(`http://localhost:${PORT_B}/api/b/only`)
      assertEquals(ownB.status, 200)
      await ownB.body?.cancel()

      // appB's route never leaks onto appA's server, and vice versa — proves Application isolation
      // (each named app is scoped to its own Application, `bootstrapServers` only ever served what
      // was registered under that one).
      const crossA = await fetch(`http://localhost:${PORT_A}/api/b/only`)
      assertEquals(crossA.status, 404)
      await crossA.body?.cancel()

      const crossB = await fetch(`http://localhost:${PORT_B}/api/a/only`)
      assertEquals(crossB.status, 404)
      await crossB.body?.cancel()

      Zanix.stop()
    } finally {
      await Deno.remove(emptyMainDir, { recursive: true })
      await Deno.remove(dirA, { recursive: true })
      await Deno.remove(dirB, { recursive: true })
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: "start(): 'main' is a reserved apps key — throws instead of colliding with the main app",
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    await assertRejects(
      () => Zanix.bootstrap({ apps: { main: true as never } }),
      Error,
      "'main' is reserved",
    )
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    "start(): 'admin' is a reserved apps key — throws instead of being treated as a generic named app (use the top-level 'admin' option instead)",
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    await assertRejects(
      () => Zanix.bootstrap({ apps: { admin: true as never } }),
      Error,
      "'admin' is reserved",
    )
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'start(): rootDir as an array discovers handlers from every listed directory',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const dirA = `./.tmp-rootdir-arr-a-${crypto.randomUUID()}`
    const dirB = `./.tmp-rootdir-arr-b-${crypto.randomUUID()}`
    await Deno.mkdir(dirA)
    await Deno.mkdir(dirB)
    await Deno.writeTextFile(`${dirA}/only-a.handler.ts`, ROOTDIR_ARR_A_HANDLER)
    await Deno.writeTextFile(`${dirB}/only-b.handler.ts`, ROOTDIR_ARR_B_HANDLER)

    const PORT = 4603

    try {
      await Zanix.bootstrap({ rootDir: [dirA, dirB], server: { rest: { port: PORT } } })
      await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

      const resA = await fetch(`http://localhost:${PORT}/api/rootdir-arr-a/only`)
      assertEquals(resA.status, 200)
      await resA.body?.cancel()

      const resB = await fetch(`http://localhost:${PORT}/api/rootdir-arr-b/only`)
      assertEquals(resB.status, 200)
      await resB.body?.cancel()

      Zanix.stop()
    } finally {
      await Deno.remove(dirA, { recursive: true })
      await Deno.remove(dirB, { recursive: true })
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    "start(): a named apps entry with no 'server' key registers its Application without starting a server for it",
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const emptyMainDir = `./.tmp-apps-noserver-main-${crypto.randomUUID()}`
    await Deno.mkdir(emptyMainDir)

    try {
      // No `server` key at all for `appC` — `namedServers` stays `{}`, so this named app's own
      // `bootstrapServers(namedServers, { finalize: false })` call has nothing to serve and starts
      // no server for it, without throwing — a caller can register a named Application (e.g. for
      // discovery/registration purposes) without necessarily giving it its own listener. `rootDir`
      // reuses the same empty dir as the main app's own, to keep `appC`'s own discovery scan cheap
      // and collision-free rather than defaulting to a whole-cwd scan.
      await Zanix.bootstrap({
        rootDir: emptyMainDir,
        apps: { appC: { rootDir: emptyMainDir } },
      })
      await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

      Zanix.stop()
    } finally {
      await Deno.remove(emptyMainDir, { recursive: true })
    }
  },
})
