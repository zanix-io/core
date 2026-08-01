import { assertEquals } from '@std/assert'
import { DEFAULT_TRIGGER_JOBS, getRegisteredTriggerActionJobs } from '@zanix/database'
import { registerPendingTriggerActionJobs, requestJobHandler } from 'modules/jobs/triggers.ts'

// `mailJobHandler`'s own behavior (mapping a `mail` trigger action onto `NotifierProvider`) now
// lives in `@zanix/notifications` (`sendMailTriggerNotification`, `MailTriggerActionData`) — see
// that package's own unit tests. This file only covers what `@zanix/core` itself still owns:
// `request` (the ownerless generic `fetch` handler) and the descriptor drain loop.

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
