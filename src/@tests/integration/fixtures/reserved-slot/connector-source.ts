// deno-coverage-ignore-file

// The literal source of a connector that rewrites the reserved `search` core connector slot
// (mirrors a consumer app's own Elasticsearch connector). Deliberately NOT a real `.connector.ts`
// file in this repo — `core-before-local.ts`/`local-before-core.ts` write it into a throwaway temp
// directory at runtime instead, because `defineLocalMetadata()`'s own default-arg callers (e.g.
// `utils.test.ts`) scan the whole project tree by file extension; a permanent `.connector.ts` file
// decorated with the reserved `search` slot here would leak into every one of those, breaking
// whichever happens to run before anything in that shared test process has registered the slot.
export const SEARCH_CONNECTOR_SOURCE = `
import { Connector, ZanixSearchConnector } from '@zanix/server'

@Connector({ slot: 'search' })
export class FixtureSearchConnector extends ZanixSearchConnector {
  protected initialize() {}
  protected close() {}
  public isHealthy() {
    return true
  }
  public index() {
    return Promise.resolve()
  }
  public bulkIndex() {
    return Promise.resolve({ failed: 0, failedCount: 0 } as never)
  }
}
`
