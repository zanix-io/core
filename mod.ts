/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { start, stop } from 'modules/start.ts'

/**
 * Class representing the Zanix server management.
 * This class provides static methods to start and stop the servers.
 *
 * - `start`: Initializes the project servers and performs additional configurations.
 *   It executes classes based on their `startMode` and initializes internal servers
 *   and dependencies of the library, depending on the handlers defined in the project.
 *
 * - `stop`: Stops all the initialized servers (kills them).
 */
export default class Zanix {
  /**
   * Initializes the project servers, performs additional configurations,
   * and executes classes based on their `startMode`.
   * Depending on the handlers created in the project, this method will:
   * - Initialize necessary servers and internal dependencies for the project to run.
   * - Execute classes in accordance with their `startMode`.
   * - Perform other required initial configurations to ensure the system is ready.
   *
   * @static
   * @function
   * @param {SetupOptions} options - An optional object `SetupOptions` where each key is a web server type,
   * and the value is a partial server configuration specific to that type.
   *   - It extends the `server` property from `ServerManagerOptions<T>`, where `T` is the server type.
   *   - Additionally, it allows an optional `onCreate` callback that is invoked with a server `id` when the server is created.
   */
  public static bootstrap = start

  /**
   * Alias for {@link bootstrap}. Bootstraps all configured servers.
   */
  public static start = start

  /**
   * Stops all initialized servers and kills the associated processes.
   * This method ensures that all running servers are stopped and resources are freed.
   *
   * @static
   * @function
   */
  public static stop = stop
}
