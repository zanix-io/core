import type { SetupOptions } from 'typings/setup.ts'

import {
  ADMIN_GRAPHQL_PORT,
  ADMIN_REST_PORT,
  GRAPHQL_PORT,
  type ModuleTypes,
  ProgramModule,
  type ServerID,
  SOCKET_PORT,
  webServerManager,
  type ZanixConnector,
} from '@zanix/server'
import { defineAdminMetadata, defineGlobalMetadata, defineLocalMetadata } from 'utils/metadata.ts'

const alreadyInstanced = new Set<string>([])
const currentResolvers: string[] = []
const allServers: ServerID[] = []

const targetModuleInit = (key: string) => {
  if (alreadyInstanced.has(key)) return
  const [type, id] = key.split(':') as [ModuleTypes, string]
  const instance = ProgramModule.targets.getInstance<ZanixConnector>(id, type)
  alreadyInstanced.add(key)
  if (type !== 'connector') return
  return instance.startConnection()
}

/**
 * Function to start specific servers
 * @param server
 */
const startServers = async (
  server: Required<SetupOptions>['server'] = {},
) => {
  const servers: ServerID[] = []
  await Promise.all(ProgramModule.targets.getTargetsByStartMode('onSetup').map(targetModuleInit))

  if (ProgramModule.routes.getRoutes('rest')) {
    const { onCreate, ...opts } = { ...server.rest } as Required<typeof server>['rest']
    const id = webServerManager.create('rest', {
      server: { ...opts, globalPrefix: opts.globalPrefix || 'api' },
    })
    onCreate?.(id)
    servers.push(id)
  }
  if (ProgramModule.routes.getRoutes('socket')) {
    const { onCreate, port, ...opts } = { ...server.socket } as Required<typeof server>['socket']
    const id = webServerManager.create('socket', {
      server: { ...opts, port: port || SOCKET_PORT },
    })
    onCreate?.(id)
    servers.push(id)
  }
  const resolvers = ProgramModule.targets.getTargetsByType('resolver')

  if (resolvers.filter((resolver) => !currentResolvers.includes(resolver)).length) {
    const { onCreate, port, ...opts } = { ...server.graphql } as Required<typeof server>['graphql']
    currentResolvers.push(...resolvers)
    const id = webServerManager.create('graphql', {
      server: { ...opts, port: port || GRAPHQL_PORT, globalPrefix: opts.globalPrefix || 'graphql' },
    })
    onCreate?.(id)
    servers.push(id)
  }

  await Promise.all(ProgramModule.targets.getTargetsByStartMode('onBoot').map(targetModuleInit))

  webServerManager.start(servers)

  await Promise.all(ProgramModule.targets.getTargetsByStartMode('postBoot').map(targetModuleInit))

  allServers.push(...servers)
}

/**
 * Main function to start all servers
 * @param options
 */
export const start: (options?: SetupOptions) => Promise<void> = async (
  options: SetupOptions = {},
) => {
  /** Start admin servers at first to reserve ports */

  await Promise.all([defineAdminMetadata(), defineGlobalMetadata()])

  // Use to dynamically set the globalPrefix for each server type to the server ID for admin servers
  const globalPrefix = '{{zanix-admin-server-id}}'

  await startServers({
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

  /** Start project servers */

  await Promise.all([defineLocalMetadata(), defineGlobalMetadata()])
  await startServers(options.server)

  /** Clear data */

  currentResolvers.length = 0
  alreadyInstanced.clear()
}

/**
 * Function to stop all servers
 */
export const stop: () => Promise<void> = () => {
  return webServerManager.stop(allServers)
}
