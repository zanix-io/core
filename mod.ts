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

import { compose, start, stop } from 'modules/start.ts'
import { startWorker, stopWorker } from 'modules/worker.ts'
import { getAssetsService, setup } from 'modules/setup.ts'

// `@zanix/admin` composes the admin domain (roles, protocol version/header + negotiation guard,
// the service-exchange controller, and the protocol clients); the local-api CRUD controllers and
// their RTOs are authored by their real data owners, `@zanix/notifications` and `@zanix/datamaster`
// (triggers, templates, and — as of `@zanix/admin@^2.0.0` — DLQ alike) — see `docs/admin-apis.md`
// for the full guide, and the "Local API vs Aggregator API" rule in the `zanix-libraries-architecture`
// skill.
export {
  ADMIN_DLQ_ROLE,
  ADMIN_PROTOCOL_HEADER,
  ADMIN_PROTOCOL_SUPPORTED_VERSIONS,
  ADMIN_PROTOCOL_VERSION,
  ADMIN_ROLE,
  ADMIN_TEMPLATES_ROLE,
  ADMIN_TRIGGERS_ROLE,
  createServiceExchangeController,
  DlqAdminClient,
  ServiceExchangeRTO,
  TemplatesAdminClient,
  TemplatesAdminRepository,
  TemplatesAdminService,
  TriggersAdminClient,
  TriggersAdminRepository,
  TriggersAdminService,
} from '@zanix/admin'
export {
  CreateTemplateRTO,
  TemplateParamsRTO,
  UpdateTemplateRTO,
} from '@zanix/notifications/templates-api'
export {
  CreateTriggerRTO,
  createTriggersAdminController,
  TriggerModelParamsRTO,
  UpdateTriggerRTO,
} from '@zanix/datamaster/triggers-api'
/**
 * `/admin/dlq`'s local-api CRUD controller and its RTOs — same "re-exported from the real data
 * owner unchanged" shape as triggers'/templates' own blocks above, one domain over.
 * `createDlqAdminController` builds the built-in `/admin/dlq` controller; the RTOs are its
 * request/response shapes. Opt-in — only registered once `DLQ_MODEL_NAME` is set (see
 * `docs/admin-apis.md`).
 */
export {
  createDlqAdminController,
  DiscardDLQEntryRTO,
  DLQEntryIdParamsRTO,
  ListDLQEntriesRTO,
  PushDLQEntryRTO,
  RequeueDLQEntryRTO,
} from '@zanix/datamaster/dlq-api'
export type { ConfigOptions } from 'typings/config.ts'
export type {
  AdminBootstrapServerOptions,
  AppsOptions,
  CodeTemplatesDiscoveryOptions,
  ComposeOptions,
  SetupOptions,
  ZanixAppBootstrapOptions,
} from 'typings/setup.ts'
export type { ErrorLogThrottleConfig, ErrorLogThrottleStore, WebServerTypes } from '@zanix/server'
export type { ElasticsearchLogSaveOptions } from '@zanix/datamaster/observability'
export type { DefaultResponse, LoggerFormatter, LoggerFunctionOptions } from '@zanix/types'
// Re-exported (type-only) because `Zanix.setup`'s own `ConfigOptions.assets` and
// `Zanix.getAssetsService`'s return type both reference it — same "every type reachable from a
// public export must itself be public" doc-lint rule this file's other re-exports already follow.
// `AssetRecord`/`CreateAssetCommand` are re-exported alongside it for the same reason one level
// down: `AssetService.createAsset()` itself references both — and `AssetKind`/`AssetStatus`/
// `AssetVariant`(+ its 4 kind-specific members)/`AssetTransformRequest`/`UploadedAsset` one level
// further, since `AssetRecord`/`CreateAssetCommand` themselves reference those. `AssetTransformRequest`
// itself references two more (`VoiceAudioTransformOptions`, transitively `VoiceAudioFormat`;
// `VideoBreakpointName`) — fixed upstream in `@zanix/space/assets-api`'s own `mod.ts` (it wasn't
// re-exporting them from its own entrypoint either, a real pre-existing bug there, now fixed) and
// re-exported one level further here for the same reason as everything else in this block.
// `@zanix/space`'s own `AssetServiceOptions.transformer` -> `AssetTransformer` doc-lint error is
// NOT part of this chain — `AssetServiceOptions` is never re-exported from this file at all, so it
// never surfaces here; left as-is upstream (chasing it would mean re-exporting the entire
// image/video/audio transform type graph into a subpath that deliberately keeps that surface
// siloed in `@zanix/space/assets` instead).
export type {
  AssetKind,
  AssetRecord,
  AssetService,
  AssetStatus,
  AssetTransformRequest,
  AssetVariant,
  AssetVariantBase,
  AudioAssetVariant,
  CreateAssetCommand,
  ImageAssetVariant,
  ThumbnailAssetVariant,
  UploadedAsset,
  VideoAssetVariant,
  VideoBreakpointName,
  VoiceAudioFormat,
  VoiceAudioTransformOptions,
} from '@zanix/space/assets-api'

/**
 * `@zanix/admin`'s reference deployable entrypoint — the centralized orchestrator that aggregates
 * `/admin/triggers`/`/admin/templates`/`/admin/dlq` across a fleet of `@zanix/core`-based services.
 * Re-exported here so a team that wants both roles (this service's own business API, plus the
 * centralized admin hub) in the same process can do so via `@zanix/core` alone, without a separate
 * import.
 *
 * `ZanixAdminHub.start()` and `Zanix.start()` both resolve their own public REST server's port from
 * the same env-var fallback chain — calling both in the same process without passing distinct
 * ports to at least one of them will fail with `AddrInUse`. See `@zanix/admin`'s own docs for
 * `ZanixAdminHub.start`'s options.
 *
 * Safe to also enable `Zanix.start()`'s own `admin` option in the same process as
 * `ZanixAdminHub.start()` — there is no runtime guard against this, and none is needed: the two
 * register `@zanix/admin` metadata under distinct Applications (this service's own triggers/
 * templates/dlq/service-token routes under `ADMIN_APPLICATION`, `ZanixAdminHub`'s own
 * triggers-proxy/templates-store/dlq-proxy routes under its own `ADMIN_HUB_APPLICATION` —
 * deliberately different route sets, see `docs/admin-apis.md`'s "Architecture" section), so
 * neither's routes collide with or overwrite the other's, in either call order, even without an
 * `await` between them. See `core/src/@tests/functional/admin-hub-coexistence*.test.ts` for the
 * regression coverage, and `docs/admin-apis.md` for the full breakdown.
 */
export { default as ZanixAdminHub } from '@zanix/admin'

/**
 * Class representing the Zanix server management.
 * This class provides static methods to configure, start, and stop the servers or worker process.
 *
 * - `setup`: Optional cross-cutting configuration (error-log throttling, uncaught-error monitoring,
 *   Elasticsearch/OpenSearch-backed logging, `database`/`notifications`/`dlq` env defaults, and
 *   `assets` real-infrastructure construction). See {@link setup}'s own doc for timing.
 * - `getAssetsService`: Reads back the `AssetService` `setup`'s own `assets` option constructed
 *   (see {@link getAssetsService}'s own doc).
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
   * @static
   * @function
   */
  public static setup: typeof setup = setup

  /**
   * Reads back the `AssetService` {@link setup}'s own `assets` option constructed —
   * `undefined` if `setup()` was never called with an `assets` block. See
   * `ConfigOptions.assets`'s own doc for the full composition this builds and why.
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
   * (`modules/start.ts`) for why.
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
