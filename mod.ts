/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

/**
 * @module
 *
 * `@zanix/core` — the foundational library of the Zanix ecosystem, providing the core
 * configuration layer and entrypoint (`Zanix`) for initializing, configuring, and managing
 * REST/GraphQL/WebSocket servers and background-worker processes in Zanix-based projects. See
 * this package's own README for the full guide, including the built-in admin APIs re-exported
 * from `@zanix/admin`.
 */

// The admin-domain re-exports (`@zanix/admin`'s own roles/protocol/service-exchange/clients, plus
// the local-api CRUD controllers/RTOs authored by their real data owners — `@zanix/notifications`
// and `@zanix/datamaster`, for triggers/templates/DLQ) live in their own file, `admin-domain.ts`,
// separate from the `Zanix` bootstrap class below — see that file's own doc for why. Re-exported
// here unchanged (`export *` covers every named
// export that file declares, including its `@deprecated` `DLQ*`-cased aliases) so every symbol
// importable from this root today stays importable from it, at the same names. See
// `docs/admin-apis.md` for the full guide, and the "Local API vs Aggregator API" rule in the
// `zanix-libraries-architecture` skill.
export * from 'modules/admin-domain.ts'
export type { ConfigOptions } from 'typings/config.ts'
export type {
  AdminBootstrapServerOptions,
  AppsOptions,
  CodeTemplatesDiscoveryOptions,
  ComposeOptions,
  SetupOptions,
  ZanixAppBootstrapOptions,
} from 'typings/setup.ts'
export type { ErrorLogThrottleConfig, ErrorLogThrottleStore, WebServerTypes } from '@zanix/server'
export type { ElasticsearchLogSaveOptions } from '@zanix/datamaster/observability'
export type { DefaultResponse, LoggerFormatter, LoggerFunctionOptions } from '@zanix/types'
// `AssetService` and its own referenced types (`AssetRecord`/`CreateAssetCommand`/`AssetKind`/
// `AssetStatus`/`AssetVariant`/etc.) are deliberately NOT re-exported here. `@zanix/space/assets-api`
// unconditionally value-imports its real `AssetTransformer` composition (`sharp`/`svgo`,
// transitively) as part of the same entry file that defines `AssetService` — resolving that type
// requires resolving that whole module graph, exactly like a value import would, so re-exporting
// it here would materialize `sharp`/`svgo` for every consumer of `@zanix/core`, whether or not they
// ever use the Asset API. `Zanix.getAssetsService()` returns `unknown` instead of `AssetService`
// for the same reason — see that function's own doc for how a caller recovers the real type at the
// point where it's actually needed (already importing `@zanix/space/assets-api` for real, to call
// `defineSpaceApp({ assetsApi: {...} })`).

/**
 * `Zanix` — see `modules/zanix.ts`'s own doc for the full class doc. Imported from its own file,
 * re-exported here as this root's default export for backward compatibility — a caller that wants
 * ONLY this class, without also resolving this root's neighboring `admin-domain.ts` re-exports
 * (above, which reach `@zanix/notifications`'s bare `TemplateProvider`/`TemplatesAdminService` and
 * `@zanix/datamaster`'s Mongo-backed triggers/DLQ repositories — Handlebars and `mongoose`
 * unconditionally), should import `@zanix/core/bootstrap` instead. See `modules/zanix.ts`'s own
 * doc for why that subpath exists and what it avoids.
 */
export { default } from 'modules/zanix.ts'
