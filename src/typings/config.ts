import type {
  ErrorLogThrottleConfig,
  ErrorLogThrottleStore,
  UncaughtErrorMonitorConfig,
} from '@zanix/server'
import type { ElasticsearchLogSaveOptions } from '@zanix/datamaster/observability'
import type { DefaultResponse, LoggerFormatter, LoggerFunctionOptions } from '@zanix/types'

/**
 * Options for `Zanix.setup()` — general, cross-cutting configuration that isn't part of the
 * HTTP/worker bootstrap itself (`Zanix.start()`/`Zanix.startWorker()`), so it's exposed as its own
 * call instead of being folded into either `SetupOptions`.
 *
 * The `database`/`notifications`/`dlq` fields *set* env vars (`Deno.env.set`) that
 * `@zanix/datamaster`/`@zanix/notifications` themselves read at their own module-import time (via
 * `@zanix/datamaster/core`/`@zanix/notifications/core`, which `Zanix.start()`/`Zanix.startWorker()`
 * import as part of `defineCoreMetadata()`). `assets` shares the same ordering requirement for a
 * different reason — it constructs a real `AssetService` synchronously, once, the moment `setup()`
 * runs. For any of these fields to take effect, call `Zanix.setup()` **before**
 * `Zanix.start()`/`Zanix.startWorker()` — calling it after has no effect on `database`/
 * `notifications`/`dlq` (the relevant module will have already made its registration decision), and
 * simply constructs the `AssetService` later than intended for `assets`.
 *
 * **An already-set env var always wins.** Each of these fields only sets its env var when that
 * var isn't already present in the environment (an empty string counts as not present) — the
 * deployment platform/container's own configuration is the authority; a value passed here is just
 * the app-level default for when nothing else specified it. To force a value regardless of the
 * environment, set it directly via `Deno.env.set()` yourself instead of going through
 * `Zanix.setup()`.
 */
export type ConfigOptions = {
  /**
   * `@zanix/server`'s own error-handling config — two separate concerns grouped here because both
   * are "how many times before something happens" counters over an error stream, configured the
   * same way, with no env-var fallback (`@zanix/server` itself defines none for either — both only
   * apply when explicitly passed here).
   */
  errors?: {
    /**
     * Error-log throttling config (see `@zanix/server`'s `ErrorLogThrottle`) — suppresses log
     * noise from repeated HTTP-status responses.
     */
    logThrottle?: ErrorLogThrottleConfig & { store?: ErrorLogThrottleStore }
    /**
     * Uncaught-error/unhandled-rejection monitoring config (see `@zanix/server`'s
     * `UncaughtErrorMonitor`) — tracks process-wide crash-class errors, never repeated HTTP-status
     * responses (that's `logThrottle` above).
     */
    uncaughtMonitor?: UncaughtErrorMonitorConfig
  }
  /**
   * `redact` (a custom `{ pattern }`, or `false`), if given, is registered **globally** via
   * `@zanix/utils`'s `setDefaultRedactOptions` — not just applied to the global `logger` instance
   * this constructs. `@zanix/server`'s own error-response building (`getExtendedErrorResponse`/
   * `httpErrorResponse`, used by every `onError` fallback) calls `serializeError` with no `redact`
   * option of its own, so without this: a custom pattern would protect log output but silently
   * leak the same credential-shaped field straight back to the HTTP client in the error response
   * body, and `redact: false` would disable a `Logger`'s own redaction while that same
   * error-response path kept applying the built-in pattern regardless — both confirmed as real
   * gaps, not hypothetical ones. An explicit `redact` passed directly to a `new Logger(...)` you
   * construct yourself still always wins over this global default, same as before.
   */
  logger?: Omit<LoggerFunctionOptions<DefaultResponse>, 'storage'> & {
    /**
     * Formats a log before it's stored — the only piece of `@zanix/utils`'s own
     * `LoggerFunctionOptions.storage` exposed here. There's no `storage.save` option: `setup()`
     * always decides how logs get saved on your behalf, either via `elastic` (below) or its own
     * default (file-based) fallback when `elastic` is off. Construct your own
     * `new Logger({storage: {save: ...}})` directly (bypassing `setup()`) if you need a fully
     * custom, non-Elasticsearch save function.
     */
    formatter?: LoggerFormatter
    /**
     * Routes the global `logger` to Elasticsearch/OpenSearch via `@zanix/datamaster`'s
     * `elasticsearchLogSave`. `true` (or leaving this unset while `SEARCH_ENGINE` is
     * `'elasticsearch'`/`'opensearch'`) uses the same `SEARCH_ENGINE`/`SEARCH_URL` env vars
     * `defineCoreMetadata()` already reads for the zero-config `search` connector; pass an
     * options object to override connection details, or `false` to skip even if `SEARCH_ENGINE`
     * selects one of those two (logs then fall back to `@zanix/utils`'s own default file-based
     * storage). `SEARCH_ENGINE=meilisearch` never auto-enables this — only the two Elasticsearch-
     * wire-compatible engines do.
     */
    elastic?: ElasticsearchLogSaveOptions | boolean
  }
  /** Non-secret `@zanix/datamaster` config — see this type's own top-level doc on call ordering. */
  database?: {
    /** Sets `DATABASE_SEEDERS`. `false` disables running any registered seeder. */
    seeders?: boolean
    /** Sets `TRIGGERS_MODEL_NAME`. `false` disables the persisted triggers module entirely. */
    triggersModel?: string | false
    /** Sets `SEED_MODEL_NAME`. `false` disables the internal seed-tracking model. */
    seedModel?: string | false
    /** Sets `TRIGGERS_POLL_INTERVAL` (milliseconds). `false` disables polling. */
    triggersPollInterval?: number | false
    /** Sets `TRIGGERS_CHANGE_STREAM`. */
    triggersChangeStream?: boolean
  }
  /** Non-secret `@zanix/notifications` config — see this type's own top-level doc on call ordering. */
  notifications?: {
    /**
     * Sets `TEMPLATES_BACKEND`. `'local'` enables DB-backed templates (see `templatesModel`
     * below, and `@zanix/notifications`'s own `templatesBackendMode()`); `'remote'` delegates to
     * a central templates service (Mode C) — that mode's own `TEMPLATES_SERVICE_URL`/`_ID`/`_TOKEN`/
     * `_AUTH_ID`/`_CACHE_TTL_MS` aren't covered by this block, set them directly via `Deno.env`.
     */
    templatesBackend?: 'local' | 'remote'
    /** Sets `TEMPLATES_MODEL_NAME`. Only meaningful alongside `templatesBackend: 'local'` — has
     * no effect otherwise (it's simply never read, not a conflict to detect). */
    templatesModel?: string
  }
  /**
   * Non-secret `@zanix/datamaster` DLQ (`DLQProvider`) config — see this type's own top-level doc
   * on call ordering, and [DLQ](https://jsr.io/@zanix/datamaster/doc/~/DLQProvider) for the
   * concepts these configure.
   */
  dlq?: {
    /** Sets `DLQ_MODEL_NAME`. Names `DLQProvider`'s collection. */
    modelName?: string
    /**
     * Sets `DLQ_ENCRYPT_PAYLOAD`. Forces `registerDLQModel`'s `encryptPayload` on/off regardless of
     * what's passed to that call directly — this env var always wins when set.
     */
    encryptPayload?: boolean
    /** Sets `DLQ_DEFAULT_LEASE_MS`. Default `DLQProvider.claim()` lease duration (ms) when no
     * per-call `leaseTtlMs` is passed. */
    defaultLeaseMs?: number
  }
  /**
   * Activates the `@zanix/space` Asset API's real infrastructure — unlike `database`/
   * `notifications`/`dlq` above (which only ever set env vars), this ALSO constructs a real,
   * ready-to-use `AssetService` (`S3ObjectStorage` + optional local fallback/migration +
   * `MongoFileRepository`, adapted via `createAssetRepositoryOverFiles`) and registers it as this
   * module's own singleton — the same "construct real infrastructure, self-register it globally"
   * shape `logger`'s own `elastic` option already establishes (`new Logger()` self-registers;
   * `import logger from '@zanix/logger'` reads it back). Read the constructed service back with
   * `getAssetsService()`.
   *
   * **Omitted entirely — the default — constructs nothing, at zero cost**, same convention every
   * other block in this type already follows. There is no separate "enabled" flag: passing THIS
   * block at all, even `{}`, is the activation signal — if you're not going to use it, don't pass
   * it.
   *
   * Every field below sets its own env var only when not already present (same `setEnvIfDefined`
   * precedence every other field in this type uses) — omit any of them when the deployment already
   * configures it via its own container/platform env; `setup()` reads the FINAL env state either
   * way, so a value already present in the environment is honored exactly as if you'd passed it
   * here.
   *
   * See [Storage](https://jsr.io/@zanix/datamaster/doc/~/S3ObjectStorage) for what each
   * `s3*`/`encrypt*` field actually configures.
   */
  assets?: {
    /** Sets `S3_ENDPOINT`. */
    s3Endpoint?: string
    /** Sets `S3_ACCESS_KEY`. */
    s3AccessKey?: string
    /** Sets `S3_SECRET_KEY`. */
    s3SecretKey?: string
    /** Sets `S3_BUCKET`. */
    s3Bucket?: string
    /** Sets `S3_ENCRYPT`. */
    encrypt?: 'symmetric' | 'asymmetric'
    /** Sets `S3_ENCRYPT_VERSION`. Ignored unless `encrypt` (or `S3_ENCRYPT`) is
     * also set. */
    encryptVersion?: string
    /**
     * Local fallback/migration directory (`LocalFilesystemObjectStorage` + `createFallback
     * ObjectStorage` + `ensureLocalObjectsSynced`, all from `@zanix/datamaster/storage`) —
     * protects against `S3_ENDPOINT` briefly becoming unset after some objects were
     * already written locally. Omitted: the constructed `AssetService` talks to S3 directly, with
     * no local fallback at all — reads/writes genuinely fail if S3 is unreachable, rather than
     * silently degrading to local disk.
     */
    localDir?: string
    /** Sets `FILE_MODEL_NAME` — overrides the Mongo collection name `MongoFileRepository` (the
     * constructed `AssetService`'s own metadata store) resolves to, `zanix-files` otherwise. */
    filesModelName?: string
  }
}
