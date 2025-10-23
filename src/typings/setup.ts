import type { BootstrapServerOptions } from '@zanix/server'

/**
 * Configuration options used to set up server instances for various web server types and bootstrap the `Zanix` project
 *
 * This type allows partial configuration of one or more supported server types: `'graphql'`, `'rest'`, and `'socket'`.
 *
 * @property {BootstrapServerOptions} [server] - An optional object where each key is a web server type (`'graphql'`, `'rest'`, or `'socket'`),
 * and the value is a partial server configuration specific to that type.
 */
export type SetupOptions = {
  server?: BootstrapServerOptions
}
