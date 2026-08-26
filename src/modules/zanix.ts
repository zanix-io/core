import { compose, start, stop } from './start.ts'
import { startWorker, stopWorker } from './worker.ts'
import { getAssetsService, setup } from './setup.ts'

/**
 * `Zanix` on its own, apart from root `mod.ts`'s own admin-domain re-exports (the `@zanix/admin`/
 * `@zanix/notifications`/`@zanix/datamaster` RTOs, clients, and `ZanixAdminHub` — see
 * `admin-domain.ts`) — this subpath exists to avoid a real cost: a consumer that wants only the
 * "just embed Zanix" shortcut and resolves it through
 * the root barrel forces resolution of that barrel's OTHER re-exports too, which reach Handlebars
 * (via `TemplatesAdminRepository`/`TemplatesAdminService`) and `mongoose`/`redis` (via
 * `TriggersAdminRepository`/`TriggersAdminService`) unconditionally, regardless of whether this
 * project ever configures `admin`/`codeTemplatesDiscovery`. `start.ts`'s own
 * `@zanix/admin` dependency (`createTemplatesDiscoveryGuard`/`defineLocalAdminApp`/
 * `getLocalAdminSubApps`) is itself resolved lazily (see `lazy-specifiers.ts`), gated behind the
 * matching option actually being passed — so importing ONLY this subpath, never the root, is what
 * actually lets a deployment with `admin`/`codeTemplatesDiscovery` both disabled skip
 * `@zanix/admin`'s bare-root barrel (and everything it bundles) entirely. Root `.` still re-exports
 * this same class as its own default export — existing `import Zanix from '@zanix/core'` call sites
 * are unaffected; this subpath is for the caller that wants the "just embed Zanix" shortcut and
 * nothing else the root barrel bundles alongside it.
 *
 * @module
 */

/**
 * Class representing the Zanix server management.
 * This class provides static methods to configure, start, and stop the servers or worker process.
 *
 * - `setup`: Optional cross-cutting configuration (error-log throttling, uncaught-error monitoring,
 *   Elasticsearch/OpenSearch-backed logging, `database`/`notifications`/`dlq` env defaults, and
 *   `assets` real-infrastructure construction) — async, `await` it before relying on
 *   `getAssetsService`'s result. See {@link setup}'s own doc for timing.
 * - `getAssetsService`: Reads back the value `setup`'s own `assets` option constructed (see
 *   {@link getAssetsService}'s own doc).
 * - `bootstrap` (aliased as `start`): Initializes the project's web servers and performs additional
 *   configurations. It executes classes based on their `startMode` and initializes internal servers
 *   and dependencies of the library, depending on the handlers defined in the project. Also traps
 *   `SIGINT`/`SIGTERM` automatically (no opt-out) — either signal runs `stop` before exiting,
 *   instead of the process dying mid-request the moment an orchestrator sends its default stop
 *   signal.
 * - `compose`: Registers this project's own decorator metadata without starting any server or
 *   activating any real infrastructure, for a process that only needs to introspect what
 *   `bootstrap` WOULD register (see {@link compose}'s own doc).
 * - `stop`: Stops all the initialized servers (kills them), then closes connector connections.
 * - `startWorker`: Alternative entrypoint that bootstraps the process as a standalone AsyncMQ
 *   worker instead of web servers.
 * - `stopWorker`: Closes the worker's connector connections (see {@link stopWorker}'s own doc).
 */
export default class Zanix {
  /**
   * General-purpose, cross-cutting configuration — error-log throttling/uncaught-error monitoring
   * and Elasticsearch/OpenSearch-backed logging — separate from the HTTP/worker bootstrap itself.
   * The `errors`/`logger` fields are safe to call before, after, or alongside {@link start}/
   * {@link startWorker}; the `database`/`notifications`/`dlq`/`assets` fields are NOT — they only
   * take effect when called **before** {@link start}/{@link startWorker}. See {@link ConfigOptions}
   * for what each option wires and its env-var fallback.
   *
   * Returns a `Promise` — `await` it before calling {@link getAssetsService} when passing
   * `assets`; every other field completes synchronously with no `await` in its own path, so a
   * caller that never passes `assets` sees the same synchronous-completion behavior an unawaited
   * call already had.
   *
   * @static
   * @function
   */
  public static setup: typeof setup = setup

  /**
   * Reads back the value {@link setup}'s own `assets` option constructed — `undefined` if
   * `setup()` was never called with an `assets` block. Typed `unknown`, not the real
   * `AssetService`: recovering that type here would require resolving `@zanix/space/assets-api`'s
   * module graph (and transitively `sharp`/`svgo`) for every consumer of `@zanix/core`, whether or
   * not they use the Asset API. A caller that needs the real type already imports
   * `@zanix/space/assets-api` for real (to call `defineSpaceApp({ assetsApi: {...} })`), so
   * recovering it is a plain cast at that call site — see `getAssetsService`'s own doc
   * (`setup.ts`) for a worked example. See `ConfigOptions.assets`'s own doc for the full
   * composition this builds and why.
   *
   * @static
   * @function
   */
  public static getAssetsService: typeof getAssetsService = getAssetsService

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
   *   - `admin`: enables and configures `@zanix/admin`'s built-in triggers/templates/dlq/
   *     service-token server(s) — disabled (`false`) by default.
   *   - `apps`: named secondary apps bootstrapped alongside the main one, each on its own
   *     Application. See {@link SetupOptions} and `docs/admin-apis.md` for the full shape.
   *
   * A successful call also registers a `SIGINT`/`SIGTERM` handler (no opt-out) that runs {@link stop}
   * before exiting — draining in-flight HTTP requests via `Deno.serve()`'s own `.shutdown()` and
   * closing connector connections, instead of the process dying immediately on an orchestrator's
   * default stop signal (Docker, Kubernetes, ...).
   */
  public static bootstrap: typeof start = start

  /**
   * Alias for {@link bootstrap}. Bootstraps all configured servers.
   */
  public static start: typeof start = start

  /**
   * Registers this project's own decorator metadata (cross-package core provider/connector slots
   * plus this project's own auto-discovered handlers) without starting any server or activating
   * any real infrastructure — the same registration {@link bootstrap} performs before it actually
   * boots. Safe to call from a process that only needs to introspect what {@link bootstrap} WOULD
   * register (e.g. a static analysis tool reading `@zanix/server`'s
   * `ProgramModule.routes.getRoutes('rest')` afterward), without booting anything.
   * `options.admin: true` additionally registers `@zanix/admin`'s built-in local admin app/
   * sub-apps' routes too (verified safe — see {@link ComposeOptions.admin}'s own doc). Still
   * deliberately excludes `apps` composition — see `compose`'s own doc comment
   * (`start.ts`) for why.
   *
   * @static
   * @function
   */
  public static compose: typeof compose = compose

  /**
   * Stops all initialized servers and kills the associated processes, then closes connector
   * connections (`closeAllConnections()`) — this method ensures that all running servers are
   * stopped and resources are freed. Also called automatically on `SIGINT`/`SIGTERM` if
   * {@link bootstrap} registered a handler for them.
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
   * process itself — {@link startWorker}'s own process only exits via its `SIGINT`/`SIGTERM`
   * handler.
   *
   * @static
   * @function
   */
  public static stopWorker: typeof stopWorker = stopWorker
}
