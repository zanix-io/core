import { assert } from '@std/assert'
import { adminApplicationIsATypeError } from './admin-application-type-error.fixture.ts'

Deno.test(
  "SetupOptions.admin.<type>.application is a compile-time error (see fixture's @ts-expect-error)",
  () => {
    // The real assertion is at compile time in the imported fixture; this just confirms the
    // fixture module actually participated in `deno test`'s default type-checking pass rather
    // than being silently excluded from the graph.
    assert(adminApplicationIsATypeError)
  },
)
