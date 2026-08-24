import { assert, assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import { defineZanixApp } from '@zanix/app'
import { registerResourceType } from '@zanix/app/runtime'
import type { HandlerContext } from '@zanix/server'
import { Controller, Get, SsrController, ZanixController, ZanixSsrController } from '@zanix/server'
import Zanix from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')
stub(console, 'error')

// Route paths are unique per (path, method) across the WHOLE process regardless of Application
// (see `RouteContainer.defineTargetRoutes`), and `finalize:false`-registered routes (every named
// `apps` entry) are never purged afterward. Reusing the same literal path in a later `Deno.test`
// within this same file/process would collide with what an earlier test already registered.
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
  name: 'start(): a Zanix App declared via apps.<name> actually serves its own mounted routes',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const reviews = defineZanixApp({
      name: 'zanix-app-reviews',
      routes: true,
      setup: (ctx) => {
        // The class must be DEFINED (its decorators evaluated) inside this callback — that's the
        // instant `RouteContainer` attributes the route to this app's own ambient Application
        // (see `ctx.routes()`'s own doc); defining it earlier, outside this scope, would attribute
        // it to whatever Application was ambient at that earlier point instead (almost certainly
        // the wrong one). Never manually instantiated — the framework's own DI does that
        // per-request, same as any auto-discovered `@Controller`.
        ctx.routes(() => {
          @Controller('endpoint')
          class ZanixAppOnlyController extends ZanixController {
            @Get('ping')
            public ping() {
              return 'zanix-app-reviews'
            }
          }
          void ZanixAppOnlyController
        })
      },
    })

    const PORT = 4604

    try {
      await Zanix.bootstrap({
        apps: {
          'zanix-app-reviews': {
            definition: reviews,
            server: { rest: { port: PORT } },
          },
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

      // controller prefix ('endpoint') + method path ('ping'), mounted under the app's own
      // `routes: true` prefix (its own `name`, 'zanix-app-reviews') — see `routeProcessor`'s own
      // doc for the exact `globalPrefix + mountPrefix + controllerPrefix + methodPath` order.
      const res = await fetch(
        `http://localhost:${PORT}/api/zanix-app-reviews/endpoint/ping`,
      )
      assertEquals(res.status, 200)
      await res.body?.cancel()
    } finally {
      await Zanix.stop()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  // `@zanix/space`'s own `defineSpaceApp` is a thin wrapper over `defineZanixApp` with no
  // different runtime shape, so this is exactly the pattern `zanix new spacecraft` generates
  // (`Zanix.start({ apps: { name: { definition: spaceApp, server: { ssr: {} } } } })`) — verified
  // once directly against a real `defineSpaceApp` app+fetch, then written here instead, against
  // `@zanix/server`'s own `'ssr'` primitives directly: `@zanix/core` must never gain a real
  // dependency on `@zanix/space` just to cover this,
  // and it doesn't need to — the actual gap this closes is generic to `Zanix.start({ apps })`'s own
  // per-server-type dispatch (`bootstrapAppServer`), not anything space-specific. `Get`/`SsrController`
  // called as plain functions (not real `@` syntax) register correctly regardless of invocation
  // style — `@zanix/space`'s own `registerPage` does the exact same thing in production; the
  // `ctx.routes()` wrapper below only matters for attributing the route to this app's own ambient
  // Application, same as the REST test above.
  name: "start(): a Zanix App's own 'ssr' server type is served correctly too, not just 'rest'",
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const ssrOnly = defineZanixApp({
      name: 'zanix-app-ssr-only',
      // Without this, `normalizeManifest` defaults an omitted `routes` to `routes: true`, which
      // mounts every route under `/zanix-app-ssr-only/...` (same as the REST test above) — this
      // app instead mirrors `@zanix/space`'s own `defineSpaceApp`, which always passes
      // `routes: { prefix: '' }` so pages resolve at their bare path.
      routes: { prefix: '' },
      setup: (ctx) => {
        ctx.routes(() => {
          class SsrOnlyPage extends ZanixSsrController {
            public serve(_ctx: HandlerContext): Response {
              return new Response('zanix-app-ssr-only-ok')
            }
          }
          Get('/ssr-only-check')(SsrOnlyPage.prototype.serve)
          SsrController()(SsrOnlyPage)
        })
      },
    })

    const PORT = 4606

    try {
      await Zanix.bootstrap({
        apps: {
          'zanix-app-ssr-only': {
            definition: ssrOnly,
            server: { ssr: { port: PORT } },
          },
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

      const res = await fetch(`http://localhost:${PORT}/ssr-only-check`)
      assertEquals(res.status, 200)
      assertEquals(await res.text(), 'zanix-app-ssr-only-ok')
    } finally {
      await Zanix.stop()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  // Unlike the test above (a Zanix App registered via `apps.<name>`), this exercises the OTHER
  // legitimate consumer of the 'ssr' server type: a plain `server` project that never adopts
  // `@zanix/app`/`@zanix/space` at all, and just wants a standalone SSR page on its own port using
  // `@zanix/server`'s raw primitives directly — `Zanix.start({ server: { ssr: {...} } })` with no
  // `apps` involved. No `ctx.routes()` wrapper is needed here: with no Zanix App ambient context
  // active, `RouteContainer` attributes the route to the default ('main') Application, same as any
  // rootDir-discovered `@Controller` elsewhere in this file. 'ssr' has no default `globalPrefix`
  // (unlike 'rest', which defaults to 'api') and 'main' never gets an app-name mount prefix (that's
  // only registered for `defineZanixApp` entries) — so the route resolves at its bare declared path.
  name: "start(): the main Application's own top-level `server.ssr` works standalone, on its own " +
    'port, with no `apps` involved',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    class MainSsrOnlyPage extends ZanixSsrController {
      public serve(_ctx: HandlerContext): Response {
        return new Response('main-ssr-ok')
      }
    }
    Get('/main-ssr-check')(MainSsrOnlyPage.prototype.serve)
    SsrController()(MainSsrOnlyPage)

    const PORT = 4607

    try {
      await Zanix.bootstrap({ server: { ssr: { port: PORT } } })
      await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

      const res = await fetch(`http://localhost:${PORT}/main-ssr-check`)
      assertEquals(res.status, 200)
      assertEquals(await res.text(), 'main-ssr-ok')
    } finally {
      await Zanix.stop()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  // `@zanix/server`'s own `ssr-decorators.test.ts` already proves route-table isolation at the
  // metadata level (`Program.routes.getRoutes('rest')` is empty for an `@SsrController` class,
  // `getRoutes('ssr')` has it) — this proves the same thing end-to-end over real HTTP instead: a
  // `@Controller` REST route registered in the same process is genuinely unreachable through the
  // 'ssr' listener, not merely absent from a metadata table nothing ever reads.
  name: 'start(): server.ssr never serves a REST @Controller route registered in the same ' +
    'process — route tables stay isolated end-to-end, not just at the metadata level',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    @Controller('isolation-check')
    class IsolationRestController extends ZanixController {
      @Get('rest-only')
      public restOnly() {
        return 'rest-only-ok'
      }
    }
    void IsolationRestController

    class IsolationSsrPage extends ZanixSsrController {
      public serve(_ctx: HandlerContext): Response {
        return new Response('ssr-only-ok')
      }
    }
    Get('/ssr-isolation-check')(IsolationSsrPage.prototype.serve)
    SsrController()(IsolationSsrPage)

    const PORT = 4608

    try {
      // Only an 'ssr' listener is bootstrapped in this process — no 'rest' listener at all.
      await Zanix.bootstrap({ server: { ssr: { port: PORT } } })
      await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

      const ssrRes = await fetch(
        `http://localhost:${PORT}/ssr-isolation-check`,
      )
      assertEquals(ssrRes.status, 200)
      assertEquals(await ssrRes.text(), 'ssr-only-ok')

      // The REST route is real (registered under 'rest' at class-decoration time, independent of
      // whether any 'rest' server ever gets bootstrapped) — if the 'ssr' listener's dispatch ever
      // fell back to a shared/combined route table instead of its own isolated 'ssr' one, this would
      // wrongly resolve to 200. It must 404.
      const restThroughSsr = await fetch(
        `http://localhost:${PORT}/api/isolation-check/rest-only`,
      )
      assertEquals(restThroughSsr.status, 404)
    } finally {
      await Zanix.stop()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: "start(): a Zanix App with no 'server' registers (no throw) but is never served",
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    let onStartRan = false
    const jobsOnly = defineZanixApp({
      name: 'zanix-app-jobs-only',
      onStart: () => {
        onStartRan = true
      },
    })

    try {
      await Zanix.bootstrap({
        apps: { 'zanix-app-jobs-only': { definition: jobsOnly } },
      })
      await new Promise((resolve) => setTimeout(resolve, 1000))

      assert(
        onStartRan,
        'onStart must still run even though this app never gets its own server',
      )
    } finally {
      await Zanix.stop()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'start(): two Zanix Apps bound to the same SetupOptions.resources entry (via each ' +
    'own "uses") resolve to the SAME instance',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    let fakeConnectorCalls = 0
    registerResourceType('start-apps-named-fake-db', () => {
      fakeConnectorCalls++
      return { close: () => {} }
    })

    const seenInstances: Record<string, unknown> = {}
    const appA = defineZanixApp({
      name: 'zanix-app-shared-a',
      dependencies: { database: { type: 'start-apps-named-fake-db' } },
      onStart: (ctx) => {
        seenInstances.a = ctx.resource('database')
      },
    })
    const appB = defineZanixApp({
      name: 'zanix-app-shared-b',
      dependencies: { database: { type: 'start-apps-named-fake-db' } },
      onStart: (ctx) => {
        seenInstances.b = ctx.resource('database')
      },
    })

    try {
      await Zanix.bootstrap({
        resources: {
          sharedDb: { type: 'start-apps-named-fake-db', options: {} },
        },
        apps: {
          'zanix-app-shared-a': {
            definition: appA,
            uses: [{ slot: 'database', resourceName: 'sharedDb' }],
          },
          'zanix-app-shared-b': {
            definition: appB,
            uses: [{ slot: 'database', resourceName: 'sharedDb' }],
          },
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 1000))

      assertEquals(
        fakeConnectorCalls,
        1,
        'a shared root resource must only ever construct once',
      )
      assert(
        seenInstances.a === seenInstances.b,
        'both apps must see the exact same resource instance',
      )
    } finally {
      await Zanix.stop()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: "start(): apps.<name>.behaviors overrides that app's own declared behavior default",
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    let seen: unknown
    const billing = defineZanixApp({
      name: 'zanix-app-behaviors-billing',
      behaviors: {
        calculateDiscount: { default: (total: number) => total * 0 },
      },
      onStart: (ctx) => {
        seen = ctx.behavior('calculateDiscount')
      },
    })
    const customDiscount = (total: number) => total * 0.1

    try {
      await Zanix.bootstrap({
        server: { rest: { port: 4608 } },
        apps: {
          'zanix-app-behaviors-billing': {
            definition: billing,
            behaviors: { calculateDiscount: customDiscount },
          },
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 1000))

      assertEquals(seen, customDiscount)
    } finally {
      await Zanix.stop()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: "start(): a Zanix App entry whose 'apps' key does not match the manifest's own name " +
    'throws explicitly',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const mismatched = defineZanixApp({ name: 'zanix-app-real-name' })

    await assertRejects(
      () =>
        Zanix.bootstrap({
          apps: { 'different-key': { definition: mismatched } },
        }),
      Error,
      "must match the manifest's own 'name'",
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
    await Deno.writeTextFile(
      `${dirA}/only-a.handler.ts`,
      ROOTDIR_ARR_A_HANDLER,
    )
    await Deno.writeTextFile(
      `${dirB}/only-b.handler.ts`,
      ROOTDIR_ARR_B_HANDLER,
    )

    const PORT = 4603

    try {
      await Zanix.bootstrap({
        rootDir: [dirA, dirB],
        server: { rest: { port: PORT } },
      })
      await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

      const resA = await fetch(
        `http://localhost:${PORT}/api/rootdir-arr-a/only`,
      )
      assertEquals(resA.status, 200)
      await resA.body?.cancel()

      const resB = await fetch(
        `http://localhost:${PORT}/api/rootdir-arr-b/only`,
      )
      assertEquals(resB.status, 200)
      await resB.body?.cancel()

      await Zanix.stop()
    } finally {
      await Deno.remove(dirA, { recursive: true })
      await Deno.remove(dirB, { recursive: true })
    }
  },
})
