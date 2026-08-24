import { assertEquals } from '@std/assert'
import { requestJobHandler } from 'modules/jobs/triggers.ts'

// `mailJobHandler`'s own behavior (mapping a `mail` trigger action onto `NotifierProvider`) now
// lives in `@zanix/notifications` (`sendMailTriggerNotification`, `MailTriggerActionData`) — see
// that package's own unit tests. This file only covers what `@zanix/core` itself still owns:
// `request` (the ownerless generic `fetch` handler).
//
// `registerPendingTriggerActionJobs()`'s own registration behavior (asserted against the real,
// cross-package `getRegisteredTriggerActionJobs()` registry) now lives in
// `src/@tests/integration/jobs/triggers.test.ts` — same tier as this repo's own
// `defineCoreMetadata` registration checks and `@zanix/notifications`'s
// `integration/di-registration.test.ts`.

Deno.test('requestJobHandler performs a fetch with the given url/method/headers/body', async () => {
  const calls: unknown[] = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(new Response(null, { status: 200 }))
  }) as typeof fetch

  try {
    await requestJobHandler.call({} as never, {
      url: 'http://localhost.com',
      method: 'POST',
      headers: { 'x-test': '1' },
      body: { hello: 'world' },
    })

    assertEquals(calls.length, 1)
    const { url, init } = calls[0] as { url: string; init: RequestInit }
    assertEquals(url, 'http://localhost.com')
    assertEquals(init.method, 'POST')
    assertEquals(init.body, JSON.stringify({ hello: 'world' }))
  } finally {
    globalThis.fetch = originalFetch
  }
})

Deno.test('requestJobHandler omits the body when the action configured none', async () => {
  const calls: unknown[] = []
  const originalFetch = globalThis.fetch

  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(new Response(null, { status: 200 }))
  }) as typeof fetch

  try {
    await requestJobHandler.call({} as never, {
      url: 'http://localhost.com',
      method: 'GET',
      headers: {},
    })

    const { init } = calls[0] as { init: RequestInit }
    assertEquals(init.body, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})
