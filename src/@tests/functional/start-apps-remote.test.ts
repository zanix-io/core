import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import { defineZanixApp } from '@zanix/app'
import { ControlPlaneRegistry, HttpRemoteAdapter } from '@zanix/app/runtime'
import type { HttpRemoteDispatcher } from '@zanix/app/runtime'
import { ZanixRedisConnector } from '@zanix/datamaster/cache'
import Zanix from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')
stub(console, 'error')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  // Before `SetupOptions.dispatcher` existed, `start()` hardcoded `activateApps`'s own 4th
  // argument to `undefined` — always falling back to the auto-detected `'controlPlane'` provider
  // (or local-only, if none was registered), with no way for a caller to supply a custom
  // `HttpRemoteDispatcher` (e.g. an `HttpRemoteAdapter` configured with `mtls`). This proves the
  // option actually reaches `activateApps`: a call to an app NOT in this batch falls through the
  // local-first lookup and is dispatched through the exact instance passed here, not silently
  // dropped or routed elsewhere.
  name: 'start(): SetupOptions.dispatcher is forwarded to activateApps — a ctx.remote() call to ' +
    'an app outside this batch reaches it',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const calls: Array<{ targetAppName: string; operationName: string }> = []
    const fakeDispatcher: HttpRemoteDispatcher = {
      dispatch: (_callerAppName, targetAppName, operationName) => {
        calls.push({ targetAppName, operationName })
        return Promise.resolve({ ok: true })
      },
    }

    const caller = defineZanixApp({
      name: 'zanix-app-remote-caller',
      onStart: async (ctx) => {
        await ctx.remote('zanix-app-remote-unreachable').call(
          'ping',
          {},
          { timeoutMs: 1000 },
        )
      },
    })

    try {
      await Zanix.bootstrap({
        dispatcher: fakeDispatcher,
        apps: { 'zanix-app-remote-caller': { definition: caller } },
      })
      await new Promise((resolve) => setTimeout(resolve, 1000))

      assertEquals(calls, [
        { targetAppName: 'zanix-app-remote-unreachable', operationName: 'ping' },
      ])
    } finally {
      await Zanix.stop()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  // Before `ZanixAppBootstrapOptions.remoteInstances` existed, `start()` hardcoded
  // `activateApps`'s own 5th argument to `undefined` (resolving to `{}`) — a project's
  // `remoteInstances` was silently impossible to express at all, never even reaching
  // `activateApps`'s own validation. This proves it now does: with no `ControlPlaneRegistry`
  // resolvable (no `dispatcher`, `@zanix/app/core` never imported), setting `remoteInstances`
  // rejects with `activateApps`'s own configuration error instead of doing nothing.
  name: 'start(): apps.<name>.remoteInstances is forwarded to activateApps — rejects with its ' +
    'own configuration error when no Control Plane is resolvable, instead of being silently ' +
    'dropped',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const remote = defineZanixApp({ name: 'zanix-app-remote-announced' })

    await assertRejects(
      () =>
        Zanix.bootstrap({
          apps: {
            'zanix-app-remote-announced': {
              definition: remote,
              remoteInstances: { endpoint: 'http://zanix-app-remote-announced:8080' },
            },
          },
        }),
      Error,
      'no ControlPlaneRegistry could be resolved',
    )
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  // `start()` builds `activateApps`'s own `remoteInstances` argument via
  // `Object.fromEntries(zanixApps.filter(([, {remoteInstances}]) => remoteInstances).map(...))` —
  // the test above only ever activates ONE app, so it can't tell a correct filter from a broken one
  // that (for example) forwarded every app in the batch regardless of whether it actually set
  // `remoteInstances`. This proves, from the outside, that only the app which actually set
  // `remoteInstances` gets announced — a sibling app in the same batch that never set it is never
  // registered.
  //
  // Deliberately builds its OWN `ControlPlaneRegistry`/`HttpRemoteAdapter` pair, rather than
  // importing `@zanix/app/core` to use the global `'controlPlane'` provider slot: that provider
  // wraps a process-wide `'cache:redis'` connector singleton every OTHER test in this file also
  // shares (via `Zanix.bootstrap()`'s own core wiring) and `Zanix.stop()` closes for good — reusing
  // it here would make this test's own outcome depend on what ran before it in the same process
  // (confirmed empirically: sharing it broke both this test — a closed client — and the "rejects"
  // test above, since importing `@zanix/app/core` permanently registers the provider for the rest
  // of the process). Passing an `HttpRemoteAdapter` as `dispatcher` bypasses that global slot
  // entirely (`announceConfiguredInstances`'s own `dispatcher instanceof HttpRemoteAdapter` check),
  // with its own independent Redis connection this test fully owns.
  name: 'start(): apps.<name>.remoteInstances only announces the app that actually set it — a ' +
    'sibling app in the same batch with no remoteInstances is never registered',
  fn: async () => {
    Deno.env.set('MONGO_URI', 'mongodb://localhost')
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')

    const registry = new ControlPlaneRegistry(new ZanixRedisConnector())
    const dispatcher = new HttpRemoteAdapter(registry)

    const announcedName = 'zanix-app-remote-mixed-announced'
    const silentName = 'zanix-app-remote-mixed-silent'
    const announced = defineZanixApp({ name: announcedName })
    const silent = defineZanixApp({ name: silentName })

    try {
      await Zanix.bootstrap({
        dispatcher,
        apps: {
          [announcedName]: {
            definition: announced,
            remoteInstances: { endpoint: 'http://localhost:9999' },
          },
          [silentName]: { definition: silent },
        },
      })

      assertEquals(
        (await registry.getDeploymentTarget(announcedName))?.endpoints,
        ['http://localhost:9999'],
      )
      assertEquals(await registry.getDeploymentTarget(silentName), undefined)
    } finally {
      await Zanix.stop()
    }
  },
})
