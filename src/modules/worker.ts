import { attachGlobalErrorHandlers, closeAllConnections } from '@zanix/server'
import {
  initWorkerEntrypoint,
  registerExtraProcessQueues,
  workerFileTypes,
} from '@zanix/asyncmq/worker'
import { defineCoreMetadata, defineLocalMetadata, registerWorkerTaskerUrl } from 'utils/metadata.ts'
import logger from '@zanix/logger'

/**
 * Bootstraps the current process as a standalone AsyncMQ worker instead of a web server.
 *
 * Runs the full worker bootstrap sequence directly (no HTTP servers involved):
 * - Attaches global error handlers.
 * - Registers `@zanix/core`'s own internal-process worker-thread bootstrap module as AsyncMQ's
 *   tasker URL ({@link registerWorkerTaskerUrl}), so `ZanixCoreWorkerProvider.runTask`'s local
 *   (no-AMQP) fallback also registers this app's cross-package job handlers correctly.
 * - Registers AsyncMQ's own extra-process queue subscribers ({@link registerExtraProcessQueues} —
 *   this is also what marks the process as AsyncMQ's `extra-process` execution mode; that's
 *   AsyncMQ's own contract to own, not something this function needs to know the literal value of).
 * - Runs the shared worker entrypoint lifecycle (`initWorkerEntrypoint`): loads the same
 *   cross-package core dependencies as {@link start} (`defineCoreMetadata` — this is what
 *   registers `@zanix/datamaster`'s built-in `mail`/`request` trigger jobs, and
 *   `@zanix/notifications`'s SMTP connector, in the worker process too, not just the main server
 *   process), the project's own connector/interactor/handler/defs files
 *   ({@link defineLocalMetadata}), then `onSetup`/`onBoot`/`postBoot` and metadata cleanup.
 * - Keeps the process alive until a `SIGINT`/`SIGTERM` is received.
 *
 * @static
 * @function
 */
export const startWorker: () => Promise<void> = async () => {
  attachGlobalErrorHandlers(self)

  self.addEventListener('unload', async () => {
    await closeAllConnections()
  })

  registerWorkerTaskerUrl()
  await registerExtraProcessQueues()
  await initWorkerEntrypoint(async () => {
    await defineCoreMetadata()
    await defineLocalMetadata('.', workerFileTypes())
  })

  logger.success('External worker initialized...')

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      logger.info('Closing external worker...', 'noSave')

      Deno.removeSignalListener('SIGINT', shutdown)
      Deno.removeSignalListener('SIGTERM', shutdown)

      await closeAllConnections()
      resolve()
      Deno.exit(0)
    }

    Deno.addSignalListener('SIGINT', shutdown)
    Deno.addSignalListener('SIGTERM', shutdown)
  })
}

/**
 * Closes all connector connections initialized by the worker process. Does not terminate the
 * process itself — {@link startWorker}'s own process only exits via its `SIGINT`/`SIGTERM`
 * handler.
 *
 * @static
 * @function
 */
export const stopWorker: () => Promise<void> = () => {
  return closeAllConnections()
}
