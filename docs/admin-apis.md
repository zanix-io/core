# Admin APIs

`Zanix.start()` bootstraps an **internal-only** server (never reachable through the public `server`
options) that exposes three built-in APIs:

- **`/admin/triggers`** — manage `@zanix/datamaster`'s persisted trigger configurations at runtime,
  without a redeploy. Always registered (the underlying `datamaster` module is on by default; set
  `TRIGGERS_MODEL_NAME=false` to disable both). Its underlying service/repository
  (`TriggersAdminService`/`TriggersAdminRepository`) is owned by `@zanix/admin` (this package
  depends on it, not the other way around) and re-exported from this package's own `mod.ts`
  unchanged, so a consuming app can reuse them to build its own custom triggers API instead of
  duplicating the CRUD logic.
- **`/admin/templates`** — manage `@zanix/notifications`'s Handlebars templates. Only registered
  once the app has opted into DB-backed templates (`DATABASE_TEMPLATES=true` or
  `TEMPLATES_MODEL_NAME` set) — see `@zanix/notifications`'s `docs/templates.md` for the per-service
  vs. shared-storage decision this depends on. Its underlying service/repository
  (`TemplatesAdminService`/`TemplatesAdminRepository`) is owned by `@zanix/admin` the same way, and
  re-exported here unchanged.
- **`/admin/service-token`** — machine-to-machine credential exchange, per `@zanix/auth`'s
  `docs/service-credential.md`. Always registered, unauthenticated (there's no session to gate yet —
  the caller is here to obtain one). A thin wrapper around `@zanix/auth`'s
  `exchangeServiceCredential`: POST `{ assertion }` (a JWT signed with the calling service's own key
  via `createServiceAssertion`), get back a real `type: 'api'` access token to use against this
  service's other admin/business APIs. Also built by `@zanix/admin`
  (`createServiceExchangeController`). See below for the two triggers/templates APIs; this one has
  no client wrapper of its own since it's a single POST — call it directly.

## Architecture: this service's admin API vs. the centralized `ZanixAdmin`

It's easy to read `Zanix.start()`'s admin server and `ZanixAdmin.start()` (below) as two "modes" of
the same admin API. They aren't — they're **two independent HTTP servers with independent route
sets**. Each business service exposes its own internal admin API; `ZanixAdmin` is a separate
application that may consume those APIs — it does not become them or replace them.

### High-level architecture

```text
                         ┌─────────────────────────┐
                         │ ZanixAdmin              │
                         │                         │
                         │ /triggers   (proxy)     │
                         │ /templates  (own store) │
                         └─────────────────────────┘
                                      │
                        TriggersAdminClient over HTTP
                                      │
            ┬─────────────────────────┴┬──────────────────────────┬
            │                          │                          │
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ billing              │   │ orders               │   │ inventory            │
│                      │   │                      │   │                      │
│ /admin/triggers      │   │ /admin/triggers      │   │ /admin/triggers      │
│ /admin/templates     │   │ /admin/templates     │   │ /admin/templates     │
│ /admin/service-token │   │ /admin/service-token │   │ /admin/service-token │
└──────────────────────┘   └──────────────────────┘   └──────────────────────┘
```

The relationship above differs by domain — the diagram's `TriggersAdminClient` arrow only exists for
triggers, not templates:

### Triggers: a pure proxy

`ZanixAdmin`'s `/triggers` owns no trigger data of its own. `TriggersAggregator` fans a `list()` out
across every service in its `ServiceRegistry` and proxies `get`/`create`/`update`/`remove` to
whichever service the call names, using `TriggersAdminClient` to call that service's own
`/admin/triggers` over HTTP. Today, there's no separate triggers storage on the `ZanixAdmin` side —
that makes this service's own `/admin/triggers` the infrastructure the centralized aggregator
depends on, not a redundant duplicate of it. A service only participates in trigger aggregation if
it exposes its own `/admin/triggers`; since that route exists whenever the persisted triggers module
is enabled (see above), disabling that module also removes the service from what `ZanixAdmin` can
aggregate.

### Templates: a storage decision

Unlike triggers, `ZanixAdmin`'s `/templates` owns its own data — its `TemplatesController` uses its
own `TemplatesAdminService` and its own database connector, entirely independent of any business
service's local one. This makes templates a **storage choice**, not an aggregation dependency: a
service typically picks one of two deployment models.

```text
Option A — per-service storage             Option B — centralized storage

Business Service                           Business Service
    │                                           │
    ├── Database                                └── RemoteTemplateBackend
    │                                                      │
    └── /admin/templates                                   ▼
                                                       ZanixAdmin
                                                           │
                                                        Database
                                                           │
                                                      /templates
```

Running both at once means two genuinely independent template stores, not one synced across two APIs
— unless your own application explicitly keeps them in sync. See `@zanix/notifications`'s
`docs/templates.md` for that "per-service vs. shared-storage" decision in full, including
`RemoteTemplateBackend`'s "Mode C".

### Running both servers

Running `await Zanix.start()` and `await ZanixAdmin.start({ port: 3001 })` (see
[below](#standing-up-the-centralized-orchestrator-alongside-this-service-zanixadmin)) in the same
process starts two completely independent HTTP servers — co-locating them doesn't connect them
automatically. If you want `ZanixAdmin`'s triggers aggregator to include this service, you still
have to register this service's own `ADMIN_SERVER_ID` address in `ZanixAdmin`'s `ServiceRegistry`
(`ZANIX_ADMIN_SERVICES`).

### Why `/admin/service-token` is always registered

`/admin/service-token` isn't scoped to either domain — it's the generic machine-to-machine
authentication primitive any caller needs before calling anything gated by a `type: 'api'` token,
whether that's `TriggersAdminClient`, `TemplatesAdminClient`, `ZanixAdmin`'s own aggregator,
`RemoteTemplateBackend`, or a future caller. That's why it stays available even when neither
`/admin/triggers` nor `/admin/templates` is registered. Its presence alone grants nothing: the
endpoint only exchanges a valid service assertion for an API token, and rejects any caller whose
`JWK_PUB_<serviceId>` isn't registered, regardless of what else is enabled.

### Is this architecture intentional?

For `/admin/service-token`, yes — `defineAdminMetadata()`'s own comment documents it as "safe by
default", making the endpoint always available regardless of which admin CRUD APIs exist.

For triggers, the coupling is less explicit: no comment states that `/admin/triggers` must always
mirror the persisted triggers module as a design invariant. But it isn't arbitrary either —
`TriggersAdminService`/`TriggersAdminRepository` are simply the CRUD layer over that persisted
triggers collection itself, not a separate abstraction in front of it, so there's no independent
admin surface to keep around once the collection doesn't exist. Treat it as a consequence of what
the admin API currently is, not an arbitrary implementation detail — but also not a documented
guarantee that can never evolve.

The triggers and templates APIs require a role, via `@zanix/auth`'s `@AuthTokenValidation` (the
service-token exchange endpoint above is deliberately the exception — see why in its own bullet).
Assign a role to whichever account (an ops/admin user, or a service/API token) should be allowed to
manage them:

```typescript
import { ADMIN_ROLE, ADMIN_TEMPLATES_ROLE, ADMIN_TRIGGERS_ROLE } from 'jsr:@zanix/core@[version]'

// ADMIN_ROLE grants both APIs. Use ADMIN_TRIGGERS_ROLE / ADMIN_TEMPLATES_ROLE instead to grant
// just one of the two — permissions are OR'd, so either role is enough on its own.
await authProvider.session.generateTokens(adminUser, { permissions: [ADMIN_ROLE] })
```

Without one of these roles, requests to either of the two gated APIs are rejected before reaching
any handler. Both accept either a human admin's `type: 'user'` token
(`Authorization: Bearer <token>`) or a machine caller's `type: 'api'` one
(`X-Znx-Authorization: Bearer <token>`) on the same route — e.g. `@zanix/notifications`'s
`RemoteTemplateBackend`, or `@zanix/admin`, can authenticate without a human ever being in the loop;
that `type: 'api'` token is exactly what `/admin/service-token` mints. See `@zanix/auth`'s
`AuthTokenValidation({ type })` for how the token type is resolved.

Every response from all three APIs carries an `X-Znx-Admin-Protocol` header
(`ADMIN_PROTOCOL_HEADER`, currently `ADMIN_PROTOCOL_VERSION` = `1`) — a version identifier for the
admin protocol's own request/response shapes, independent of this package's semver. `@zanix/admin`
actually administers this protocol: it validates a caller's own declared version (same header, sent
on the _request_) against what it still understands, rejecting an unrecognized one with a
`400 Bad Request` rather than silently guessing — see `@zanix/admin`'s own "Protocol negotiation"
docs. No caller sends this header today, so nothing changes for an existing consumer: an absent
declared version always defaults to the current one. Both constants, along with the roles above and
the `TemplatesAdminClient`/`TriggersAdminClient` below, are owned by `@zanix/admin` — this package
depends on it and re-exports them from its own `mod.ts` unchanged, so existing imports from
`@zanix/core` keep working exactly as shown above. `ADMIN_PROTOCOL_HEADER` itself is, one level
further down, re-exported from `@zanix/server` (only the header _name_, not the version), so
`@zanix/notifications` can use it without depending on either `@zanix/core` or `@zanix/admin` — see
`@zanix/server`'s `docs/CONFIGURATION.md#auth--admin-protocol-headers`.

By default, the admin API's URL path prefix (a `@zanix/server`-generated `ServerID`) is a random
UUID that changes on every restart — safe by default (nothing to leak, rotates on its own), but
unusable if an external caller (e.g. `@zanix/admin`) needs a stable address to reach this service
at. Set **`ADMIN_SERVER_ID`** to pin it instead:

```env
ADMIN_SERVER_ID=custom-billing
```

Each admin sub-server (REST/GraphQL/socket) gets its own suffixed id so the three never collide,
even if two are ever configured onto the same port. Leave it unset unless something external
actually needs to reach this service's admin API at a fixed address.

## Calling another service's admin API (`TriggersAdminClient`/`TemplatesAdminClient`)

A consumer that needs to call a business service's `/admin/triggers`/`/admin/templates` remotely
(e.g. `@zanix/admin`'s own `TriggersAggregator`) doesn't need to hand-roll an HTTP client —
`@zanix/admin` owns the same request/response contract's client-side counterpart (re-exported here
for convenience), so there's exactly one implementation of it instead of a server-side one here and
a second, hand-rolled one drifting apart in whoever calls it:

```typescript
import { TriggersAdminClient } from 'jsr:@zanix/core@[version]'

const client = new TriggersAdminClient({
  baseUrl: 'http://billing.internal:30248/billing-rest', // that service's own ADMIN_SERVER_ID prefix
  headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` }, // e.g. from @zanix/auth's exchangeServiceCredential
})

const triggers = await client.list()
```

`TemplatesAdminClient` mirrors the same shape for `/admin/templates`. Both never send `updatedBy` —
the target service infers it from the caller's own authenticated session, exactly like the local API
already does.

## Standing up the centralized orchestrator alongside this service (`ZanixAdmin`)

`@zanix/admin`'s own reference deployable entrypoint is re-exported from this package too, so a team
that wants both roles — this service's own business API, plus the centralized admin hub aggregating
`/admin/triggers`/`/admin/templates` across a fleet — can do so from `@zanix/core` alone, with no
separate import:

```typescript
import Zanix, { ZanixAdmin } from 'jsr:@zanix/core@[version]'

await Zanix.start() // this service's own business API
await ZanixAdmin.start({ port: 3001 }) // the centralized admin hub, in the same process
```

`Zanix.start()` and `ZanixAdmin.start()` each resolve their own public REST server's port from the
same env-var fallback chain — calling both in the same process without passing a distinct `port` to
at least one of them fails with `AddrInUse`. See `@zanix/admin`'s own README for
`ZanixAdmin.start`'s full options.

## Building a custom admin API instead of the built-in one

If the built-in `/admin/triggers`/`/admin/templates` routes don't fit (different auth, a different
path, extra business logic around the CRUD), `@zanix/core` also re-exports the lower-level pieces
`@zanix/admin` builds them from, so a custom controller can reuse the same CRUD logic instead of
duplicating it:

| Symbol                                                            | What it is                                                                                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTriggersAdminController`                                   | The factory that builds the built-in `/admin/triggers` controller itself — call it directly with your own `options` to mount an equivalent route under a different path/auth. |
| `TriggersAdminService` / `TriggersAdminRepository`                | The triggers CRUD business/persistence logic, without the HTTP layer.                                                                                                         |
| `TemplatesAdminService` / `TemplatesAdminRepository`              | The templates CRUD business/persistence logic, without the HTTP layer.                                                                                                        |
| `CreateTriggerRTO` / `UpdateTriggerRTO` / `TriggerModelParamsRTO` | Request/response shapes for the triggers CRUD.                                                                                                                                |
| `CreateTemplateRTO` / `UpdateTemplateRTO` / `TemplateParamsRTO`   | Request/response shapes for the templates CRUD.                                                                                                                               |
| `ServiceExchangeRTO`                                              | Response shape for `/admin/service-token`.                                                                                                                                    |
| `ADMIN_PROTOCOL_SUPPORTED_VERSIONS`                               | The full list of `X-Znx-Admin-Protocol` versions `@zanix/admin` still accepts, for a custom controller that wants to negotiate the same way.                                  |

## See also

- [`../README.md`](../README.md) — package overview, installation, and basic usage.
- `@zanix/admin`'s own README — the domain owner for the roles, protocol, and client/service classes
  re-exported here.
- `@zanix/auth`'s `docs/service-credential.md` — the service-credential exchange contract behind
  `/admin/service-token`.
- `@zanix/notifications`'s `docs/templates.md` — the per-service vs. shared-storage decision behind
  `/admin/templates`.
