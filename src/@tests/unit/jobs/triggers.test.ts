import { assertEquals } from '@std/assert'
import { mailJobHandler, requestJobHandler } from 'modules/jobs/triggers.ts'

Deno.test('mailJobHandler forwards fields to NotifierProvider.sendMessage', async () => {
  const calls: unknown[] = []

  const fakeThis = {
    providers: {
      get: () => ({
        sendMessage: (notifier: string, message: unknown) => {
          calls.push({ notifier, message })
          return Promise.resolve()
        },
      }),
    },
  }

  await mailJobHandler.call(fakeThis as never, {
    to: 'a@b.com',
    subject: 'Hi',
    from: 'noreply@example.com',
    body: { template: 'welcome', data: { name: 'A' } },
  })

  assertEquals(calls.length, 1)
  assertEquals((calls[0] as { notifier: string }).notifier, 'email')
  assertEquals(
    (calls[0] as { message: { to: string } }).message.to,
    'a@b.com',
  )
  assertEquals(
    (calls[0] as { message: { zanixTemplate: unknown; data: unknown } }).message.zanixTemplate,
    'welcome',
  )
  assertEquals(
    (calls[0] as { message: { zanixTemplate: unknown; data: unknown } }).message.data,
    { name: 'A' },
  )
})

Deno.test('mailJobHandler forwards a literal string as body.data as-is', async () => {
  const calls: unknown[] = []

  const fakeThis = {
    providers: {
      get: () => ({
        sendMessage: (notifier: string, message: unknown) => {
          calls.push({ notifier, message })
          return Promise.resolve()
        },
      }),
    },
  }

  await mailJobHandler.call(fakeThis as never, {
    to: 'a@b.com',
    subject: 'Hi',
    body: { template: 'generic', data: 'plain text body' },
  })

  assertEquals(
    (calls[0] as { message: { zanixTemplate: unknown } }).message.zanixTemplate,
    'generic',
  )
  assertEquals(
    (calls[0] as { message: { data: unknown } }).message.data,
    'plain text body',
  )
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
