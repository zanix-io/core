import {
  baseProcessor,
  initWorkerEntrypoint,
  type ProcessorOptions,
  registerInternalProcess,
  workerFileTypes,
} from '@zanix/asyncmq/worker'
import { defineCoreMetadata, defineLocalMetadata } from 'utils/metadata.ts'

// Internal-process worker-thread bootstrap — the file `ZanixCoreWorkerProvider.runTask` (AsyncMQ's
// local, no-AMQP fallback) actually spawns a real Worker thread against, registered via
// `registerWorkerTaskerUrl` (see `utils/metadata.ts`). A spawned thread has its own isolated module
// registry (function references can't cross a `postMessage` boundary), so it must independently
// re-run the same cross-package registration as `start`/`startWorker` — this is why this file, not
// asyncmq's own (which doesn't exist), owns that responsibility.

registerInternalProcess()
await initWorkerEntrypoint(async () => {
  await defineCoreMetadata()
  await defineLocalMetadata('.', workerFileTypes())
})

/**
 * Executes a single dispatched task inside this worker thread — forwards directly to
 * `@zanix/asyncmq`'s own `processor` (re-exported here as `baseProcessor`).
 */
export const processor = (
  options: ProcessorOptions,
): ReturnType<typeof baseProcessor> => baseProcessor(options)
