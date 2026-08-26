# Zanix - Core

[![Version](https://img.shields.io/jsr/v/@zanix/core?color=blue\&label=jsr)](https://jsr.io/@zanix/core/versions)
[![Release](https://img.shields.io/github/v/release/zanix-io/core?color=blue\&label=git)](https://github.com/zanix-io/core/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

---

## 🧭 Table of Contents

1. [Description](#-description)
2. [Features](#-features)
3. [Installation](#-installation)
4. [Basic Usage](#-basic-usage)
5. [Admin APIs](#-admin-apis)
6. [Documentation](#-documentation)
7. [Contributing](#-contributing)
8. [Changelog](#-changelog)
9. [License](#-license)
10. [Resources](#-resources)

---

## 🧩 Description

**Zanix Core** is the foundational library of the **Zanix** ecosystem — a modular toolkit designed
to power Zanix applications and provide the core configuration layer for all Zanix-based projects.

It serves as the entry point for initializing, configuring, and managing core application services
within the Zanix framework.

---

## ✨ Features

- **Comprehensive core utilities** for initializing, configuring, and managing Zanix projects with
  ease.
- **Built-in support** for modern communication layers including **REST**, **GraphQL**,
  **WebSocket**, and **SSR** servers.
- **Lightweight and scalable project bootstrapping**, designed to grow seamlessly with your
  application.
- **Built-in, opt-in admin APIs** for managing persisted triggers, notification templates, and Dead
  Letter Queue entries at runtime, plus a background-worker mode for processes that only run jobs —
  see [Admin APIs](#-admin-apis) and [Basic Usage](#-basic-usage) below.

## 📦 Installation

Install **Zanix Core** in your project using [Deno](https://deno.com/):

```ts
import core from 'jsr:@zanix/core@[version]'
```

---

**Important Setup Notes:**

1. **Install Deno** Ensure Deno is installed on your system. Follow the official guide:
   [Deno Installation Guide](https://docs.deno.com/runtime/getting_started/installation)

2. **VSCode Extension (Recommended)** For syntax highlighting, IntelliSense, and linting, install
   the **Deno extension** from the
   [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno).

3. **Add Deno to PATH** Make sure Deno is accessible from your system’s terminal:

   - **macOS/Linux**: Add to your shell configuration file (e.g., `.bashrc`, `.zshrc`):

     ```bash
     export PATH="$PATH:/path/to/deno"
     ```
   - **Windows**: Add the Deno folder to your `PATH` via Environment Variables.

---

## 🚀 Basic Usage

Example of how to bootstrap a Zanix project:

```typescript
import Zanix from 'jsr:@zanix/core@[version]'

// Initialize your project
await Zanix.bootstrap({
  server: {
    rest: { onCreate, ...options },
    graphql: { onCreate, ...options },
    socket: { onCreate, ...options },
  },
})
```

For more advanced examples and configuration options, refer to the full documentation.

### Graceful shutdown

`Zanix.bootstrap()`/`Zanix.start()` automatically traps `SIGINT`/`SIGTERM` (no opt-out) — either
signal runs `Zanix.stop()` before exiting: HTTP servers drain in-flight requests via
`Deno.serve()`'s own `.shutdown()`, then connector connections close. No code required — this is
what a `docker stop`/Kubernetes pod termination (both send `SIGTERM` by default) already gets
automatically. Calling `Zanix.stop()` yourself still works exactly as before, for any other shutdown
trigger your own code needs.

### Worker mode

For a process that only runs background jobs (no HTTP servers), use `Zanix.startWorker()` instead of
`Zanix.start()`/`Zanix.bootstrap()`:

```typescript
import Zanix from 'jsr:@zanix/core@[version]'

await Zanix.startWorker()
```

This loads the same cross-package core dependencies as `Zanix.start()` — including
`@zanix/datamaster`'s built-in `mail`/`request` trigger job handlers — then delegates to
`@zanix/asyncmq`'s worker bootstrap and keeps the process alive until a `SIGINT` terminates it.
`Zanix.stopWorker()` closes the worker's connector connections but does not itself terminate the
process — call it before your own shutdown logic exits the process, not as a replacement for it.

### Static composition (no boot)

For a process that only needs to introspect what `Zanix.start()`/`Zanix.bootstrap()` WOULD register
— e.g. a CLI tool statically generating an OpenAPI spec from `@zanix/server`'s
`ProgramModule.routes.getRoutes('rest')` — use `Zanix.compose()` instead. It registers this
project's own decorator metadata (cross-package core provider/connector slots, plus this project's
own auto-discovered handlers, attributed to the default Application) without starting any server or
activating any real infrastructure:

```typescript
import Zanix from 'jsr:@zanix/core@[version]'

await Zanix.compose()
```

Pass `{ admin: true }` as a second argument to also register `@zanix/admin`'s built-in local admin
app (and its enabled triggers/templates/dlq sub-apps) — the same manifests `start()`'s own `admin`
option composes — so `/admin/service-token` and friends become visible via `getRoutes('rest')` too:

```typescript
await Zanix.compose(undefined, { admin: true })
```

This is safe because none of those manifests declare `dependencies`/`resources`/`onStart`/
`onStop`/`jobs` — real resource construction and arbitrary lifecycle side effects (the actual thing
`compose()` protects against) never happen for this fixed set.

`Zanix.compose()` still deliberately excludes `apps` composition — unlike `admin` (a fixed set of
manifests known in advance), a project's own named `apps` are plain JS objects handed directly to
`start()`/`bootstrap()` at runtime, never auto-discoverable from decorated files the way `rootDir`'s
scan is; and even if they were discoverable, an arbitrary Zanix App can declare real `dependencies`/
`onStart` that `activateApps()` would genuinely activate (a live DB connection, an arbitrary side
effect) — which would break the "safe to call with zero side effects" guarantee this method exists
to provide. A static consumer like `zanix generate openapi` therefore still can't see a project's
own `apps`-scoped routes — only `admin`'s.

### SSR pages: standalone vs. named apps

`server.ssr` works exactly like `server.rest`/`server.graphql`/`server.socket` above — a plain
`ZanixSsrController` (see `@zanix/server`'s own `docs/handlers.md` → "SSR" for the full handler API)
attributes to the default `'main'` Application with no extra setup:

```typescript
await Zanix.start({ server: { ssr: { port: 3000 } } })
```

Use this directly when the project just needs one or a few hand-written SSR pages and isn't
composing a larger frontend. A composed frontend framework built on `@zanix/app`'s manifest (e.g.
`@zanix/space`, with its own routing/hydration/PWA) instead registers as a **named app**:

```typescript
await Zanix.start({
  apps: {
    storefront: { definition: spaceApp, server: { ssr: { port: 3000 } } },
  },
})
```

Both paths use the exact same `'ssr'` handler type underneath — the difference is composition, not
capability. Prefer the named-app form once the frontend has its own manifest/lifecycle/resources to
manage (that's what `apps` buys you: Application identity, independent resources, and — in a future
distributed-runtime mode — embedded/remote portability with no code change); reach for the
standalone `server.ssr` form only for a project that never needs any of that. There's no automatic
port sharing between the two: a named app's `server.ssr` with no explicit `port` falls back to its
own default (`STATIC_PORT`), not main's — pass the identical `port` value on both sides if you
actually want them on one listener.

### Named apps: shared resources and behavior overrides

Every entry under `apps` is a `defineZanixApp()` manifest (`ZanixAppBootstrapOptions` —
`{ definition, server?, uses?, behaviors? }`). All named apps (plus `admin`, when enabled) resolve
together as one batch, so two apps that declare a dependency on the same root resource share a
single instance instead of each constructing their own:

```typescript
await Zanix.start({
  resources: {
    billingDb: { type: 'mongo', options: { uri: Deno.env.get('MONGO_URI') } },
  },
  apps: {
    billing: {
      definition: billingApp,
      uses: [{ slot: 'database', resourceName: 'billingDb' }],
      behaviors: { calculateDiscount: (order) => order.total * 0.1 },
    },
    invoicing: {
      definition: invoicingApp,
      uses: [{ slot: 'database', resourceName: 'billingDb' }],
    },
  },
})
```

- **`SetupOptions.resources`** declares root-level resources (e.g. a shared connector) that any
  named app can bind against.
- **`uses`** resolves one of that app's own manifest `dependencies` slots to a concrete entry from
  `resources` — the binding's `appName` is this entry's own `apps` key, never repeated in `uses`
  itself.
- **`behaviors`** overrides a pure function/strategy slot the app's own manifest declared (no
  construction, no `close()`, unlike `resources`/`uses`) — each key must be a `behaviors` name that
  app actually declared, and `Zanix.start()` throws before constructing anything if it isn't, or if
  `apps` never declares that app at all.

An entry with no `server` still registers (mount, jobs, resources, `setup`/`onStart`/`onStop`) but
is never served over HTTP — useful for an app that only needs background jobs or shared resources.
See `ZanixAppBootstrapOptions`'s own JSDoc for the full shape.

### General configuration (`Zanix.setup()`)

`Zanix.setup()` wires cross-cutting configuration that isn't part of the HTTP/worker bootstrap
itself: error-log throttling, logger configuration (including Elasticsearch/OpenSearch-backed
persistence), and non-secret `@zanix/datamaster`/`@zanix/notifications` config (including its
`DLQProvider`) that would otherwise mean setting several env vars by hand. It returns a `Promise`
(`assets` — see below — is the one option resolved through a real `await` internally); every other
option still completes synchronously, but `await` it regardless for a stable contract regardless of
which options are passed.

```typescript
import Zanix from 'jsr:@zanix/core@[version]'

await Zanix.setup({
  errors: { logThrottle: { threshold: 100, windowMs: 10 * 60_000 } },
  logger: { elastic: true },
  database: { seeders: false, triggersModel: 'my-triggers' },
  notifications: { templatesBackend: 'local' },
  dlq: { modelName: 'my-dlq', encryptPayload: true },
})

await Zanix.start()
```

**Call it before `Zanix.start()`/`Zanix.startWorker()`.** `database`/`notifications`/`dlq`/`assets`
options work by setting env vars (`Deno.env.set`) that `@zanix/datamaster`/`@zanix/notifications`
read at their own module-import time — calling `Zanix.setup()` after `Zanix.start()` has already
imported those modules has no effect on them. `errors`/`logger` have no such ordering requirement.

**An already-set env var always wins.** Every `database`/`notifications`/`dlq`/`assets` option here
only sets its env var when that var isn't already present (an empty string counts as not present) —
the deployment platform/container's own configuration is the authority; these options are just the
app-level default for when nothing else specified a value. To force a value regardless of the
environment, set it directly via `Deno.env.set()` instead of through `Zanix.setup()`.

| Option                                                                                          | Sets / wires                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `errors.logThrottle`                                                                            | `@zanix/server`'s `ErrorLogThrottle` — no env var fallback, explicit options only.                                                                                                                                                                                                                                                                                                                                                   |
| `errors.uncaughtMonitor`                                                                        | `@zanix/server`'s `UncaughtErrorMonitor` — no env var fallback, explicit options only.                                                                                                                                                                                                                                                                                                                                               |
| `logger.elastic`                                                                                | Elasticsearch/OpenSearch-backed logging. `true` (or leaving it unset while `SEARCH_ENGINE` is `elasticsearch`/`opensearch`) enables it — same `SEARCH_ENGINE`/`SEARCH_URL` env vars `Zanix.start()`'s zero-config `search` connector already reads; `false` opts out even if one of those is selected (logs then fall back to `@zanix/utils`'s own default file-based storage). `SEARCH_ENGINE=meilisearch` never auto-enables this. |
| `logger.formatter` / `logger.disableGlobalAssign`                                               | Forwarded as-is to `@zanix/utils`'s `Logger`. There's no `storage.save` option here — `setup()` always decides how logs get saved (via `elastic`, or its own default fallback); construct your own `new Logger({storage: {save: ...}})` directly if you need a fully custom, non-Elasticsearch save function.                                                                                                                        |
| `database.seeders`                                                                              | `DATABASE_SEEDERS`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `database.triggersModel`                                                                        | `TRIGGERS_MODEL_NAME`                                                                                                                                                                                                                                                                                                                                                                                                                |
| `database.seedModel`                                                                            | `SEED_MODEL_NAME`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `database.triggersPollInterval`                                                                 | `TRIGGERS_POLL_INTERVAL`                                                                                                                                                                                                                                                                                                                                                                                                             |
| `database.triggersChangeStream`                                                                 | `TRIGGERS_CHANGE_STREAM`                                                                                                                                                                                                                                                                                                                                                                                                             |
| `notifications.templatesBackend`                                                                | `TEMPLATES_BACKEND` — `'local'`/`'remote'`; `'remote'`'s own `TEMPLATES_SERVICE_URL`/etc. aren't wired here, set them directly.                                                                                                                                                                                                                                                                                                      |
| `notifications.templatesModel`                                                                  | `TEMPLATES_MODEL_NAME`                                                                                                                                                                                                                                                                                                                                                                                                               |
| `dlq.modelName`                                                                                 | `DLQ_MODEL_NAME` — names `DLQProvider`'s collection.                                                                                                                                                                                                                                                                                                                                                                                 |
| `dlq.encryptPayload`                                                                            | `DLQ_ENCRYPT_PAYLOAD` — forces `registerDLQModel`'s `encryptPayload` on/off regardless of what's passed to that call directly.                                                                                                                                                                                                                                                                                                       |
| `dlq.defaultLeaseMs`                                                                            | `DLQ_DEFAULT_LEASE_MS` — default `DLQProvider.claim()` lease duration (ms) when no per-call `leaseTtlMs` is passed.                                                                                                                                                                                                                                                                                                                  |
| `assets.s3Endpoint` / `s3AccessKey` / `s3SecretKey` / `s3Bucket` / `encrypt` / `encryptVersion` | `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` / `S3_ENCRYPT` / `S3_ENCRYPT_VERSION`.                                                                                                                                                                                                                                                                                                                               |
| `assets.filesModelName`                                                                         | `FILE_MODEL_NAME` — names `MongoFileRepository`'s collection.                                                                                                                                                                                                                                                                                                                                                                        |

### Assets: `Zanix.setup({ assets })` builds a real `AssetService`

Unlike `database`/`notifications`/`dlq` above (env vars only), `assets` **also constructs real
infrastructure** and self-registers it — the same shape `logger.elastic` already has (`new
Logger()`
self-registers globally; `import logger from '@zanix/logger'` reads it back).
`Zanix.setup({ assets })` builds `S3ObjectStorage` (+ an optional local fallback/migration, when
`localDir` is given) and `MongoFileRepository` (adapted via `@zanix/space/assets-api`'s
`createAssetRepositoryOverFiles`), wires them into a real `AssetService`, and registers it — read it
back with `Zanix.getAssetsService()`.

`@zanix/space`/`@zanix/datamaster`'s Asset API dependencies (`sharp`/`svgo`, `@aws-sdk/client-s3`,
`mongoose`) are resolved lazily, only when `assets` is actually passed — a service that never calls
`Zanix.setup({ assets })` never pays for any of them merely by importing `@zanix/core`. This is why
`Zanix.setup()` returns a `Promise`: `await` it before reading `Zanix.getAssetsService()`.
`Zanix.getAssetsService()` itself returns `unknown`, not the real `AssetService`, for the same
reason — recover the real type with a cast at the point you already import `@zanix/space/assets-api`
for real:

```typescript
import Zanix from 'jsr:@zanix/core@[version]'
import { defineSpaceApp } from 'jsr:@zanix/space@[version]'
import type { AssetService } from 'jsr:@zanix/space@[version]/assets-api'

await Zanix.setup({
  assets: { s3Bucket: 'prod-assets', localDir: './local-assets' },
})

const app = defineSpaceApp({
  name: 'storefront',
  assetsApi: { service: Zanix.getAssetsService() as AssetService },
})

await Zanix.start({ apps: { storefront: { definition: app, server: { ssr: {} } } } })
```

There is no separate "enabled" flag — passing the `assets` block at all (even `{}`) is the
activation signal; every field, including `localDir`, is optional and each sets its own env var only
when not already present, same precedence as every other option above. Omit `assets` entirely and
nothing is constructed, at zero cost. See `@zanix/datamaster`'s own
[Storage docs](https://jsr.io/@zanix/datamaster/doc/~/S3ObjectStorage) for what each
`s3*`/`encrypt*` field configures, and `@zanix/space`'s own docs for `SpaceAppConfig.assetsApi`.

---

## 🔐 Admin APIs

`Zanix.start({ admin: true })` bootstraps a second, **anchored, `'admin'`-Application** server
(never reachable through the public `server` options above) that exposes four built-in APIs, all
owned by `@zanix/admin` and re-exported from this package's own `mod.ts` unchanged. **Disabled by
default** — omit `admin` (or pass `false`) and none of this is registered at all:

```typescript
await Zanix.start() // no admin server (default)
await Zanix.start({ admin: true }) // enabled, shares server's own per-type port by default
await Zanix.start({ admin: { rest: { port: 4000 } } }) // enabled, explicit REST port
```

- **`/admin/triggers`** — manage `@zanix/datamaster`'s persisted trigger configurations at runtime.
  Always registered once `admin` is enabled; set `TRIGGERS_MODEL_NAME=false` to disable.
- **`/admin/templates`** — manage `@zanix/notifications`'s Handlebars templates. Only registered
  once the app has selected `TEMPLATES_BACKEND=local` (a bare `TEMPLATES_MODEL_NAME` alone has no
  effect anymore — see `@zanix/notifications`'s `templatesBackendMode()`).
- **`/admin/dlq`** — manage `@zanix/datamaster`'s persisted Dead Letter Queue entries. Opt-in, the
  same shape as `/admin/templates` — only registered once `DLQ_MODEL_NAME` is set (see
  `Zanix.setup({ dlq: { modelName } })` above, or set the env var directly).
- **`/admin/service-token`** — machine-to-machine credential exchange (`exchangeServiceCredential`):
  POST `{ assertion }`, get back a `type: 'api'` access token to use against this service's other
  admin/business APIs. Registered whenever `admin` is enabled, unauthenticated by design.

The triggers, templates, and DLQ APIs each require a role (`ADMIN_ROLE`, or
`ADMIN_TRIGGERS_ROLE`/`ADMIN_TEMPLATES_ROLE`/`ADMIN_DLQ_ROLE` for just one of the three), via
`@zanix/auth`'s `@AuthTokenValidation`, and accept either a human admin's `type: 'user'` token or a
machine caller's `type: 'api'` one on the same route. Set **`ADMIN_SERVER_ID`** to pin the admin
API's URL path prefix to a stable address instead of the random one generated by default.
`@zanix/admin`'s own `TriggersAdminClient`/`TemplatesAdminClient`/`DlqAdminClient` (re-exported
here) let a consumer call another service's admin API remotely without hand-rolling an HTTP client,
and `ZanixAdminHub` (also re-exported) is `@zanix/admin`'s own reference deployable entrypoint, for
standing up the centralized orchestrator alongside this service's own business API in the same
process — **`admin` on `Zanix.start()` is safe to also enable in that same process**; the two
register under distinct Applications (`ADMIN_APPLICATION` vs. `ZanixAdminHub`'s own
`ADMIN_HUB_APPLICATION`), so there's no collision and no runtime guard against it.

See [`docs/admin-apis.md`](./docs/admin-apis.md) for the full guide: the `admin` option's shape and
port-sharing rules, role assignment, the `X-Znx-Admin-Protocol` header, and `ADMIN_SERVER_ID`; see
[`docs/admin-architecture.md`](./docs/admin-architecture.md) for worked examples of
`TriggersAdminClient`/`TemplatesAdminClient` and `ZanixAdminHub`, and how this service's own admin
API relates to the centralized `ZanixAdminHub` orchestrator.

---

## 📚 Documentation

- [`docs/admin-apis.md`](./docs/admin-apis.md) — full guide to the built-in admin APIs.
- [`docs/admin-architecture.md`](./docs/admin-architecture.md) — this service's admin API vs. the
  centralized `ZanixAdminHub` orchestrator.

Find detailed documentation, guides, and examples at: 🔗
[https://github.com/zanix-io](https://github.com/zanix-io)

---

## 🤝 Contributing

Contributions are always welcome! To get started:

1. Open an issue for bug reports or feature requests.
2. Fork the repository and create a feature branch.
3. Implement your changes following the project’s guidelines.
4. Add or update tests as needed.
5. Submit a pull request with a clear and descriptive summary.

---

## 🕒 Changelog

Check the [`CHANGELOG`](./CHANGELOG.md) for a complete version history and release notes.

---

## 📜 License

This project is licensed under the **MIT License**. See [`LICENSE`](./LICENSE) for more information.

---

## 🔗 Resources

- [Deno Documentation](https://docs.deno.com/)
- [Zanix Framework](https://github.com/zanix-io)

---

_Developed with ❤️ by **Ismael Calle** | [@iscam2216](https://github.com/iscam2216)_
