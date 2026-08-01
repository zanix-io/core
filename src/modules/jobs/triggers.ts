import type { JobDefinition } from '@zanix/asyncmq/jobs'
import type { TriggerActionJobHandler, TriggerActions } from '@zanix/database'

import {
  DEFAULT_TRIGGER_JOBS,
  getRegisteredTriggerActionJobs,
  registerTriggerActionJob,
} from '@zanix/database'
import { registerJob } from '@zanix/asyncmq/jobs'

type RequestJobArgs = Pick<TriggerActions['request'], 'url' | 'method' | 'headers' | 'body'>

/**
 * Handler for the built-in `request` trigger action ({@link DEFAULT_TRIGGER_JOBS.request}).
 *
 * Performs a generic `fetch` — no external dependency needed beyond the runtime itself. Sends
 * `body` (already interpolated) as-is, if the trigger's action configured one; sends **no**
 * body at all otherwise — the full record is never sent automatically.
 *
 * Typed against `TriggerActionJobDescriptor`'s minimal `TriggerActionJobHandler` context (not
 * `@zanix/asyncmq`'s own `Job` type) — it doesn't need `interactors`/`connectors`/`context`, and
 * matching the same minimal shape every trigger-action handler uses (see `@zanix/notifications`'s
 * `mail` handler) keeps this consistent regardless of which package authors it.
 */
export const requestJobHandler: TriggerActionJobHandler<RequestJobArgs> = async function (args) {
  const { url, method, headers, body } = args

  await fetch(url, {
    method,
    headers: headers as HeadersInit,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/**
 * Registers `request`'s trigger-action job through the same descriptor mechanism any other
 * package uses (see `@zanix/database`'s `registerTriggerActionJob` for the full picture) —
 * `request` just happens to have no owner beyond this package (generic `fetch`, nothing
 * domain-specific about it), so it's registered directly here rather than self-registered from
 * another package's own `/core` entrypoint the way `@zanix/notifications` does for `mail`.
 */
const registerRequestTriggerJob = (): void => {
  registerTriggerActionJob('request', {
    name: DEFAULT_TRIGGER_JOBS.request,
    processingQueue: 'soft',
    handler: requestJobHandler,
  })
}

// `defineCoreMetadata()` can run more than once in a single process (e.g. many independent
// `Zanix.bootstrap()` cycles in one `deno test` run) — but neither `@zanix/database`'s trigger-
// action registry nor `@zanix/asyncmq`'s own job registry ever get wiped between boots (unlike
// routes/discovery), and both throw unconditionally on a duplicate name/actionKind. Previously
// this was implicitly protected by ES-module import caching (the old top-level
// `registerTriggerJobs()` call only ever ran once per process); now that registration happens via
// an explicitly-called function instead, it needs the same "runs once" guarantee made explicit.
let hasRegisteredTriggerJobs = false

/**
 * Drains every trigger-action job descriptor registered via `registerTriggerActionJob` — this
 * package's own `request` (registered just above) plus whatever any other package self-registered
 * from its own `/core` entrypoint (e.g. `@zanix/notifications`'s `mail`, see that package's own
 * doc) — and performs the actual `@zanix/asyncmq` `registerJob` call for each. This is the *only*
 * place that happens, so a package registering its own trigger-action job never needs to depend on
 * `@zanix/asyncmq` itself — it just describes `{name, processingQueue, handler}`.
 *
 * A no-op after the first call in a given process (see the guard above) — safe to call every time
 * `defineCoreMetadata` runs.
 *
 * Exported so `utils/metadata.ts`'s `defineCoreMetadata` can call this strictly *after* every
 * package's own `/core` entrypoint has finished loading — those entrypoints are what populate the
 * registry this drains, so draining it any earlier risks missing a descriptor still being
 * registered concurrently.
 */
export const registerPendingTriggerActionJobs = (): void => {
  if (hasRegisteredTriggerJobs) return
  hasRegisteredTriggerJobs = true

  registerRequestTriggerJob()

  for (const jobData of getRegisteredTriggerActionJobs()) {
    registerJob(jobData as unknown as JobDefinition<never, unknown>)
  }
}
