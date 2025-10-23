import type { SetupOptions } from 'typings/setup.ts'

import {
  ADMIN_GRAPHQL_PORT,
  ADMIN_REST_PORT,
  bootstrapServers,
  type ServerID,
  webServerManager,
} from '@zanix/server'
import { defineAdminMetadata, defineCorelMetadata, defineLocalMetadata } from 'utils/metadata.ts'

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

  // Use to dynamically set the globalPrefix for each server type to the server ID for admin servers
  const globalPrefix = '{{zanix-admin-server-id}}'

  const adminServers = await bootstrapServers({
    rest: {
      globalPrefix,
      port: ADMIN_REST_PORT,
      onCreate: (id: string) => {
        Deno.env.set('ADMIN_REST_SERVER_ID', id)
      },
    },
    graphql: {
      globalPrefix,
      port: ADMIN_GRAPHQL_PORT,
      onCreate: (id: string) => {
        Deno.env.set('ADMIN_GRAPQHL_SERVER_ID', id)
      },
    },
    socket: {
      port: ADMIN_REST_PORT,
      onCreate: (id: string) => {
        Deno.env.set('ADMIN_SOCKET_SERVER_ID', id)
      },
    },
  })

  allServers.push(...adminServers)

  /** Start local servers and define project metadata */

  await defineLocalMetadata()
  const localServers = await bootstrapServers(options.server)

  allServers.push(...localServers)
}

/**
 * Function to stop all servers
 */
export const stop: () => Promise<void> = () => {
  return webServerManager.stop(allServers)
}
