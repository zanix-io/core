import { collectFiles, getRootDir } from '@zanix/helpers'
import { ZANIX_SERVER_MODULES } from '@zanix/server'
import { setTaskerUrl } from '@zanix/asyncmq/worker'
import { join } from '@std/path'
import { registerPendingTriggerActionJobs } from '../modules/jobs/triggers.ts'
import {
  ASYNCMQ_CORE_SPECIFIER,
  AUTH_CORE_SPECIFIER,
  DATAMASTER_CORE_SPECIFIER,
  NOTIFICATIONS_CORE_SPECIFIER,
} from '../modules/lazy/specifiers.ts'

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

/**
 * Registers every core connector/provider (`@zanix/datamaster`, `@zanix/auth`,
 * `@zanix/notifications`, `@zanix/asyncmq`, each via their own `./core` subpath) — called
 * unconditionally by `start()`/`startWorker()`, so the laziness in the four imports below isn't
 * about skipping the call at runtime, it's about keeping this specifier out of the STATIC module
 * graph: each is a non-literal constant from `lazy/specifiers.ts`, never an inline
 * `import('literal-string')`, so a consumer that only imports `.`/`./bootstrap` to read a type (and
 * never actually calls `start()`/`startWorker()`) never resolves — and so never materializes the
 * npm packages behind — any of the four.
 */
export const defineCoreMetadata = async () => {
  const imports: Promise<unknown>[] = []

  // Loading Zanix datamaster core
  imports.push(import(DATAMASTER_CORE_SPECIFIER))
  // Loading Zanix auth core
  imports.push(import(AUTH_CORE_SPECIFIER))
  // Loading Zanix notifications core — self-registers the built-in `mail` trigger-action job
  // descriptor (see that package's own doc); must finish before the registration below drains it.
  imports.push(import(NOTIFICATIONS_CORE_SPECIFIER))
  // Loading Zanix asyncmq core
  imports.push(import(ASYNCMQ_CORE_SPECIFIER))

  await Promise.all(imports)

  // Registers datamaster's built-in trigger jobs (`request` directly; any other package's
  // self-registered descriptor, e.g. `mail`, via the shared registry) — must run only after every
  // import above has resolved, since those are what populate the registry this drains. See
  // `registerPendingTriggerActionJobs`'s own doc for why the ordering matters.
  registerPendingTriggerActionJobs()
}
