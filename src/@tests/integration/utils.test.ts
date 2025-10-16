import { assert } from '@std/assert'
import { defineLocalMetadata } from 'utils/metadata.ts'

Deno.test('defineLocalMetadata files', async () => {
  assert(!globalThis['_connectorExecuted' as never])
  assert(!globalThis['_interactorExecuted' as never])
  assert(!globalThis['_hocExecuted' as never])
  assert(!globalThis['_handlerExecuted' as never])

  await defineLocalMetadata()

  assert(globalThis['_connectorExecuted' as never])
  assert(globalThis['_interactorExecuted' as never])
  assert(globalThis['_hocExecuted' as never])
  assert(globalThis['_handlerExecuted' as never])
})
