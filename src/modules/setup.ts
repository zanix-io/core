import type { ConfigOptions } from 'typings/config.ts'
import type { AssetService } from '@zanix/space/assets-api'

import { ErrorLogThrottle, UncaughtErrorMonitor } from '@zanix/server'
import { elasticsearchLogSave, resolveSearchEngine } from '@zanix/datamaster/observability'
import {
  DATABASE_SEEDERS_ENV,
  DLQ_DEFAULT_LEASE_MS_ENV,
  DLQ_ENCRYPT_PAYLOAD_ENV,
  DLQ_MODEL_ENV,
  SEED_MODEL_ENV,
  TRIGGERS_CHANGE_STREAM_ENV,
  TRIGGERS_MODEL_ENV,
  TRIGGERS_POLL_INTERVAL_ENV,
} from '@zanix/database'
import { TEMPLATES_BACKEND_ENV, TEMPLATES_MODEL_ENV } from '@zanix/notifications'
import { setDefaultRedactOptions } from '@zanix/errors'
import { Logger } from '@zanix/logger'
import {
  createFallbackObjectStorage,
  createLocalFilesystemObjectStorage,
  ensureLocalObjectsSynced,
  S3_ACCESS_KEY_ENV,
  S3_BUCKET_ENV,
  S3_ENCRYPT_ENV,
  S3_ENCRYPT_VERSION_ENV,
  S3_ENDPOINT_ENV,
  S3_SECRET_KEY_ENV,
  S3ObjectStorage,
} from '@zanix/datamaster/storage'
import { FILE_MODEL_ENV, MongoFileRepository, registerFileModel } from '@zanix/datamaster/files'
import { createAssetRepositoryOverFiles, createAssetService } from '@zanix/space/assets-api'

/**
 * Sets `env` to `value`'s string form, unless `value` is `undefined` — or `env` is already set.
 * An already-set env var always wins over a hardcoded `ConfigOptions` value: the environment is
 * the deployment's own authority (whoever configured the platform/container), `Zanix.setup()`'s
 * options are just an app-level default for when nothing else said otherwise.
 */
function setEnvIfDefined(
  env: string,
  value: string | number | boolean | undefined,
): void {
  if (value !== undefined && (!Deno.env.has(env) || Deno.env.get(env) === '')) {
    Deno.env.set(env, String(value))
  }
}

/** Self-registered by `setup({ assets })`, read back via {@link getAssetsService} — the same
 * "construct real infrastructure, self-register it globally" shape `new Logger()` already
 * establishes for the process-wide `logger` instance. `undefined` until `setup()` is actually
 * called with an `assets` block. */
let assetsService: AssetService | undefined

/**
 * Builds a real `AssetService` from `assets` — `S3ObjectStorage`, optionally wrapped in a
 * local fallback/migration (`assets.localDir`), and `MongoFileRepository` adapted via
 * `createAssetRepositoryOverFiles`. Called only from `setup()`, after the env vars above have
 * already been applied, so `new S3ObjectStorage()`'s own env-var resolution
 * (`S3_ENDPOINT`/etc.) sees the FINAL state regardless of whether each value came from
 * `assets` itself or was already present in the environment.
 */
function buildAssetsService(assets: NonNullable<ConfigOptions['assets']>): AssetService {
  registerFileModel({ modelName: assets.filesModelName })

  const s3 = new S3ObjectStorage()
  const storage = assets.localDir
    ? createFallbackObjectStorage(
      s3,
      createLocalFilesystemObjectStorage(assets.localDir),
      () =>
        ensureLocalObjectsSynced(
          createLocalFilesystemObjectStorage(assets.localDir as string),
          s3,
          assets.localDir as string,
        ),
    )
    : s3

  // `MongoFileRepository` is safe to construct here, before `Zanix.start()` has registered the
  // `'database'` connector — its own `database` field is a LAZY getter (confirmed via
  // `CoreBaseClass`'s own `get database()`), only actually resolved inside `.model()`, which only
  // ever runs once a real request reaches the Asset API — always well after `Zanix.start()` has
  // already registered the connector, in real usage.
  const repository = createAssetRepositoryOverFiles(new MongoFileRepository())

  return createAssetService({ storage, repository })
}

/**
 * Reads back the `AssetService` `setup({ assets })` constructed — `undefined` if `setup()` was
 * never called with an `assets` block. Pass this straight into `defineSpaceApp({ assetsApi:
 * { service: getAssetsService()! } })` — see {@link ConfigOptions.assets}'s own doc for the full
 * composition and why `@zanix/core` constructs this instead of every app hand-rolling it.
 */
export const getAssetsService = (): AssetService | undefined => assetsService

/**
 * General-purpose, cross-cutting configuration bootstrap — separate from
 * `Zanix.start()`/`Zanix.startWorker()`, and safe to call with as many or as few options as apply
 * (nothing here has any effect unless explicitly configured). See {@link ConfigOptions} — its
 * `database`/`notifications`/`dlq`/`assets` fields must be applied *before*
 * `Zanix.start()`/`Zanix.startWorker()` to take effect.
 *
 * @static
 * @function
 */
export const setup = (options: ConfigOptions = {}): void => {
  if (options.errors?.logThrottle) new ErrorLogThrottle(options.errors.logThrottle)
  if (options.errors?.uncaughtMonitor) new UncaughtErrorMonitor(options.errors.uncaughtMonitor)

  const { elastic, formatter, ...loggerOptions } = options.logger ?? {}

  // An explicit `redact` (a custom pattern, or `false`) is registered globally, not just passed to
  // the `Logger` instance below — `@zanix/server`'s own error-response building
  // (`getExtendedErrorResponse`/`httpErrorResponse`) calls `serializeError` with no `redact` option
  // of its own, so without this, a custom pattern would protect logs but silently leak the same
  // credential-shaped field straight back to the HTTP client in every error response body — and
  // `redact: false` would disable a `Logger`'s own redaction while every other caller with no
  // explicit `redact` (like that same error-response path) kept applying the built-in pattern
  // regardless.
  if (loggerOptions.redact !== undefined) {
    setDefaultRedactOptions(loggerOptions.redact)
  }

  // `resolveSearchEngine()` reads (and validates) `SEARCH_ENGINE` — throws immediately if it's
  // set to an unsupported value, same as `@zanix/datamaster/observability`'s own module-load
  // would once `Zanix.start()` actually imports it; doing the same check here just fails fast,
  // it doesn't introduce a new failure mode. Only `elasticsearch`/`opensearch` auto-enable this
  // logger's Elasticsearch-backed storage — `meilisearch` is a real, supported `SEARCH_ENGINE`
  // value but has no bearing on this logger integration, same as before `SEARCH_ENGINE` existed
  // (the old `ELASTICSEARCH_URL`/`OPENSEARCH_URL` presence check never involved Meilisearch's var
  // either).
  const searchEngine = resolveSearchEngine()
  const hasElasticEnv = searchEngine === 'elasticsearch' || searchEngine === 'opensearch'
  const useElastic = elastic !== false &&
    (elastic || (elastic === undefined && hasElasticEnv))

  if (useElastic) {
    // `new Logger()` self-registers as the process-wide global instance (see `@zanix/logger`'s
    // own docs) — every existing `import logger from '@zanix/logger'` call site picks this up
    // automatically, no further wiring needed, UNLESS the caller passed `logger.disableGlobalAssign:
    // true` in `options` (spread into `loggerOptions` below), in which case this instance is
    // constructed but never assigned to `globalThis` — existing call sites keep resolving whatever
    // instance (if any) was already global before this call.
    new Logger({
      ...loggerOptions,
      storage: {
        formatter,
        save: elasticsearchLogSave(
          typeof elastic === 'object' ? elastic : undefined,
        ),
      },
    })
  } else if (formatter || Object.keys(loggerOptions).length) {
    new Logger({
      ...loggerOptions,
      storage: formatter ? { formatter } : undefined,
    })
  }

  setEnvIfDefined(DATABASE_SEEDERS_ENV, options.database?.seeders)
  setEnvIfDefined(TRIGGERS_MODEL_ENV, options.database?.triggersModel)
  setEnvIfDefined(SEED_MODEL_ENV, options.database?.seedModel)
  setEnvIfDefined(
    TRIGGERS_POLL_INTERVAL_ENV,
    options.database?.triggersPollInterval,
  )
  setEnvIfDefined(
    TRIGGERS_CHANGE_STREAM_ENV,
    options.database?.triggersChangeStream,
  )
  setEnvIfDefined(
    TEMPLATES_BACKEND_ENV,
    options.notifications?.templatesBackend,
  )
  setEnvIfDefined(TEMPLATES_MODEL_ENV, options.notifications?.templatesModel)
  setEnvIfDefined(DLQ_MODEL_ENV, options.dlq?.modelName)
  setEnvIfDefined(DLQ_ENCRYPT_PAYLOAD_ENV, options.dlq?.encryptPayload)
  setEnvIfDefined(DLQ_DEFAULT_LEASE_MS_ENV, options.dlq?.defaultLeaseMs)

  if (options.assets) {
    setEnvIfDefined(S3_ENDPOINT_ENV, options.assets.s3Endpoint)
    setEnvIfDefined(S3_ACCESS_KEY_ENV, options.assets.s3AccessKey)
    setEnvIfDefined(S3_SECRET_KEY_ENV, options.assets.s3SecretKey)
    setEnvIfDefined(S3_BUCKET_ENV, options.assets.s3Bucket)
    setEnvIfDefined(S3_ENCRYPT_ENV, options.assets.encrypt)
    setEnvIfDefined(S3_ENCRYPT_VERSION_ENV, options.assets.encryptVersion)
    setEnvIfDefined(FILE_MODEL_ENV, options.assets.filesModelName)

    assetsService = buildAssetsService(options.assets)
  }
}
