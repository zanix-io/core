import type { SetupOptions } from 'typings/setup.ts'

import {
  defineAdminMetadata,
  defineCoreMetadata,
  defineLocalMetadata,
  registerWorkerTaskerUrl,
} from 'utils/metadata.ts'
import logger from '@zanix/logger'
import {
  ADMIN_GRAPHQL_PORT,
  ADMIN_REST_PORT,
  ADMIN_SOCKET_PORT,
  bootstrapServers,
  type ServerID,
  webServerManager,
} from '@zanix/server'

const allServers: ServerID[] = []

/**
 * Main function to start all servers
 * @param options
 *
 * @remarks
 * The admin/internal `bootstrapServers` call below (`isInternal: true`) mounts only the routes
 * `defineAdminMetadata()` registers with a matching `isInternal: true` (the built-in triggers/
 * templates admin APIs) — `@zanix/server`'s route registry partitions routes by `isInternal` per
 * route/resolver, so these never leak onto the public `bootstrapServers` call further down, and
 * the public app's own routes never leak onto this internal server either. The `rest` sub-server
 * only actually gets created once `defineAdminMetadata()` registers at least one `isInternal: true`
 * REST route (currently: the triggers API always, the templates API when DB-backed templates are
 * enabled) — if neither is active, `internalServers` stays empty, same as before.
 */
export const start: (options?: SetupOptions) => Promise<void> = async (
  options: SetupOptions = {},
) => {
  /** Start admin servers at first to reserve ports and define admin/core metadata */

  registerWorkerTaskerUrl()
  await Promise.all([defineAdminMetadata(), defineCoreMetadata()])

  // Read at call time (not module top-level) so a caller/test setting the env var right before
  // `start()` runs is actually observed — see `ADMIN_SERVER_ID` in docs/admin-apis.md.
  // Unset by default: a random per-boot id is the safer default (rotates on its own, nothing to
  // leak); only worth pinning once an external caller (e.g. a future `zanix-admin`) needs a stable
  // address to reach this service's admin API at. Suffixed per server type so the three internal
  // servers never collide even if an operator configures them onto the same port (see
  // `@zanix/server`'s shared-port serving).
  const adminServerId = Deno.env.get('ADMIN_SERVER_ID')

  const isInternal = true
  const internalServers = await bootstrapServers({
    rest: {
      port: ADMIN_REST_PORT,
      id: adminServerId ? `${adminServerId}-rest` : undefined,
      onCreate: (id: string) => {
        Deno.env.set('ADMIN_REST_SERVER_ID', id)
      },
      isInternal,
    },
    graphql: {
      port: ADMIN_GRAPHQL_PORT,
      id: adminServerId ? `${adminServerId}-graphql` : undefined,
      onCreate: (id: string) => {
        Deno.env.set('ADMIN_GRAPQHL_SERVER_ID', id)
      },
      isInternal,
    },
    socket: {
      port: ADMIN_SOCKET_PORT,
      id: adminServerId ? `${adminServerId}-socket` : undefined,
      onCreate: (id: string) => {
        Deno.env.set('ADMIN_SOCKET_SERVER_ID', id)
      },
      isInternal,
    },
  })

  allServers.push(...internalServers)

  /** Start local servers and define project metadata */

  await defineLocalMetadata()
  const localServers = await bootstrapServers(options.server)

  if (!localServers.length) {
    logger.warn(
      'No server was started because the corresponding handlers were not found.',
      'noSave',
    )
  }

  allServers.push(...localServers)
}

/**
 * Function to stop all servers
 */
export const stop: () => Promise<void> = () => {
  return webServerManager.stop(allServers)
}
