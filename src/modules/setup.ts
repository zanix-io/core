import type { ConfigOptions } from 'typings/config.ts'

import { ErrorLogThrottle } from '@zanix/server'
import {
  ELASTICSEARCH_URL_ENV,
  elasticsearchLogSave,
  OPENSEARCH_URL_ENV,
} from '@zanix/datamaster/observability'
import {
  DATABASE_SEEDERS_ENV,
  SEED_MODEL_ENV,
  TRIGGERS_CHANGE_STREAM_ENV,
  TRIGGERS_MODEL_ENV,
  TRIGGERS_POLL_INTERVAL_ENV,
} from '@zanix/database'
import { DATABASE_TEMPLATES_ENV, TEMPLATES_MODEL_ENV } from '@zanix/notifications'
import { Logger } from '@zanix/logger'

/**
 * Sets `env` to `value`'s string form, unless `value` is `undefined` — or `env` is already set.
 * An already-set env var always wins over a hardcoded `ConfigOptions` value: the environment is
 * the deployment's own authority (whoever configured the platform/container), `Zanix.setup()`'s
 * options are just an app-level default for when nothing else said otherwise.
 */
function setEnvIfDefined(env: string, value: string | number | boolean | undefined): void {
  if (value !== undefined && (!Deno.env.has(env) || Deno.env.get(env) === '')) {
    Deno.env.set(env, String(value))
  }
}

/**
 * General-purpose, cross-cutting configuration bootstrap — separate from
 * `Zanix.start()`/`Zanix.startWorker()`, and safe to call with as many or as few options as apply
 * (nothing here has any effect unless explicitly configured). See {@link ConfigOptions} — its
 * `database`/`notifications` fields must be applied *before* `Zanix.start()`/`Zanix.startWorker()`
 * to take effect.
 *
 * @static
 * @function
 */
export const setup = (options: ConfigOptions = {}): void => {
  if (options.errorLogThrottle) new ErrorLogThrottle(options.errorLogThrottle)

  const { elastic, ...loggerOptions } = options.logger ?? {}
  const hasElasticEnv = Deno.env.has(ELASTICSEARCH_URL_ENV) || Deno.env.has(OPENSEARCH_URL_ENV)
  const useElastic = elastic !== false && (elastic || (elastic === undefined && hasElasticEnv))

  if (useElastic) {
    const formatter = loggerOptions.storage ? loggerOptions.storage.formatter : undefined
    // `new Logger()` self-registers as the process-wide global instance (see `@zanix/logger`'s
    // own docs) — every existing `import logger from '@zanix/logger'` call site picks this up
    // automatically, no further wiring needed.
    new Logger({
      ...loggerOptions,
      storage: {
        formatter,
        save: elasticsearchLogSave(typeof elastic === 'object' ? elastic : undefined),
      },
    })
  } else if (Object.keys(loggerOptions).length) {
    new Logger(loggerOptions)
  }

  setEnvIfDefined(DATABASE_SEEDERS_ENV, options.database?.seeders)
  setEnvIfDefined(TRIGGERS_MODEL_ENV, options.database?.triggersModel)
  setEnvIfDefined(SEED_MODEL_ENV, options.database?.seedModel)
  setEnvIfDefined(TRIGGERS_POLL_INTERVAL_ENV, options.database?.triggersPollInterval)
  setEnvIfDefined(TRIGGERS_CHANGE_STREAM_ENV, options.database?.triggersChangeStream)
  setEnvIfDefined(DATABASE_TEMPLATES_ENV, options.notifications?.databaseTemplates)
  setEnvIfDefined(TEMPLATES_MODEL_ENV, options.notifications?.templatesModel)
}
