import { assertThrows } from '@std/assert'
import { registerJob } from '@zanix/asyncmq/jobs'
import { DEFAULT_TRIGGER_JOBS } from '@zanix/datamaster/database'
import { defineCoreMetadata } from 'utils/metadata.ts'

console.error = () => {}

Deno.test(
  'defineCoreMetadata registers the built-in mail/request trigger jobs exactly once',
  async () => {
    await defineCoreMetadata()

    // registerJob throws on a duplicate name — this proves defineCoreMetadata already
    // registered both well-known trigger jobs above.
    assertThrows(() =>
      registerJob({
        name: DEFAULT_TRIGGER_JOBS.mail,
        processingQueue: 'soft',
        handler: async () => {},
      })
    )
    assertThrows(() =>
      registerJob({
        name: DEFAULT_TRIGGER_JOBS.request,
        processingQueue: 'soft',
        handler: async () => {},
      })
    )
  },
)
