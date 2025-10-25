import type { SetupOptions } from 'typings/setup.ts'

import { defineAdminMetadata, defineCorelMetadata, defineLocalMetadata } from 'utils/metadata.ts'
import logger from '@zanix/logger'
import {
  ADMIN_GRAPHQL_PORT,
  ADMIN_REST_PORT,
  bootstrapServers,
  type ServerID,
  webServerManager,
} from '@zanix/server'

const allServers: ServerID[] = []

/**
 * Main function to start all servers
 * @param options
 */
export const start: (options?: SetupOptions) => Promise<void> = async (
  options: SetupOptions = {},
) => {
  /** Start admin servers at first to reserve ports and define admin/core metadata */

  await Promise.all([defineAdminMetadata(), defineCorelMetadata()])

  const isInternal = true
  const internalServers = await bootstrapServers({
    rest: {
      port: ADMIN_REST_PORT,
      onCreate: (id: string) => {
        Deno.env.set('ADMIN_REST_SERVER_ID', id)
      },
      isInternal,
    },
    graphql: {
      port: ADMIN_GRAPHQL_PORT,
      onCreate: (id: string) => {
        Deno.env.set('ADMIN_GRAPQHL_SERVER_ID', id)
      },
      isInternal,
    },
    socket: {
      port: ADMIN_REST_PORT,
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
    logger.warn('No server was started because the corresponding handlers were not found.')
  }

  allServers.push(...localServers)
}

/**
 * Function to stop all servers
 */
export const stop: () => Promise<void> = () => {
  return webServerManager.stop(allServers)
}
