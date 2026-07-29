# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2025-07-28

### Added

- `ADMIN_TRIGGERS_ISINTERNAL`/`ADMIN_TEMPLATES_ISINTERNAL` env vars (default `true`, matching
  today's behavior) to opt either built-in admin API out of `isInternal` — for a deployment that,
  for whatever reason, wants `/admin/triggers`/`/admin/templates` on its public server instead. The
  route path itself stays fixed either way. Internally, both routes are built by `@zanix/admin`'s
  own `createTriggersAdminController(options)`/`createTemplatesController(options)` factories
  (`defineAdminMetadata()` resolves `isInternal` from the env vars above and passes it straight
  through, pinning `prefix: 'admin/templates'` for the latter) instead of plain classes, since
  `@Controller`'s `isInternal`/`prefix` are decorator-time (static) config.
- Built-in internal-only admin APIs, `/admin/triggers` and `/admin/templates`, for managing
  `@zanix/datamaster`'s persisted triggers and `@zanix/notifications`'s templates at runtime
  (`ADMIN_ROLE`/`ADMIN_TRIGGERS_ROLE`/`ADMIN_TEMPLATES_ROLE`).
- `Zanix.setup()` for cross-cutting configuration: error-log throttling, logger/Elasticsearch
  wiring, and `@zanix/datamaster`/`@zanix/notifications` config.
- `Zanix.startWorker()`/`Zanix.stopWorker()` — bootstraps the current process as a standalone
  AsyncMQ worker instead of a web server, for a process that only runs background jobs. Loads the
  same cross-package core dependencies as `Zanix.start()` (including `@zanix/datamaster`'s built-in
  `mail`/`request` trigger job handlers), then hands off to `@zanix/asyncmq`'s own worker bootstrap
  and keeps the process alive until stopped (`Zanix.stopWorker()`, which closes connector
  connections, or a `SIGINT`, which also terminates the process).
- `X-Znx-Admin-Protocol` response header on every admin API response, versioning the admin
  protocol's request/response shapes independently of this package's own semver
  (`ADMIN_PROTOCOL_HEADER`, `ADMIN_PROTOCOL_VERSION`). `ADMIN_PROTOCOL_HEADER` (the header name) is
  re-exported from `@zanix/server`, which actually defines it, so `@zanix/notifications` can use the
  same name without depending on `@zanix/core`; `ADMIN_PROTOCOL_VERSION` (the version number) is
  owned by `@zanix/admin` (see `Changed` below) and re-exported here unchanged.
- `ADMIN_SERVER_ID` env var to pin the admin API's URL path prefix to a stable, per-type suffixed id
  across restarts, instead of the random one `@zanix/server` generates by default — needed once an
  external caller (e.g. a future centralized `zanix-admin` service) requires a fixed address to
  reach this service's admin API at.
- `TriggersAdminClient`/`TemplatesAdminClient` — thin `RestClient`-based HTTP clients for calling
  another service's own `/admin/triggers`/`/admin/templates` API remotely, so a consumer (e.g.
  `@zanix/admin`'s `TriggersAggregator`) reuses this single client implementation instead of a
  hand-rolled one that can drift from what the controllers actually accept.
- `CreateTemplateRTO`/`UpdateTemplateRTO`/`TemplateParamsRTO`, `TemplatesAdminRepository`/`Service`,
  `TriggersAdminRepository`/`Service`, `TriggerModelParamsRTO`, and
  `CreateTriggerRTO`/`UpdateTriggerRTO` also exported from `mod.ts` — see `Changed` below for where
  they're actually defined and why.
- Built-in internal-only `/admin/service-token` API — machine-to-machine credential exchange per
  `@zanix/auth`'s `docs/service-credential.md`. Always registered, unauthenticated by design (the
  caller has no session yet — the whole point of calling it is to obtain one). A thin wrapper around
  `@zanix/auth`'s new `exchangeServiceCredential`: POST `{ assertion }` (a JWT signed with the
  calling service's own key via `createServiceAssertion`), get back a real `type: 'api'` access
  token scoped to whatever `SERVICE_PERMISSIONS_<serviceId>`/ `SERVICE_RATE_LIMIT_<serviceId>` the
  operator configured for it. Carries the same `X-Znx-Admin-Protocol` header as the other two admin
  APIs.

### Changed

- `/admin/triggers`/`/admin/templates` now accept either a human admin's `type: 'user'` token or a
  machine caller's `type: 'api'` one on the same route (`AuthTokenValidation`'s `type` option now
  takes `['user', 'api']`, via `@zanix/auth`'s new array support) — unblocks
  `@zanix/notifications`'s `RemoteTemplateBackend` (and any other machine caller) from
  authenticating against these APIs without reusing a human-shaped session as a stopgap.
- **The admin domain now lives entirely in `@zanix/admin`, not here** — `ADMIN_ROLE`/
  `ADMIN_TEMPLATES_ROLE`/`ADMIN_TRIGGERS_ROLE`, the protocol registry (`ADMIN_PROTOCOL_VERSION`/
  `ADMIN_PROTOCOL_SUPPORTED_VERSIONS`, negotiated via `@zanix/server`'s generic `versionProtocol`
  option — see that package's own CHANGELOG), `TemplatesAdminService`/`Repository` + RTOs,
  `TriggersAdminService`/`Repository` + RTOs (the local, single-service CRUD business logic, not
  just the wire contract), the `/admin/service-token` controller
  (`createServiceExchangeController`), and `TemplatesAdminClient`/`TriggersAdminClient`. This
  package depends on `@zanix/admin` and re-exports the same symbols from its own `mod.ts` unchanged,
  so no consumer import needs to change. Previously `@zanix/admin` depended on `@zanix/core` to
  reuse a subset of these (an inverted dependency inconsistent with every other Zanix library, none
  of which depend on `@zanix/core` — it depends on them), and its own `/templates` controller
  duplicated `@zanix/core`'s `/admin/templates` controller almost verbatim. `@zanix/core`'s
  `defineAdminMetadata()` now calls `@zanix/admin`'s
  `createTriggersAdminController`/`createTemplatesController`/`createServiceExchangeController`
  directly — no local wrapper files, no duplicate controller classes. No public API change for
  existing `@zanix/core` consumers.
- `ZanixAdmin` (`@zanix/admin`'s own reference deployable entrypoint) is now re-exported as a named
  export from `@zanix/core`'s `mod.ts`, so a team that wants both roles — this service's own
  business API, plus the centralized admin hub — can do so via `@zanix/core` alone. `Zanix.start()`
  and `ZanixAdmin.start()` resolve their own public REST server's port from the same env-var
  fallback chain, so calling both in the same process needs a distinct `port` passed to at least one
  of them.
- The admin protocol is no longer purely informational: `@zanix/admin`'s controllers now configure
  `@zanix/server`'s generic `versionProtocol` option, which validates a caller's own declared
  `X-Znx-Admin-Protocol` request header against what it still understands, rejecting an unrecognized
  version with `400 Bad Request` instead of silently processing a request shape it may not actually
  understand. No behavior change for any existing caller — none send this header today, and absence
  always defaults to the current version.
- Removed the dead re-export of `adminProtocolInterceptor`/`adminProtocolGuard` — `@zanix/admin`
  deleted both functions in favor of `@zanix/server`'s generic `versionProtocol` option (see that
  package's own CHANGELOG), and nothing in this package ever called them directly. Neither was ever
  part of a released `@zanix/core` version.

## [0.2.3] - 2025-12-11

### Added

- AsyncMQ core library support.

## [0.2.2] - 2025-11-27

### Added

- Zanix Notifications core library support.

## [0.2.0] - 2025-11-19

### Changed

- Updated dependencies to their latest versions.

## [0.1.4] - 2025-11-04

### Added

- Zanix database core connector load

## [0.1.3] - 2025-10-23

### Changed

- Internal server definitions

## [0.1.2] - 2025-10-22

### Changed

- Server starting

## [0.1.1] - 2025-10-16

### Fixed

- Import modules from local

## [0.1.0] - 2025-10-16
