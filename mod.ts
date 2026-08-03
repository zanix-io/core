/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

/**
 * @module
 *
 * `@zanix/core` — the foundational library of the Zanix ecosystem, providing the core
 * configuration layer and entrypoint (`Zanix`) for initializing, configuring, and managing
 * REST/GraphQL/WebSocket servers and background-worker processes in Zanix-based projects. See
 * this package's own README for the full guide, including the built-in admin APIs re-exported
 * from `@zanix/admin`.
 */

import { start, stop } from 'modules/start.ts'
import { startWorker, stopWorker } from 'modules/worker.ts'
import { setup } from 'modules/setup.ts'

// `@zanix/admin` composes the admin domain (roles, protocol version/header + negotiation guard,
// the service-exchange controller, and the protocol clients) — but the actual CRUD/business logic
// behind templates (`TemplatesAdminRepository`/`Service`) and triggers
// (`TriggersAdminRepository`/`Service`) is authored by their real data owners,
// `@zanix/notifications` and `@zanix/datamaster` respectively; `@zanix/admin` only re-exports them.
// Everything below is re-exported here as-is so existing consumers of `@zanix/core`'s public API
// see no change, regardless of which package actually defines each symbol. See `docs/admin-apis.md`
// for the full guide.
export {
  ADMIN_PROTOCOL_HEADER,
  ADMIN_PROTOCOL_SUPPORTED_VERSIONS,
  ADMIN_PROTOCOL_VERSION,
  ADMIN_ROLE,
  ADMIN_TEMPLATES_ROLE,
  ADMIN_TRIGGERS_ROLE,
  createServiceExchangeController,
  CreateTemplateRTO,
  CreateTriggerRTO,
  createTriggersAdminController,
  ServiceExchangeRTO,
  TemplateParamsRTO,
  TemplatesAdminClient,
  TemplatesAdminRepository,
  TemplatesAdminService,
  TriggerModelParamsRTO,
  TriggersAdminClient,
  TriggersAdminRepository,
  TriggersAdminService,
  UpdateTemplateRTO,
  UpdateTriggerRTO,
} from '@zanix/admin'
export type { ConfigOptions } from 'typings/config.ts'
export type {
  AdminBootstrapServerOptions,
  AppBootstrapOptions,
  AppsOptions,
  CodeTemplatesDiscoveryOptions,
  SetupOptions,
} from 'typings/setup.ts'
export type { ErrorLogThrottleConfig, ErrorLogThrottleStore, WebServerTypes } from '@zanix/server'
export type { ElasticsearchLogSaveOptions } from '@zanix/datamaster/observability'
export type { DefaultResponse, LoggerFunctionOptions } from '@zanix/types'

/**
 * `@zanix/admin`'s reference deployable entrypoint — the centralized orchestrator that aggregates
 * `/admin/triggers`/`/admin/templates` across a fleet of `@zanix/core`-based services. Re-exported
 * here so a team that wants both roles (this service's own business API, plus the centralized
 * admin hub) in the same process can do so via `@zanix/core` alone, without a separate import.
 *
 * `ZanixAdminHub.start()` and `Zanix.start()` both resolve their own public REST server's port from
 * the same env-var fallback chain — calling both in the same process without passing distinct
 * ports to at least one of them will fail with `AddrInUse`. See `@zanix/admin`'s own docs for
 * `ZanixAdminHub.start`'s options.
 *
 * Never enable `Zanix.start()`'s own `admin` option in the same process as `ZanixAdminHub.start()` —
 * both would independently register `@zanix/admin` metadata (this service's own triggers/templates/
 * service-token routes here, `ZanixAdminHub`'s own triggers-proxy/templates-store routes there —
 * they're deliberately different route sets, see `docs/admin-apis.md`'s "Architecture" section)
 * against the same shared registry; a runtime guard throws an `InternalError` if you do. Leave
 * `admin` at its default (`false`) when also running `ZanixAdminHub.start()` — see
 * `docs/admin-apis.md`.
 */
export { default as ZanixAdminHub } from '@zanix/admin'

/**
 * Class representing the Zanix server management.
 * This class provides static methods to configure, start, and stop the servers or worker process.
 *
 * - `setup`: Optional cross-cutting configuration (error-log throttling, Elasticsearch/OpenSearch
 *   logging, and `database`/`notifications` env defaults). See {@link setup}'s own doc for timing.
 * - `bootstrap` (aliased as `start`): Initializes the project's web servers and performs additional
 *   configurations. It executes classes based on their `startMode` and initializes internal servers
 *   and dependencies of the library, depending on the handlers defined in the project.
 * - `stop`: Stops all the initialized servers (kills them).
 * - `startWorker`: Alternative entrypoint that bootstraps the process as a standalone AsyncMQ
 *   worker instead of web servers.
 * - `stopWorker`: Closes the worker's connector connections (see {@link stopWorker}'s own doc).
 */
export default class Zanix {
  /**
   * General-purpose, cross-cutting configuration — error-log throttling and Elasticsearch/
   * OpenSearch-backed logging — separate from the HTTP/worker bootstrap itself. The
   * `errorLogThrottle`/`logger` fields are safe to call before, after, or alongside
   * {@link start}/{@link startWorker}; the `database`/`notifications` fields are NOT — they only
   * take effect when called **before** {@link start}/{@link startWorker}. See {@link ConfigOptions}
   * for what each option wires and its env-var fallback.
   *
   * @static
   * @function
   */
  public static setup: typeof setup = setup

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
   * @param {SetupOptions} options - An optional object:
   *   - `server`/`rootDir`: per-web-server-type (`rest`/`graphql`/`socket`) partial configuration
   *     and auto-discovery root(s) for this service's own main app, each server type accepting an
   *     optional `onCreate` callback invoked with the server `id` once it's created.
   *   - `admin`: enables and configures `@zanix/admin`'s built-in triggers/templates/
   *     service-token server(s) — disabled (`false`) by default.
   *   - `apps`: named secondary apps bootstrapped alongside the main one, each on its own
   *     Application. See {@link SetupOptions} and `docs/admin-apis.md` for the full shape.
   */
  public static bootstrap: typeof start = start

  /**
   * Alias for {@link bootstrap}. Bootstraps all configured servers.
   */
  public static start: typeof start = start

  /**
   * Stops all initialized servers and kills the associated processes.
   * This method ensures that all running servers are stopped and resources are freed.
   *
   * @static
   * @function
   */
  public static stop: typeof stop = stop

  /**
   * Bootstraps the current process as a standalone AsyncMQ worker instead of a web server.
   *
   * Loads the same cross-package core dependencies as {@link start} (including `@zanix/datamaster`'s
   * built-in `mail`/`request` trigger job handlers), then hands off to `@zanix/asyncmq`'s own worker
   * bootstrap, and keeps the process alive until stopped.
   *
   * @static
   * @function
   */
  public static startWorker: typeof startWorker = startWorker

  /**
   * Closes all connector connections initialized by the worker process. Does not terminate the
   * process itself — {@link startWorker}'s own process only exits via its `SIGINT` handler.
   *
   * @static
   * @function
   */
  public static stopWorker: typeof stopWorker = stopWorker
}
