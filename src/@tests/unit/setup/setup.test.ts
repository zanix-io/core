import { assert, assertEquals, assertExists, assertThrows } from '@std/assert'
import { getAssetsService, setup } from 'modules/setup.ts'
import { HttpError, InternalError, serializeError, setDefaultRedactOptions } from '@zanix/errors'

console.error = () => {}

const ELASTIC_ENVS = ['SEARCH_ENGINE', 'SEARCH_URL']
const SET_ENVS = [
  'DATABASE_SEEDERS',
  'TRIGGERS_MODEL_NAME',
  'SEED_MODEL_NAME',
  'TRIGGERS_POLL_INTERVAL',
  'TRIGGERS_CHANGE_STREAM',
  'TEMPLATES_BACKEND',
  'TEMPLATES_MODEL_NAME',
  'DLQ_MODEL_NAME',
  'DLQ_ENCRYPT_PAYLOAD',
  'DLQ_DEFAULT_LEASE_MS',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
  'S3_ENCRYPT',
  'S3_ENCRYPT_VERSION',
  'FILE_MODEL_NAME',
]

function envTest(name: string, fn: () => void): void {
  Deno.test(name, () => {
    try {
      fn()
    } finally {
      for (const env of [...ELASTIC_ENVS, ...SET_ENVS]) Deno.env.delete(env)
    }
  })
}

// deno-lint-ignore no-explicit-any
function globalLogger(): any {
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).logger
}

envTest(
  'setup(): does nothing observable when called with no options and no env vars',
  () => {
    const before = globalLogger()
    setup()
    assertEquals(globalLogger(), before)
    for (const env of SET_ENVS) assertEquals(Deno.env.get(env), undefined)
  },
)

envTest(
  'setup(): constructs ErrorLogThrottle without throwing when given explicit options',
  () => {
    setup({ errors: { logThrottle: { threshold: 5, windowMs: 1000 } } })
  },
)

envTest(
  'setup(): constructs UncaughtErrorMonitor without throwing when given explicit options',
  () => {
    setup({ errors: { uncaughtMonitor: { threshold: 5, windowMs: 1000 } } })
  },
)

envTest('setup(): logger.elastic true installs a new global logger', () => {
  const before = globalLogger()
  setup({ logger: { elastic: true } })
  assert(
    globalLogger() !== before,
    'expected a new global logger instance to be installed',
  )
})

envTest(
  'setup(): logger.elastic as an options object installs a new global logger',
  () => {
    const before = globalLogger()
    setup({ logger: { elastic: { node: 'http://localhost:9200' } } })
    assert(
      globalLogger() !== before,
      'expected a new global logger instance to be installed',
    )
  },
)

envTest(
  'setup(): SEARCH_ENGINE=elasticsearch alone (no explicit option) installs a new global logger',
  () => {
    Deno.env.set('SEARCH_ENGINE', 'elasticsearch')
    Deno.env.set('SEARCH_URL', 'http://localhost:9200')
    const before = globalLogger()
    setup()
    assert(
      globalLogger() !== before,
      'expected a new global logger instance to be installed',
    )
  },
)

envTest(
  'setup(): SEARCH_ENGINE=opensearch alone (no explicit option) installs a new global logger',
  () => {
    Deno.env.set('SEARCH_ENGINE', 'opensearch')
    Deno.env.set('SEARCH_URL', 'http://localhost:9200')
    const before = globalLogger()
    setup()
    assert(
      globalLogger() !== before,
      'expected a new global logger instance to be installed',
    )
  },
)

envTest(
  'setup(): SEARCH_ENGINE=meilisearch alone never auto-enables Elasticsearch-backed logging',
  () => {
    Deno.env.set('SEARCH_ENGINE', 'meilisearch')
    Deno.env.set('SEARCH_URL', 'http://localhost:7700')
    const before = globalLogger()
    setup()
    assertEquals(
      globalLogger(),
      before,
      'meilisearch is a real, supported SEARCH_ENGINE value, but has no bearing on logger.elastic auto-detect',
    )
  },
)

envTest(
  'setup(): logger.elastic false skips even when SEARCH_ENGINE=elasticsearch is set',
  () => {
    Deno.env.set('SEARCH_ENGINE', 'elasticsearch')
    Deno.env.set('SEARCH_URL', 'http://localhost:9200')
    const before = globalLogger()
    setup({ logger: { elastic: false } })
    assertEquals(globalLogger(), before)
  },
)

envTest(
  'setup(): an invalid SEARCH_ENGINE value throws even with no explicit logger option',
  () => {
    Deno.env.set('SEARCH_ENGINE', 'solr')
    assertThrows(() => setup(), InternalError)
  },
)

envTest(
  'setup(): logger.disableGlobalAssign alone still constructs a Logger',
  () => {
    setup({ logger: { disableGlobalAssign: true } })
  },
)

envTest(
  'setup(): logger.formatter alone (no elastic) still constructs a Logger',
  () => {
    const before = globalLogger()
    setup({ logger: { formatter: (level, data) => ({ level, data }) } })
    assert(
      globalLogger() !== before,
      'expected a new global logger instance to be installed',
    )
  },
)

envTest(
  'setup(): elastic + a manually-provided formatter keeps the formatter',
  () => {
    const before = globalLogger()
    setup({
      logger: {
        elastic: true,
        formatter: (level, data) => ({ level, data }),
      },
    })
    assert(
      globalLogger() !== before,
      'expected a new global logger instance to be installed',
    )
  },
)

envTest(
  'setup(): database/notifications options set the expected env vars',
  () => {
    setup({
      database: {
        seeders: false,
        triggersModel: 'custom-triggers',
        seedModel: false,
        triggersPollInterval: 5000,
        triggersChangeStream: true,
      },
      notifications: {
        templatesBackend: 'local',
        templatesModel: 'custom-templates',
      },
    })

    assertEquals(Deno.env.get('DATABASE_SEEDERS'), 'false')
    assertEquals(Deno.env.get('TRIGGERS_MODEL_NAME'), 'custom-triggers')
    assertEquals(Deno.env.get('SEED_MODEL_NAME'), 'false')
    assertEquals(Deno.env.get('TRIGGERS_POLL_INTERVAL'), '5000')
    assertEquals(Deno.env.get('TRIGGERS_CHANGE_STREAM'), 'true')
    assertEquals(Deno.env.get('TEMPLATES_BACKEND'), 'local')
    assertEquals(Deno.env.get('TEMPLATES_MODEL_NAME'), 'custom-templates')
  },
)

envTest(
  'setup(): unset database/notifications fields leave their env vars untouched',
  () => {
    setup({ database: { seeders: true } })

    assertEquals(Deno.env.get('DATABASE_SEEDERS'), 'true')
    assertEquals(Deno.env.get('TRIGGERS_MODEL_NAME'), undefined)
    assertEquals(Deno.env.get('TEMPLATES_BACKEND'), undefined)
  },
)

envTest('setup(): dlq options set the expected env vars', () => {
  setup({
    dlq: {
      modelName: 'custom-dlq',
      encryptPayload: true,
      defaultLeaseMs: 15_000,
    },
  })

  assertEquals(Deno.env.get('DLQ_MODEL_NAME'), 'custom-dlq')
  assertEquals(Deno.env.get('DLQ_ENCRYPT_PAYLOAD'), 'true')
  assertEquals(Deno.env.get('DLQ_DEFAULT_LEASE_MS'), '15000')
})

envTest('setup(): unset dlq fields leave their env vars untouched', () => {
  setup({ dlq: { modelName: 'custom-dlq' } })

  assertEquals(Deno.env.get('DLQ_MODEL_NAME'), 'custom-dlq')
  assertEquals(Deno.env.get('DLQ_ENCRYPT_PAYLOAD'), undefined)
  assertEquals(Deno.env.get('DLQ_DEFAULT_LEASE_MS'), undefined)
})

envTest(
  'setup(): logger.redact.pattern registers globally too, not just for the Logger it constructs',
  () => {
    try {
      const error = new HttpError('BAD_GATEWAY', {
        meta: { 'my-internal-secret': 'hide-me' },
      })

      // Sanity check first: the built-in pattern doesn't know this key, so `serializeError` (with
      // no `redact` of its own — exactly how `@zanix/server`'s `getExtendedErrorResponse` calls
      // it when building a client-facing error response) leaves it untouched beforehand.
      assertEquals((serializeError(error) as HttpError).meta, {
        'my-internal-secret': 'hide-me',
      })

      setup({ logger: { redact: { pattern: /^my-internal-secret$/i } } })

      // Real bug this guards against: a custom pattern only reached the `Logger` instance's own
      // console/storage output, never `serializeError`'s own default — meaning the same
      // credential-shaped field stayed fully visible in every HTTP error response body.
      assertEquals(
        (serializeError(error) as HttpError).meta,
        { 'my-internal-secret': '[REDACTED]' },
      )
    } finally {
      setDefaultRedactOptions(true)
    }
  },
)

envTest(
  "setup(): logger.redact:false also registers globally, disabling serializeError's own default",
  () => {
    try {
      const error = new HttpError('BAD_GATEWAY', {
        meta: { 'my-internal-secret': 'hide-me' },
      })

      // Sanity check first: with no override at all, the built-in pattern still doesn't touch
      // this key, but `Authorization`-shaped fields would normally be redacted by default.
      assertEquals(
        (serializeError(error) as HttpError).meta,
        { 'my-internal-secret': 'hide-me' },
      )

      setup({ logger: { redact: false } })

      // Real bug this guards against: `redact: false` only disabled the `Logger` instance's own
      // redaction — `serializeError`'s own default (no `redact` passed, exactly
      // `getExtendedErrorResponse`'s call shape) kept applying the built-in pattern regardless,
      // so a genuinely "fully trusted, redact nothing" app still had its error responses redacted.
      const trustedError = new HttpError('BAD_GATEWAY', {
        meta: { Authorization: 'Bearer x' },
      })
      assertEquals(
        (serializeError(trustedError) as HttpError).meta,
        { Authorization: 'Bearer x' },
      )
    } finally {
      setDefaultRedactOptions(true)
    }
  },
)

envTest(
  'setup(): an already-set env var always wins over a ConfigOptions value',
  () => {
    Deno.env.set('DATABASE_SEEDERS', 'true')
    Deno.env.set('TRIGGERS_MODEL_NAME', 'from-real-environment')
    Deno.env.set('TEMPLATES_BACKEND', 'remote')
    Deno.env.set('TEMPLATES_MODEL_NAME', '')
    Deno.env.set('DLQ_MODEL_NAME', 'from-real-environment')

    setup({
      notifications: { templatesBackend: 'local', templatesModel: 'model' },
      database: { seeders: false, triggersModel: 'hardcoded-value' },
      dlq: { modelName: 'hardcoded-dlq-name' },
    })

    assertEquals(Deno.env.get('DATABASE_SEEDERS'), 'true')
    assertEquals(Deno.env.get('TRIGGERS_MODEL_NAME'), 'from-real-environment')
    assertEquals(Deno.env.get('TEMPLATES_BACKEND'), 'remote')
    assertEquals(Deno.env.get('TEMPLATES_MODEL_NAME'), 'model')
    assertEquals(Deno.env.get('DLQ_MODEL_NAME'), 'from-real-environment')
  },
)

// --- assets: unlike database/notifications/dlq above, this ALSO constructs a real AssetService
// and self-registers it — the same "construct real infrastructure, self-register it globally"
// shape logger.elastic already has. `new S3ObjectStorage()`/`new MongoFileRepository()`
// are both safe to construct with zero real network/Mongo connection (confirmed: `S3ObjectStorage`
// builds its own `S3Client` lazily; `MongoFileRepository`'s `database` is a lazy getter,
// only resolved inside `.model()`, which nothing here ever calls) — so these tests need no real
// S3-compatible/Mongo instance, same as every other `setup()` test in this file. ----------------

envTest('setup(): assets options set the expected env vars', () => {
  setup({
    assets: {
      s3Endpoint: 'http://localhost:8333',
      s3AccessKey: 'access-key',
      s3SecretKey: 'secret-key',
      s3Bucket: 'custom-assets',
      encrypt: 'symmetric',
      encryptVersion: 'v1',
      filesModelName: 'custom-files',
    },
  })

  assertEquals(Deno.env.get('S3_ENDPOINT'), 'http://localhost:8333')
  assertEquals(Deno.env.get('S3_ACCESS_KEY'), 'access-key')
  assertEquals(Deno.env.get('S3_SECRET_KEY'), 'secret-key')
  assertEquals(Deno.env.get('S3_BUCKET'), 'custom-assets')
  assertEquals(Deno.env.get('S3_ENCRYPT'), 'symmetric')
  assertEquals(Deno.env.get('S3_ENCRYPT_VERSION'), 'v1')
  assertEquals(Deno.env.get('FILE_MODEL_NAME'), 'custom-files')
})

envTest(
  'setup(): unset assets fields leave their env vars untouched',
  () => {
    setup({ assets: { s3Bucket: 'only-this-one' } })

    assertEquals(Deno.env.get('S3_BUCKET'), 'only-this-one')
    assertEquals(Deno.env.get('S3_ENDPOINT'), undefined)
    assertEquals(Deno.env.get('S3_ENCRYPT'), undefined)
    assertEquals(Deno.env.get('FILE_MODEL_NAME'), undefined)
  },
)

envTest(
  'setup(): an already-set S3/FILE env var always wins over a ConfigOptions value',
  () => {
    Deno.env.set('S3_BUCKET', 'from-real-environment')
    Deno.env.set('FILE_MODEL_NAME', 'from-real-environment')

    setup({ assets: { s3Bucket: 'hardcoded-value', filesModelName: 'hardcoded-value' } })

    assertEquals(Deno.env.get('S3_BUCKET'), 'from-real-environment')
    assertEquals(Deno.env.get('FILE_MODEL_NAME'), 'from-real-environment')
  },
)

envTest(
  'setup(): assets constructs a real AssetService and self-registers it, S3-only (no localDir)',
  () => {
    setup({ assets: { s3Bucket: 'test-bucket' } })

    const service = getAssetsService()
    assertExists(
      service,
      'expected setup({ assets }) to construct and register a real AssetService',
    )
    assertEquals(typeof service.createAsset, 'function')
    assertEquals(typeof service.getAsset, 'function')
    assertEquals(typeof service.downloadVariant, 'function')
  },
)

envTest(
  'setup(): assets.localDir constructs an AssetService with local fallback/migration wired in',
  () => {
    setup({ assets: { s3Bucket: 'test-bucket', localDir: './zanix-core-test-assets-fallback' } })

    const service = getAssetsService()
    assertExists(service, 'expected a real AssetService even with localDir configured')
  },
)

envTest(
  'setup(): omitting assets entirely never touches the previously-registered AssetService',
  () => {
    setup({ assets: { s3Bucket: 'test-bucket' } })
    const before = getAssetsService()
    assertExists(before)

    setup({ database: { seeders: true } })

    assertEquals(getAssetsService(), before, 'expected the singleton to be left untouched')
  },
)
