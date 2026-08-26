import type { ConfigOptions } from 'typings/config.ts'

import { ErrorLogThrottle, UncaughtErrorMonitor } from '@zanix/server'
import { elasticsearchLogSave, resolveSearchEngine } from '@zanix/datamaster/observability'
import {
  DATABASE_SEEDERS_ENV,
  SEED_MODEL_ENV,
  TRIGGERS_CHANGE_STREAM_ENV,
  TRIGGERS_MODEL_ENV,
  TRIGGERS_POLL_INTERVAL_ENV,
} from '@zanix/datamaster/database'
import {
  DLQ_DEFAULT_LEASE_MS_ENV,
  DLQ_ENCRYPT_PAYLOAD_ENV,
  DLQ_MODEL_ENV,
} from '@zanix/datamaster/dlq'
import { setDefaultRedactOptions } from '@zanix/errors'
import { Logger } from '@zanix/logger'
import { lazyClass, lazyFunction, lazyValue } from '@zanix/helpers'
import {
  DATAMASTER_FILES_SPECIFIER,
  DATAMASTER_STORAGE_SPECIFIER,
  NOTIFICATIONS_SPECIFIER,
  SPACE_ASSETS_API_SPECIFIER,
} from './lazy/specifiers.ts'

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

// --- `assets`/`notifications` real-infrastructure and cross-package lazy resolution — every
// symbol below is genuinely conditional: each only ever runs for a caller that actually passes
// the matching option, and `@zanix/space`/`@zanix/datamaster`/`@zanix/notifications` are all
// external packages, so whether to load them can only be decided at runtime. Resolved via
// `@zanix/helpers`'s `lazyFunction`/`lazyClass`/`lazyValue` instead of a plain static import, so a
// consumer that never triggers the matching gate never resolves `@zanix/space/assets-api` (and
// transitively `sharp`/`svgo`, via its `AssetTransformer` composition), `@zanix/datamaster/storage`
// (transitively `@aws-sdk/client-s3`), `@zanix/datamaster/files` (transitively `mongoose`), or
// `@zanix/notifications` (transitively Handlebars/Zod, via `TemplateProvider`) merely by importing
// `@zanix/core` — see `lazy-specifiers.ts`'s own doc for the full reasoning and why each specifier
// lives outside this package's `imports` map. Every function/class shape below is hand-declared to
// exactly what this module calls, deliberately not `typeof import(...)` of the real specifier —
// the real types stay opaque (`unknown`) all the way through, since nothing here ever inspects
// them; only `S3ConnectorOptions`-shaped construction and pass-through composition happen in this
// file. ------------------------------------------------------------------------------------------

type S3ObjectStorageCtor = new (options?: Record<string, unknown>) => unknown
type CreateLocalFilesystemObjectStorageFn = (rootDir: string) => unknown
type CreateFallbackObjectStorageFn = (
  primary: unknown,
  fallback: unknown,
  ensureSynced?: () => Promise<void>,
) => unknown
type EnsureLocalObjectsSyncedFn = (
  local: unknown,
  primary: unknown,
  rootDir: string,
) => Promise<void>
type MongoFileRepositoryCtor = new () => unknown
type RegisterFileModelFn = (options: { modelName?: string }) => void
type CreateAssetRepositoryOverFilesFn = (fileRepository: unknown) => unknown
type CreateAssetServiceFn = (options: { storage: unknown; repository: unknown }) => unknown

const createS3ObjectStorage = lazyClass<S3ObjectStorageCtor>(
  DATAMASTER_STORAGE_SPECIFIER,
  'S3ObjectStorage',
)
const createLocalFilesystemObjectStorage = lazyFunction<CreateLocalFilesystemObjectStorageFn>(
  DATAMASTER_STORAGE_SPECIFIER,
  'createLocalFilesystemObjectStorage',
)
const createFallbackObjectStorage = lazyFunction<CreateFallbackObjectStorageFn>(
  DATAMASTER_STORAGE_SPECIFIER,
  'createFallbackObjectStorage',
)
const ensureLocalObjectsSynced = lazyFunction<EnsureLocalObjectsSyncedFn>(
  DATAMASTER_STORAGE_SPECIFIER,
  'ensureLocalObjectsSynced',
)
const getS3EndpointEnv = lazyValue<string>(DATAMASTER_STORAGE_SPECIFIER, 'S3_ENDPOINT_ENV')
const getS3AccessKeyEnv = lazyValue<string>(DATAMASTER_STORAGE_SPECIFIER, 'S3_ACCESS_KEY_ENV')
const getS3SecretKeyEnv = lazyValue<string>(DATAMASTER_STORAGE_SPECIFIER, 'S3_SECRET_KEY_ENV')
const getS3BucketEnv = lazyValue<string>(DATAMASTER_STORAGE_SPECIFIER, 'S3_BUCKET_ENV')
const getS3EncryptEnv = lazyValue<string>(DATAMASTER_STORAGE_SPECIFIER, 'S3_ENCRYPT_ENV')
const getS3EncryptVersionEnv = lazyValue<string>(
  DATAMASTER_STORAGE_SPECIFIER,
  'S3_ENCRYPT_VERSION_ENV',
)

const createMongoFileRepository = lazyClass<MongoFileRepositoryCtor>(
  DATAMASTER_FILES_SPECIFIER,
  'MongoFileRepository',
)
const registerFileModel = lazyFunction<RegisterFileModelFn>(
  DATAMASTER_FILES_SPECIFIER,
  'registerFileModel',
)
const getFileModelEnv = lazyValue<string>(DATAMASTER_FILES_SPECIFIER, 'FILE_MODEL_ENV')

// `@zanix/notifications`'s own `TemplateProvider` (reached unconditionally from the SAME root
// entry file `TEMPLATES_BACKEND_ENV`/`TEMPLATES_MODEL_ENV` live in) value-imports every channel's
// compiled Handlebars template and each one's own Zod schema — a real cost that has nothing to do
// with simply knowing which backend mode a caller selected. Resolved lazily, gated behind an
// explicit `!== undefined` check below (mirroring `setEnvIfDefined`'s own no-op-on-undefined
// behavior as an OUTER gate, not just an inner one), so a caller that never configures
// `notifications.templatesBackend`/`templatesModel` never resolves it.
const getTemplatesBackendEnv = lazyValue<string>(NOTIFICATIONS_SPECIFIER, 'TEMPLATES_BACKEND_ENV')
const getTemplatesModelEnv = lazyValue<string>(NOTIFICATIONS_SPECIFIER, 'TEMPLATES_MODEL_ENV')

const createAssetRepositoryOverFiles = lazyFunction<CreateAssetRepositoryOverFilesFn>(
  SPACE_ASSETS_API_SPECIFIER,
  'createAssetRepositoryOverFiles',
)
const createAssetServiceLazy = lazyFunction<CreateAssetServiceFn>(
  SPACE_ASSETS_API_SPECIFIER,
  'createAssetService',
)

/** Self-registered by `setup({ assets })`, read back via {@link getAssetsService} — the same
 * "construct real infrastructure, self-register it globally" shape `new Logger()` already
 * establishes for the process-wide `logger` instance. `undefined` until `setup()` is actually
 * called with an `assets` block.
 *
 * Typed `unknown`, not the real `AssetService` — that type is defined in `@zanix/space/assets-api`'s
 * own `asset-service.ts`, the same file that unconditionally value-imports the real
 * `AssetTransformer` composition (`sharp`/`svgo`); resolving `AssetService` as a TYPE still
 * requires resolving that file's full import graph, so an `import type` here would materialize the
 * same dependencies a plain value import would, for every consumer of `@zanix/core` regardless of
 * whether `setup({ assets })` is ever called. See {@link getAssetsService}'s own doc for how a
 * caller recovers the real type where it's actually needed. */
let assetsService: unknown

/**
 * Builds a real `AssetService` from `assets` — `S3ObjectStorage`, optionally wrapped in a
 * local fallback/migration (`assets.localDir`), and `MongoFileRepository` adapted via
 * `createAssetRepositoryOverFiles`. Called only from `setup()`, after the env vars above have
 * already been applied, so `S3ObjectStorage`'s own env-var resolution (`S3_ENDPOINT`/etc.) sees
 * the FINAL state regardless of whether each value came from `assets` itself or was already
 * present in the environment.
 *
 * Async — every dependency this composes is resolved lazily (see this file's own doc above), so
 * constructing it always goes through at least one `await`, even though none of the underlying
 * classes/functions themselves do any real I/O during construction.
 */
async function buildAssetsService(assets: NonNullable<ConfigOptions['assets']>): Promise<unknown> {
  await registerFileModel({ modelName: assets.filesModelName })

  const s3 = await createS3ObjectStorage()
  const storage = assets.localDir
    ? await createFallbackObjectStorage(
      s3,
      await createLocalFilesystemObjectStorage(assets.localDir),
      async () => {
        const local = await createLocalFilesystemObjectStorage(assets.localDir as string)
        await ensureLocalObjectsSynced(local, s3, assets.localDir as string)
      },
    )
    : s3

  // `MongoFileRepository` is safe to construct here, before `Zanix.start()` has registered the
  // `'database'` connector — its own `database` field is a LAZY getter (confirmed via
  // `CoreBaseClass`'s own `get database()`), only actually resolved inside `.model()`, which only
  // ever runs once a real request reaches the Asset API — always well after `Zanix.start()` has
  // already registered the connector, in real usage.
  const repository = await createAssetRepositoryOverFiles(await createMongoFileRepository())

  return await createAssetServiceLazy({ storage, repository })
}

/**
 * Reads back the value `setup({ assets })` constructed — `undefined` if `setup()` was never
 * called with an `assets` block. Typed `unknown` for the same reason {@link assetsService}'s own
 * doc explains: recovering the real `AssetService` type here would require resolving
 * `@zanix/space/assets-api`'s module graph (and transitively `sharp`/`svgo`) for every consumer of
 * `@zanix/core`, whether or not they use the Asset API. A caller that needs the real type already
 * imports `@zanix/space/assets-api` for real (to call `defineSpaceApp({ assetsApi: {...} })`), so
 * recovering it is a plain cast at that call site, at no extra cost:
 *
 * ```typescript
 * import type { AssetService } from '@zanix/space/assets-api'
 *
 * const app = defineSpaceApp({
 *   assetsApi: { service: Zanix.getAssetsService() as AssetService },
 * })
 * ```
 *
 * See {@link ConfigOptions.assets}'s own doc for the full composition this builds and why.
 */
export const getAssetsService = (): unknown => assetsService

/**
 * General-purpose, cross-cutting configuration bootstrap — separate from
 * `Zanix.start()`/`Zanix.startWorker()`, and safe to call with as many or as few options as apply
 * (nothing here has any effect unless explicitly configured). See {@link ConfigOptions} — its
 * `database`/`notifications`/`dlq`/`assets` fields must be applied *before*
 * `Zanix.start()`/`Zanix.startWorker()` to take effect.
 *
 * Async because `assets` resolves `@zanix/space`/`@zanix/datamaster` lazily, and
 * `notifications.templatesBackend`/`templatesModel` resolve `@zanix/notifications` lazily (see
 * this file's own doc) — every OTHER field runs fully synchronously, with no `await` in its own
 * path, so a caller that never passes either sees the exact same synchronous-completion behavior
 * as before; only a caller passing `assets` or `notifications.templatesBackend`/`templatesModel`
 * needs to `await` this call before relying on its effects ({@link getAssetsService}'s result, or
 * the corresponding env var actually being set).
 *
 * @static
 * @function
 */
export const setup = async (options: ConfigOptions = {}): Promise<void> => {
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
  if (options.notifications?.templatesBackend !== undefined) {
    setEnvIfDefined(await getTemplatesBackendEnv(), options.notifications.templatesBackend)
  }
  if (options.notifications?.templatesModel !== undefined) {
    setEnvIfDefined(await getTemplatesModelEnv(), options.notifications.templatesModel)
  }
  setEnvIfDefined(DLQ_MODEL_ENV, options.dlq?.modelName)
  setEnvIfDefined(DLQ_ENCRYPT_PAYLOAD_ENV, options.dlq?.encryptPayload)
  setEnvIfDefined(DLQ_DEFAULT_LEASE_MS_ENV, options.dlq?.defaultLeaseMs)

  if (options.assets) {
    setEnvIfDefined(await getS3EndpointEnv(), options.assets.s3Endpoint)
    setEnvIfDefined(await getS3AccessKeyEnv(), options.assets.s3AccessKey)
    setEnvIfDefined(await getS3SecretKeyEnv(), options.assets.s3SecretKey)
    setEnvIfDefined(await getS3BucketEnv(), options.assets.s3Bucket)
    setEnvIfDefined(await getS3EncryptEnv(), options.assets.encrypt)
    setEnvIfDefined(await getS3EncryptVersionEnv(), options.assets.encryptVersion)
    setEnvIfDefined(await getFileModelEnv(), options.assets.filesModelName)

    assetsService = await buildAssetsService(options.assets)
  }
}
