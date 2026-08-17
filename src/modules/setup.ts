import type { ConfigOptions } from 'typings/config.ts'

import { ErrorLogThrottle } from '@zanix/server'
import {
  ELASTICSEARCH_URL_ENV,
  elasticsearchLogSave,
  OPENSEARCH_URL_ENV,
} from '@zanix/datamaster/observability'
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
import { DATABASE_TEMPLATES_ENV, TEMPLATES_MODEL_ENV } from '@zanix/notifications'
import { setDefaultRedactOptions } from '@zanix/errors'
import { Logger } from '@zanix/logger'

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

/**
 * General-purpose, cross-cutting configuration bootstrap — separate from
 * `Zanix.start()`/`Zanix.startWorker()`, and safe to call with as many or as few options as apply
 * (nothing here has any effect unless explicitly configured). See {@link ConfigOptions} — its
 * `database`/`notifications`/`dlq` fields must be applied *before*
 * `Zanix.start()`/`Zanix.startWorker()` to take effect.
 *
 * @static
 * @function
 */
export const setup = (options: ConfigOptions = {}): void => {
  if (options.errorLogThrottle) new ErrorLogThrottle(options.errorLogThrottle)

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

  const hasElasticEnv = Deno.env.has(ELASTICSEARCH_URL_ENV) ||
    Deno.env.has(OPENSEARCH_URL_ENV)
  const useElastic = elastic !== false &&
    (elastic || (elastic === undefined && hasElasticEnv))

  if (useElastic) {
    // `new Logger()` self-registers as the process-wide global instance (see `@zanix/logger`'s
    // own docs) — every existing `import logger from '@zanix/logger'` call site picks this up
    // automatically, no further wiring needed.
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
    DATABASE_TEMPLATES_ENV,
    options.notifications?.databaseTemplates,
  )
  setEnvIfDefined(TEMPLATES_MODEL_ENV, options.notifications?.templatesModel)
  setEnvIfDefined(DLQ_MODEL_ENV, options.dlq?.modelName)
  setEnvIfDefined(DLQ_ENCRYPT_PAYLOAD_ENV, options.dlq?.encryptPayload)
  setEnvIfDefined(DLQ_DEFAULT_LEASE_MS_ENV, options.dlq?.defaultLeaseMs)
}
