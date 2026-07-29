import { collectFiles, getRootDir } from '@zanix/helpers'
import { ZANIX_SERVER_MODULES } from '@zanix/server'
import { setTaskerUrl } from '@zanix/asyncmq/worker'
import { join } from '@std/path'
import { isDatabaseTemplatesDisabled, TEMPLATES_MODEL_ENV } from '@zanix/notifications'
import { isTriggersModelDisabled } from '@zanix/database'
import {
  createServiceExchangeController,
  createTemplatesController,
  createTriggersAdminController,
} from '@zanix/admin'
import { ADMIN_TEMPLATES_ISINTERNAL_ENV, ADMIN_TRIGGERS_ISINTERNAL_ENV } from './constants.ts'

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

export const defineExtraMetadata = (imports: Promise<unknown>[]) => {
  // Registering datamaster's built-in trigger jobs (mail/request)
  imports.push(import('../modules/jobs/triggers.ts'))
}

export const defineCoreMetadata = async () => {
  const imports: Promise<unknown>[] = []

  // Loading Zanix datamaster core
  imports.push(import('@zanix/datamaster/core'))
  // Loading Zanix auth core
  imports.push(import('@zanix/auth/core'))
  // Loading Zanix notifications core
  imports.push(import('@zanix/notifications/core'))
  // Loading Zanix asyncmq core
  imports.push(import('@zanix/asyncmq/core'))

  defineExtraMetadata(imports)

  await Promise.all(imports)
}

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

/**
 * Loads admin-only route/handler registrations for the internal servers `start.ts` bootstraps
 * (`ADMIN_REST_PORT`/`ADMIN_GRAPHQL_PORT`/`ADMIN_SOCKET_PORT`).
 *
 * @remarks
 * `@zanix/server`'s route registry now supports `isInternal` at the route level (a
 * `@Controller`/`@Socket`/`@Resolver` opts in via its own `isInternal: true` option), so a route
 * registered here is mounted only on the internal server, never the public one — this is what
 * makes the two admin APIs below possible.
 *
 * All three controllers are built by `@zanix/admin`'s own factories (this package no longer
 * defines any admin-domain code of its own) — see that package's README, "Admin APIs" section.
 *
 * - The triggers admin API (`/admin/triggers`) is registered unless `@zanix/datamaster`'s
 *   persisted triggers module was explicitly disabled (`TRIGGERS_MODEL_NAME=false`) — it's on by
 *   default. `isInternal` defaults to `true`; override via `ADMIN_TRIGGERS_ISINTERNAL=false` — see
 *   `@zanix/admin`'s `createTriggersAdminController`.
 * - The templates admin API (`/admin/templates`) is registered only once the app has opted into
 *   DB-backed templates (`DATABASE_TEMPLATES=true` or `TEMPLATES_MODEL_NAME` set) — see
 *   `@zanix/notifications`'s `docs/templates.md` for the per-service vs. shared storage decision
 *   this depends on. `isInternal` defaults to `true`; override via
 *   `ADMIN_TEMPLATES_ISINTERNAL=false` — see `@zanix/admin`'s `createTemplatesController` (called
 *   here with a fixed `prefix: 'admin/templates'`).
 * - The service-credential exchange API (`/admin/service-token`) is always registered — safe by
 *   default, since it rejects any caller without a registered `JWK_PUB_<serviceId>` regardless.
 *   See `@zanix/auth`'s `docs/service-credential.md`.
 */
// Kept alive deliberately: unlike a module-level `export class X {}` (always reachable through its
// own module's exports for the life of the process), a class produced by a factory and only ever
// referenced by a local variable has no other strong reference once that variable goes out of
// scope — `@zanix/server`'s target registry resolves instances via a `WeakMap` keyed by class
// reference (see `getTargetKey`), so a garbage-collected class silently stops dispatching, with no
// error at registration OR request time. Confirmed empirically: routes vanished from every server's
// route table (not just failed at request time) the moment nothing else held the created class.
const registeredAdminControllers: unknown[] = []

export const defineAdminMetadata = (): void => {
  const controllers: unknown[] = [createServiceExchangeController()]

  if (!isTriggersModelDisabled()) {
    controllers.push(
      createTriggersAdminController({
        isInternal: Deno.env.get(ADMIN_TRIGGERS_ISINTERNAL_ENV) !== 'false',
      }),
    )
  }
  if (Deno.env.get(TEMPLATES_MODEL_ENV) && !isDatabaseTemplatesDisabled()) {
    controllers.push(
      createTemplatesController({
        isInternal: Deno.env.get(ADMIN_TEMPLATES_ISINTERNAL_ENV) !== 'false',
        prefix: 'admin/templates',
      }),
    )
  }

  registeredAdminControllers.push(...controllers)
}
