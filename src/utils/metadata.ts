import { collectFiles, getRootDir } from '@zanix/helpers'
import { ZANIX_SERVER_MODULES } from '@zanix/server'
import { setTaskerUrl } from '@zanix/asyncmq/worker'
import { join } from '@std/path'
import { defineAdminMetadata as defineAdminControllers } from '@zanix/admin'
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
  dir = '.',
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

/**
 * Loads admin-only route/handler registrations for the admin servers `start.ts` bootstraps.
 *
 * @remarks
 * This package no longer defines any admin-domain code of its own — the full composition logic
 * (which controllers get built, which Application each composes under by default, and the
 * `ADMIN_TRIGGERS_APPLICATION`/`ADMIN_TEMPLATES_APPLICATION` rebinding env vars) now lives in
 * `@zanix/admin`'s own `defineAdminMetadata()`, which this thin wrapper delegates to — see that
 * package's own JSDoc and README ("Admin APIs" section) for the full behavior, and
 * `docs/admin-apis.md` for this env vars' externally-facing documentation. `'core'` identifies this
 * package as the caller to `guardSingleAdminRegistration` (see `@zanix/admin`'s own doc) — the same
 * protection that stops `ZanixAdmin.start()` from registering in the same process.
 */
export const defineAdminMetadata = async (): Promise<void> => {
  await defineAdminControllers('core')
}
