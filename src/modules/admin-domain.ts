/**
 * The admin domain's own re-export surface — everything root `mod.ts` re-exports from
 * `@zanix/admin` (bare root, including `ZanixAdminHub`), `@zanix/notifications/templates-api`, and
 * `@zanix/datamaster/triggers-api`/`/dlq-api`, kept in its own file so it's a separate concern from
 * the `Zanix` bootstrap class (`zanix.ts`), and so root `mod.ts` stays a thin re-export of both
 * files rather than one bloated barrel mixing admin-domain re-exports with bootstrap logic.
 *
 * Unlike `zanix.ts`, nothing here is resolved lazily: every symbol below is an RTO class, a thin
 * HTTP client, or a controller factory that a consumer reaching for it ALWAYS wants the real thing
 * for (there's no "gate" to defer behind the way `admin`/`codeTemplatesDiscovery` gate `start.ts`'s
 * own `@zanix/admin` dependency) — so this file, and any subpath that re-exports it, unconditionally
 * reaches Handlebars (`@zanix/notifications/templates-api`'s own template-validation dependency) and
 * `mongoose` (both `@zanix/notifications`' and `@zanix/datamaster`'s Mongo-backed repositories). The
 * split's only goal is keeping `mod.ts` itself thin and letting `zanix.ts`'s new narrow subpath
 * avoid this file's graph entirely, not reducing this file's OWN footprint.
 *
 * `ZanixAdminHub` stays imported from `@zanix/admin`'s bare root here, NOT its `/hub` subpath —
 * deliberately: this file's neighboring `ADMIN_*_ROLE`/`createServiceExchangeController`/
 * `TriggersAdminClient`/`TemplatesAdminClient`/`DlqAdminClient` re-exports have no narrower subpath
 * of their own today and so already require resolving that same bare root regardless — confirmed
 * via a real `deno info --json` repro that switching just `ZanixAdminHub`'s own specifier changes
 * nothing about this file's (or root `mod.ts`'s) total footprint.
 */

// `@zanix/admin` composes the admin domain (roles, protocol version/header + negotiation guard,
// the service-exchange controller, and the protocol clients); the local-api CRUD controllers and
// their RTOs are authored by their real data owners, `@zanix/notifications` and `@zanix/datamaster`
// (triggers, templates, and — as of `@zanix/admin@^2.0.0` — DLQ alike) — see `docs/admin-apis.md`
// for the full guide, and the "Local API vs Aggregator API" rule in the `zanix-libraries-architecture`
// skill.
export {
  ADMIN_DLQ_ROLE,
  ADMIN_PROTOCOL_HEADER,
  ADMIN_PROTOCOL_SUPPORTED_VERSIONS,
  ADMIN_PROTOCOL_VERSION,
  ADMIN_ROLE,
  ADMIN_TEMPLATES_ROLE,
  ADMIN_TRIGGERS_ROLE,
  createServiceExchangeController,
  DlqAdminClient,
  ServiceExchangeRTO,
  TemplatesAdminClient,
  TemplatesAdminRepository,
  TemplatesAdminService,
  TriggersAdminClient,
  TriggersAdminRepository,
  TriggersAdminService,
} from '@zanix/admin'

/**
 * `@zanix/admin`'s reference deployable entrypoint — the centralized orchestrator that aggregates
 * `/admin/triggers`/`/admin/templates`/`/admin/dlq` across a fleet of `@zanix/core`-based services.
 * Re-exported here so a team that wants both roles (this service's own business API, plus the
 * centralized admin hub) in the same process can do so via `@zanix/core` alone, without a separate
 * import.
 *
 * `ZanixAdminHub.start()` and `Zanix.start()` both resolve their own public REST server's port from
 * the same env-var fallback chain — calling both in the same process without passing distinct
 * ports to at least one of them will fail with `AddrInUse`. See `@zanix/admin`'s own docs for
 * `ZanixAdminHub.start`'s options.
 *
 * Safe to also enable `Zanix.start()`'s own `admin` option in the same process as
 * `ZanixAdminHub.start()` — there is no runtime guard against this, and none is needed: the two
 * register `@zanix/admin` metadata under distinct Applications (this service's own triggers/
 * templates/dlq/service-token routes under `ADMIN_APPLICATION`, `ZanixAdminHub`'s own
 * triggers-proxy/templates-store/dlq-proxy routes under its own `ADMIN_HUB_APPLICATION` —
 * deliberately different route sets, see `docs/admin-apis.md`'s "Architecture" section), so
 * neither's routes collide with or overwrite the other's, in either call order, even without an
 * `await` between them. See `core/src/@tests/functional/admin-hub-coexistence*.test.ts` for the
 * regression coverage, and `docs/admin-apis.md` for the full breakdown.
 *
 * Imported from `@zanix/admin`'s bare root, not its new `/hub` subpath — see this file's own top
 * doc for why switching wouldn't reduce this file's (or root `mod.ts`'s) footprint today, and the
 * cross-repo issue that blocks verifying `/hub` end-to-end from this package right now.
 */
export { default as ZanixAdminHub } from '@zanix/admin'
export {
  CreateTemplateRTO,
  TemplateParamsRTO,
  UpdateTemplateRTO,
} from '@zanix/notifications/templates-api'
export {
  CreateTriggerRTO,
  createTriggersAdminController,
  TriggerModelParamsRTO,
  UpdateTriggerRTO,
} from '@zanix/datamaster/triggers-api'
/**
 * `/admin/dlq`'s local-api CRUD controller and its RTOs — same "re-exported from the real data
 * owner unchanged" shape as triggers'/templates' own blocks above, one domain over.
 * `createDlqAdminController` builds the built-in `/admin/dlq` controller; the RTOs are its
 * request/response shapes. Opt-in — only registered once `DLQ_MODEL_NAME` is set (see
 * `docs/admin-apis.md`).
 *
 * `@zanix/datamaster`'s own `Dlq*`-cased names are re-exported here as the primary form —
 * `@zanix/datamaster`'s currently-pinned real published version (`^1.5.0`) only exports the older,
 * all-caps `DLQ*`-cased names, so the new names are aliased from the same real bindings at this
 * boundary rather than imported by name — no local link to `@zanix/datamaster` needed for this
 * rename alone. The old `DLQ*` names stay available, `@deprecated`, for this package's own public
 * API back-compat — same convergence `@zanix/admin`'s own `mod.ts` already did for its equivalent
 * re-exports today. Switch these to real by-name imports once a `@zanix/datamaster` release
 * publishes the rename.
 */
export {
  createDlqAdminController,
  DiscardDLQEntryRTO as DiscardDlqEntryRTO,
  DLQEntryIdParamsRTO as DlqEntryIdParamsRTO,
  ListDLQEntriesRTO as ListDlqEntriesRTO,
  PushDLQEntryRTO as PushDlqEntryRTO,
  RequeueDLQEntryRTO as RequeueDlqEntryRTO,
} from '@zanix/datamaster/dlq-api'
/** @deprecated Use {@link DlqEntryIdParamsRTO} instead — this alias will be removed in a future
 * major release. */
export { DLQEntryIdParamsRTO } from '@zanix/datamaster/dlq-api'
/** @deprecated Use {@link DiscardDlqEntryRTO} instead — this alias will be removed in a future
 * major release. */
export { DiscardDLQEntryRTO } from '@zanix/datamaster/dlq-api'
/** @deprecated Use {@link ListDlqEntriesRTO} instead — this alias will be removed in a future
 * major release. */
export { ListDLQEntriesRTO } from '@zanix/datamaster/dlq-api'
/** @deprecated Use {@link PushDlqEntryRTO} instead — this alias will be removed in a future major
 * release. */
export { PushDLQEntryRTO } from '@zanix/datamaster/dlq-api'
/** @deprecated Use {@link RequeueDlqEntryRTO} instead — this alias will be removed in a future
 * major release. */
export { RequeueDLQEntryRTO } from '@zanix/datamaster/dlq-api'
