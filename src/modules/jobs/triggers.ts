import type { TriggerActions } from '@zanix/database'
import type { Job } from '@zanix/asyncmq/jobs'

import { DEFAULT_TRIGGER_JOBS } from '@zanix/database'
import { registerJob } from '@zanix/asyncmq/jobs'
import type { NotifierProvider } from '@zanix/notifications'

type MailJobArgs = Pick<TriggerActions['mail'], 'to' | 'subject' | 'from' | 'date' | 'body'>
type RequestJobArgs = Pick<TriggerActions['request'], 'url' | 'method' | 'headers' | 'body'>

/**
 * Handler for the built-in `mail` trigger action ({@link DEFAULT_TRIGGER_JOBS.mail}).
 *
 * `body` arrives already interpolated (`{{field}}` placeholders resolved against the record) as
 * `{ template, data }`, mapped onto `NotifyMessageWithTemplate`'s top-level `zanixTemplate`/`data`
 * pair for `NotifierProvider.sendMessage('email', ...)`.
 */
export const mailJobHandler: Job<MailJobArgs, void> = async function (args) {
  const { to, subject, from, date, body } = args
  const { template, data } = body

  await this.providers.get<NotifierProvider>('notifications').sendMessage('email', {
    to,
    subject,
    from,
    date,
    // `template` is authored dynamically (a trigger's config), so it can't be statically narrowed
    // to the notifier's fixed template-name union — trusted at runtime instead.
    zanixTemplate: template,
    data,
  } as never)
}

/**
 * Handler for the built-in `request` trigger action ({@link DEFAULT_TRIGGER_JOBS.request}).
 *
 * Performs a generic `fetch` — no external dependency needed beyond the runtime itself. Sends
 * `body` (already interpolated) as-is, if the trigger's action configured one; sends **no**
 * body at all otherwise — the full record is never sent automatically.
 */
export const requestJobHandler: Job<RequestJobArgs, void> = async function (args) {
  const { url, method, headers, body } = args

  await fetch(url, {
    method,
    headers: headers as HeadersInit,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** Job DSL definitions for the built-in trigger actions. */
const registerTriggerJobs = () => {
  registerJob<MailJobArgs, void>({
    name: DEFAULT_TRIGGER_JOBS.mail,
    processingQueue: 'soft',
    handler: mailJobHandler,
  })

  registerJob<RequestJobArgs, void>({
    name: DEFAULT_TRIGGER_JOBS.request,
    processingQueue: 'soft',
    handler: requestJobHandler,
  })
}

/**
 * Core trigger-job loader for Zanix.
 *
 * Auto-registers the jobs `@zanix/datamaster`'s `mail`/`request` trigger actions dispatch to
 * (`DEFAULT_TRIGGER_JOBS.mail`/`.request`), so triggers work end-to-end with zero consumer-side
 * setup: `mail` calls `@zanix/notifications`'s `NotifierProvider.sendMessage('email', ...)`,
 * `request` performs a generic `fetch`. `custom` trigger actions are unaffected — they reference a
 * job the consuming app registers itself.
 *
 * Loaded by `defineCoreMetadata()` — runs for both the main server process (`Zanix.start()`) and
 * the worker process (`Zanix.startWorker()`), so the registration reaches whichever process
 * actually executes the job.
 *
 * @requires @zanix/datamaster
 * @requires @zanix/notifications
 * @requires @zanix/asyncmq
 * @decorator registerJob
 *
 * @module
 */
const zanixTriggerJobsCore: void = registerTriggerJobs()

export default zanixTriggerJobsCore
