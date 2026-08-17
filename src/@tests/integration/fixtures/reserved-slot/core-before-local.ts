// deno-coverage-ignore-file

import { defineCoreMetadata, defineLocalMetadata } from 'utils/metadata.ts'
import { SEARCH_CONNECTOR_SOURCE } from './connector-source.ts'
import logger from '@zanix/logger'

// Run in a fresh subprocess (own module graph) — mirrors `worker.ts`/`tasker.ts`'s fixed order.
// The connector is written into a throwaway temp dir (see `connector-source.ts`'s own doc for why
// it isn't a real, permanently-committed `.connector.ts` file), and `defineLocalMetadata('.', ...)`
// — same literal call worker.ts/tasker.ts make — is pointed at it via `Deno.chdir`.
const originalCwd = Deno.cwd()
const tempDir = await Deno.makeTempDir()

try {
  await Deno.writeTextFile(
    `${tempDir}/search.connector.ts`,
    SEARCH_CONNECTOR_SOURCE,
  )
  Deno.chdir(tempDir)

  await defineCoreMetadata()
  await defineLocalMetadata('.', ['.connector.ts'])

  logger.success('OK')
} finally {
  Deno.chdir(originalCwd)
  await Deno.remove(tempDir, { recursive: true })
}
