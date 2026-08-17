import { assert } from '@std/assert'
import { stub } from '@std/testing/mock'
import { startWorker, stopWorker } from 'modules/worker.ts'

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'startWorker bootstraps the worker process and stops cleanly on SIGINT',
  fn: async () => {
    const consoleInfo = stub(console, 'info')
    let sigintHandler: (() => void | Promise<void>) | undefined
    const addSignalStub = stub(
      Deno,
      'addSignalListener',
      ((_signal: Deno.Signal, handler: () => void) => {
        sigintHandler = handler
      }) as never,
    )
    const exitStub = stub(Deno, 'exit', (() => {}) as never)

    try {
      const workerPromise = startWorker()

      // Let the bootstrap sequence (onSetup/onBoot/postBoot + the success log) reach the point
      // where it registers the SIGINT listener, before we simulate the signal ourselves.
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (!sigintHandler) return
          clearInterval(interval)
          resolve()
        }, 100)
        setTimeout(() => {
          clearInterval(interval)
          resolve()
        }, 10000)
      })

      assert(
        sigintHandler,
        'SIGINT listener should have been registered by startWorker',
      )
      await sigintHandler?.()
      await workerPromise

      assert(
        consoleInfo.calls.some((call) => `${call.args[1]}`.includes('External worker initialized')),
      )
      assert(
        consoleInfo.calls.some((call) => `${call.args[1]}`.includes('Closing external worker')),
      )
    } finally {
      addSignalStub.restore()
      exitStub.restore()
      consoleInfo.restore()
    }
  },
})

Deno.test('stopWorker closes all connections', async () => {
  await stopWorker()
})
