import { collectFiles, getRootDir } from '@zanix/helpers/files'
import { ZANIX_SERVER_MODULES } from '@zanix/server'
import { setTaskerUrl } from '@zanix/asyncmq/worker'
import { join } from '@std/path'
import { registerPendingTriggerActionJobs } from '../modules/jobs/triggers.ts'

/**
 * Registers `@zanix/core`'s own internal-process worker-thread bootstrap module
 * (`modules/tasker.ts`) as AsyncMQ's tasker URL (see `@zanix/asyncmq`'s `setTaskerUrl`), so that
 * `ZanixCoreWorkerProvider.runTask`'s local (no-AMQP) fallback spawns a thread that runs
 * {@link defineCoreMetadata} too — otherwise cross-package job handlers (e.g. datamaster's
 * mail/request triggers) would never register inside that isolated thread. Called once, early, by
 * both {@link start} and `startWorker` — `runTask` can fire from either process type.
 */
export const registerWorkerTaskerUrl = (): void => {
  setTaskerUrl(import.meta.resolve('../modules/tasker.ts'))
}

export const defineLocalMetadata = async (
  dir: string | string[] = '.',
  types = ZANIX_SERVER_MODULES,
) => {
  const imports: Promise<unknown>[] = []

  const rootFilePath = `file://${getRootDir()}`
  collectFiles(dir, types, (path) => {
    imports.push(import(join(rootFilePath, path)))
  })

  await Promise.all(imports)
}

export const defineCoreMetadata = async () => {
  const imports: Promise<unknown>[] = []

  // Loading Zanix datamaster core
  imports.push(import('@zanix/datamaster/core'))
  // Loading Zanix auth core
  imports.push(import('@zanix/auth/core'))
  // Loading Zanix notifications core — self-registers the built-in `mail` trigger-action job
  // descriptor (see that package's own doc); must finish before the registration below drains it.
  imports.push(import('@zanix/notifications/core'))
  // Loading Zanix asyncmq core
  imports.push(import('@zanix/asyncmq/core'))

  await Promise.all(imports)

  // Registers datamaster's built-in trigger jobs (`request` directly; any other package's
  // self-registered descriptor, e.g. `mail`, via the shared registry) — must run only after every
  // import above has resolved, since those are what populate the registry this drains. See
  // `registerPendingTriggerActionJobs`'s own doc for why the ordering matters.
  registerPendingTriggerActionJobs()
}
