import { assert, assertEquals } from '@std/assert'
import { assertSpyCalls, spy, stub } from '@std/testing/mock'
import { WebServerManager } from '@zanix/server'
import { defineZanixApp } from '@zanix/app'
import Zanix from '../../../mod.ts'

/**
 * Real `Deno.addSignalListener`/`Deno.removeSignalListener`/`Deno.exit` calls are stubbed the
 * SAME way `worker.test.ts` already stubs them for `startWorker` — capturing the real handler
 * `start()` registers, invoking it directly instead of sending an actual OS signal (a real signal
 * sent to a running `deno test` process is unlikely to route through this listener anyway, since
 * `deno test`'s own CLI intercepts SIGINT for its own purposes).
 */
function stubSignals() {
  const handlers = new Map<string, () => void | Promise<void>>()
  const removed: string[] = []
  const addSignalStub = stub(
    Deno,
    'addSignalListener',
    ((signal: Deno.Signal, handler: () => void) => {
      handlers.set(signal, handler)
    }) as never,
  )
  const removeSignalStub = stub(
    Deno,
    'removeSignalListener',
    ((signal: Deno.Signal) => {
      removed.push(signal)
    }) as never,
  )
  const exitStub = stub(Deno, 'exit', (() => {}) as never)

  return {
    handlers,
    removed,
    exitStub,
    restore: () => {
      addSignalStub.restore()
      removeSignalStub.restore()
      exitStub.restore()
    },
  }
}

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'SIGTERM triggers Zanix.stop() and exits cleanly, without a real Deno.exit',
  fn: async () => {
    const consoleInfo = stub(console, 'info')
    const signals = stubSignals()

    try {
      await Zanix.bootstrap({ server: { rest: {} } })

      const sigterm = signals.handlers.get('SIGTERM')
      assert(
        sigterm,
        'SIGTERM listener should have been registered by start()',
      )
      assert(
        signals.handlers.get('SIGINT'),
        'SIGINT listener should have been registered too',
      )

      await sigterm()

      assert(
        signals.removed.includes('SIGINT') &&
          signals.removed.includes('SIGTERM'),
      )
      assertSpyCalls(signals.exitStub, 1)
      assertEquals(signals.exitStub.calls[0].args[0], 0)
    } finally {
      signals.restore()
      consoleInfo.restore()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'Zanix.stop() called twice in a row does not throw removing an already-removed listener',
  fn: async () => {
    const consoleInfo = stub(console, 'info')
    const signals = stubSignals()

    try {
      await Zanix.bootstrap({ server: { rest: {} } })

      await Zanix.stop()
      await Zanix.stop() // must not throw

      // The second call found no listener to remove — only the first call's removal is recorded.
      assertEquals(signals.removed.filter((s) => s === 'SIGTERM').length, 1)
    } finally {
      signals.restore()
      consoleInfo.restore()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    "Zanix.stop() called twice in a row does not re-run a Zanix App's onStop hook a second time",
  fn: async () => {
    const consoleInfo = stub(console, 'info')
    const onStop = spy(() => {})

    try {
      const app = defineZanixApp({
        name: 'zanix-app-double-stop',
        routes: false,
        onStop,
      })

      await Zanix.bootstrap({
        apps: { 'zanix-app-double-stop': { definition: app } },
      })

      await Zanix.stop()
      await Zanix.stop() // must not re-run `onStop` a second time

      assertSpyCalls(onStop, 1)
    } finally {
      consoleInfo.restore()
    }
  },
})

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'Zanix.stop() failing during a signal-triggered shutdown still exits, with code 1',
  fn: async () => {
    const consoleInfo = stub(console, 'info')
    const consoleError = stub(console, 'error')
    const signals = stubSignals()

    try {
      await Zanix.bootstrap({ server: { rest: {} } })

      // `webServerManager` itself is `Object.freeze`d (a module-level singleton) — `stop` isn't
      // one of its own properties, it lives on the class prototype, which isn't frozen, so it's
      // stubbed there instead.
      const stopStub = stub(
        WebServerManager.prototype,
        'stop',
        () => Promise.reject(new Error('boom')),
      )

      try {
        const sigterm = signals.handlers.get('SIGTERM')
        assert(sigterm)
        await sigterm()

        assertSpyCalls(signals.exitStub, 1)
        assertEquals(signals.exitStub.calls[0].args[0], 1)
      } finally {
        stopStub.restore()
      }
    } finally {
      signals.restore()
      consoleInfo.restore()
      consoleError.restore()
    }
  },
})
