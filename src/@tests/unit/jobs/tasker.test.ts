import { assertEquals, assertThrows } from '@std/assert'
import { processor } from 'modules/tasker.ts'

console.error = () => {}

Deno.test('importing tasker.ts registers the current process as an internal worker thread', () => {
  assertEquals(Deno.env.get('ZANIX_WORKER_EXECUTION'), 'internal-process')
})

Deno.test("processor forwards to asyncmq's baseProcessor", () => {
  assertThrows(
    () =>
      processor({
        taskId: 'zzz-nonexistent.handler',
        queue: 'soft',
        context: {} as never,
        attempt: 1,
        args: {},
      } as never),
    Error,
    'Tasker not found',
  )
})
