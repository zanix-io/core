// deno-coverage-ignore-file

import { defineCoreMetadata, defineLocalMetadata } from 'utils/metadata.ts'
import { SEARCH_CONNECTOR_SOURCE } from './connector-source.ts'
import logger from '@zanix/logger'

// Run in a fresh subprocess (own module graph) — mirrors `worker.ts`/`tasker.ts`'s old, broken
// order, kept as a permanent regression guard against reintroducing it. See `core-before-local.ts`
// for why the connector is written to a throwaway temp dir rather than committed as a real
// `.connector.ts` file.
const originalCwd = Deno.cwd()
const tempDir = await Deno.makeTempDir()

try {
  await Deno.writeTextFile(
    `${tempDir}/search.connector.ts`,
    SEARCH_CONNECTOR_SOURCE,
  )
  Deno.chdir(tempDir)

  await defineLocalMetadata('.', ['.connector.ts'])
  await defineCoreMetadata()

  logger.success('OK')
} finally {
  Deno.chdir(originalCwd)
  await Deno.remove(tempDir, { recursive: true })
}
