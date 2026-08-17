import type { ErrorLogThrottleConfig, ErrorLogThrottleStore } from '@zanix/server'
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
 * import as part of `defineCoreMetadata()`). For any of them to take effect, call `Zanix.setup()`
 * **before** `Zanix.start()`/`Zanix.startWorker()` — calling it after has no effect, since the
 * relevant module will have already made its registration decision.
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
   * Error-log throttling config (see `@zanix/server`'s `ErrorLogThrottle`). No env-var fallback —
   * `@zanix/server` itself defines none, so this only applies when explicitly passed here.
   */
  errorLogThrottle?: ErrorLogThrottleConfig & { store?: ErrorLogThrottleStore }
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
     * `elasticsearchLogSave`. `true` (or leaving this unset while `ELASTICSEARCH_URL`/
     * `OPENSEARCH_URL` is set) uses those same env vars `defineCoreMetadata()` already reads for
     * the zero-config `search` connector; pass an options object to override connection details,
     * or `false` to skip even if those env vars are set (logs then fall back to `@zanix/utils`'s
     * own default file-based storage).
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
    /** Sets `DATABASE_TEMPLATES`. */
    databaseTemplates?: boolean
    /** Sets `TEMPLATES_MODEL_NAME`. */
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
}
