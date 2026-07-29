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
- **Built-in support** for modern communication layers including **REST**, **GraphQL**, and
  **WebSocket** servers.
- **Lightweight and scalable project bootstrapping**, designed to grow seamlessly with your
  application.
- **Built-in admin APIs** for managing persisted triggers and notification templates at runtime,
  plus a background-worker mode for processes that only run jobs — see [Admin APIs](#-admin-apis)
  and [Basic Usage](#-basic-usage) below.

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

### General configuration (`Zanix.setup()`)

`Zanix.setup()` wires cross-cutting configuration that isn't part of the HTTP/worker bootstrap
itself: error-log throttling, logger configuration (including Elasticsearch/OpenSearch-backed
persistence), and non-secret `@zanix/datamaster`/`@zanix/notifications` config that would otherwise
mean setting several env vars by hand.

```typescript
import Zanix from 'jsr:@zanix/core@[version]'

Zanix.setup({
  errorLogThrottle: { threshold: 100, windowMs: 10 * 60_000 },
  logger: { elastic: true },
  database: { seeders: false, triggersModel: 'my-triggers' },
  notifications: { databaseTemplates: true },
})

await Zanix.start()
```

**Call it before `Zanix.start()`/`Zanix.startWorker()`.** `database`/`notifications` options work by
setting env vars (`Deno.env.set`) that `@zanix/datamaster`/`@zanix/notifications` read at their own
module-import time — calling `Zanix.setup()` after `Zanix.start()` has already imported those
modules has no effect on them. `errorLogThrottle`/`logger` have no such ordering requirement.

**An already-set env var always wins.** Every `database`/`notifications` option here only sets its
env var when that var isn't already present (an empty string counts as not present) — the deployment
platform/container's own configuration is the authority; these options are just the app-level
default for when nothing else specified a value. To force a value regardless of the environment, set
it directly via `Deno.env.set()` instead of through `Zanix.setup()`.

| Option                            | Sets / wires                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `errorLogThrottle`                | `@zanix/server`'s `ErrorLogThrottle` — no env var fallback, explicit options only.                                                                                                                                                                                                                                                   |
| `logger.elastic`                  | Elasticsearch/OpenSearch-backed logging. `true` (or leaving it unset while `ELASTICSEARCH_URL`/`OPENSEARCH_URL` is set) enables it — same env vars `Zanix.start()`'s zero-config `search` connector already reads; `false` opts out even if they're set. Takes precedence over a manually-provided `storage.save` if both are given. |
| everything else under `logger`    | `logger` accepts `@zanix/logger`'s own `LoggerFunctionOptions` as-is (`storage: { save, formatter } \| false`, `disableGlobalAssign`) alongside `elastic` — nothing here is reinvented, so any option the real `Logger` constructor takes works here too.                                                                            |
| `database.seeders`                | `DATABASE_SEEDERS`                                                                                                                                                                                                                                                                                                                   |
| `database.triggersModel`          | `TRIGGERS_MODEL_NAME`                                                                                                                                                                                                                                                                                                                |
| `database.seedModel`              | `SEED_MODEL_NAME`                                                                                                                                                                                                                                                                                                                    |
| `database.triggersPollInterval`   | `TRIGGERS_POLL_INTERVAL`                                                                                                                                                                                                                                                                                                             |
| `database.triggersChangeStream`   | `TRIGGERS_CHANGE_STREAM`                                                                                                                                                                                                                                                                                                             |
| `notifications.databaseTemplates` | `DATABASE_TEMPLATES`                                                                                                                                                                                                                                                                                                                 |
| `notifications.templatesModel`    | `TEMPLATES_MODEL_NAME`                                                                                                                                                                                                                                                                                                               |

---

## 🔐 Admin APIs

`Zanix.start()` bootstraps an **internal-only** server (never reachable through the public `server`
options above) that exposes three built-in APIs, all owned by `@zanix/admin` and re-exported from
this package's own `mod.ts` unchanged:

- **`/admin/triggers`** — manage `@zanix/datamaster`'s persisted trigger configurations at runtime.
  Always registered; set `TRIGGERS_MODEL_NAME=false` to disable.
- **`/admin/templates`** — manage `@zanix/notifications`'s Handlebars templates. Only registered
  once the app has opted into DB-backed templates (`DATABASE_TEMPLATES=true` or
  `TEMPLATES_MODEL_NAME` set).
- **`/admin/service-token`** — machine-to-machine credential exchange (`exchangeServiceCredential`):
  POST `{ assertion }`, get back a `type: 'api'` access token to use against this service's other
  admin/business APIs. Always registered, unauthenticated by design.

The triggers and templates APIs require a role (`ADMIN_ROLE`, or `ADMIN_TRIGGERS_ROLE`/
`ADMIN_TEMPLATES_ROLE` for just one of the two), via `@zanix/auth`'s `@AuthTokenValidation`, and
accept either a human admin's `type: 'user'` token or a machine caller's `type: 'api'` one on the
same route. Set **`ADMIN_SERVER_ID`** to pin the admin API's URL path prefix to a stable address
instead of the random one generated by default. `@zanix/admin`'s own `TriggersAdminClient`/
`TemplatesAdminClient` (re-exported here) let a consumer call another service's admin API remotely
without hand-rolling an HTTP client, and `ZanixAdmin` (also re-exported) is `@zanix/admin`'s own
reference deployable entrypoint, for standing up the centralized orchestrator alongside this
service's own business API in the same process.

See [`docs/admin-apis.md`](./docs/admin-apis.md) for the full guide: role assignment, the
`X-Znx-Admin-Protocol` header, `ADMIN_SERVER_ID`, and worked examples for `TriggersAdminClient`/
`TemplatesAdminClient` and `ZanixAdmin`.

---

## 📚 Documentation

- [`docs/admin-apis.md`](./docs/admin-apis.md) — full guide to the built-in admin APIs.

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
