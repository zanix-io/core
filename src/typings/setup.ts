import type { ServerManagerOptions, WebServerTypes } from '@zanix/server'

/**
 * Configuration options used to set up server instances for various web server types.
 *
 * This type allows partial configuration of one or more supported server types: `'graphql'`, `'rest'`, and `'socket'`.
 *
 * @property {Object} [server] - An optional object where each key is a web server type (`'graphql'`, `'rest'`, or `'socket'`),
 * and the value is a partial server configuration specific to that type.
 *
 * For each server type:
 * - It extends the `server` property from `ServerManagerOptions<T>`, where `T` is the server type.
 * - Additionally, it allows an optional `onCreate` callback that is invoked with a server `id` when the server is created.
 *
 * Example:
 * ```ts
 * {
 *   server: {
 *     graphql: {
 *       globalPrefix: '/api',
 *       onCreate: (id) => console.log(`GraphQL server started with ID ${id}`)
 *     },
 *     socket: {
 *       port: 3001,
 *       onCreate: (id) => console.log(`Socket server started with ID ${id}`)
 *     }
 *   }
 * }
 * ```
 */
export type SetupOptions = {
  server?: Partial<
    {
      [K in WebServerTypes]: ServerManagerOptions<K>['server'] & {
        onCreate?: (id: string) => void
      }
    }
  >
}
