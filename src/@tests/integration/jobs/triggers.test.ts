import { assertEquals } from '@std/assert'
import { DEFAULT_TRIGGER_JOBS, getRegisteredTriggerActionJobs } from '@zanix/database'
import { registerPendingTriggerActionJobs } from 'modules/jobs/triggers.ts'

// Real registry lookup (no mocking `registerPendingTriggerActionJobs`/`getRegisteredTriggerActionJobs`
// themselves), cross-package against `@zanix/datamaster`'s trigger-action-job registry — same
// shape as `@zanix/notifications`'s `integration/di-registration.test.ts` check for its own
// `registerMailTriggerJob()` against the same `getRegisteredTriggerActionJobs()` API.

Deno.test('registerPendingTriggerActionJobs registers "request" as a descriptor', () => {
  registerPendingTriggerActionJobs()

  const request = getRegisteredTriggerActionJobs().find((d) => d.actionKind === 'request')
  assertEquals(request?.name, DEFAULT_TRIGGER_JOBS.request)
  assertEquals(request?.processingQueue, 'soft')
})

Deno.test({
  name: 'registerPendingTriggerActionJobs is a no-op on a second call in the same process',
  fn: () => {
    // Guards against re-registering (and throwing) on a second `defineCoreMetadata()` cycle, e.g.
    // many independent `Zanix.bootstrap()` calls in one `deno test` run — see this function's own
    // doc for why neither registry involved is ever wiped between boots.
    registerPendingTriggerActionJobs()
    registerPendingTriggerActionJobs()
  },
})
