# Architecture: This Service's Admin API vs. the Centralized ZanixAdmin

It's easy to read `Zanix.start()`'s admin server and `ZanixAdmin.start()` (below) as two "modes" of
the same admin API. They aren't — they're **two independent HTTP servers with independent route
sets**. Each business service exposes its own internal admin API; `ZanixAdmin` is a separate
application that may consume those APIs — it does not become them or replace them.

## High-level architecture

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

## Triggers: a pure proxy

`ZanixAdmin`'s `/triggers` owns no trigger data of its own. `TriggersAggregator` fans a `list()` out
across every service in its `ServiceRegistry` — via `DiscoveryAdminClient`, reading each service's
own `/.well-known/zanix/triggers` snapshot, since a plain enumeration is exactly what Discovery
exists for — and proxies `get`/`create`/`update`/`remove` to whichever service the call names, using
`TriggersAdminClient` to call that service's own `/admin/triggers` CRUD API over HTTP. Today,
there's no separate triggers storage on the `ZanixAdmin` side — that makes this service's own
`/admin/triggers` the infrastructure the centralized aggregator depends on, not a redundant
duplicate of it. A service only participates in trigger aggregation if it exposes its own
`/admin/triggers`; since that route exists whenever the persisted triggers module is enabled (see
[`./admin-apis.md`](./admin-apis.md)), disabling that module also removes the service from what
`ZanixAdmin` can aggregate.

## Templates: a storage decision

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

## Running both servers

Running `await Zanix.start()` (with `admin` left at its default, `false`) and
`await ZanixAdmin.start({ port: 3001 })` (see
[below](#standing-up-the-centralized-orchestrator-alongside-this-service-zanixadmin)) in the same
process starts two completely independent HTTP servers — co-locating them doesn't connect them
automatically. If you want `ZanixAdmin`'s triggers aggregator to include this service, you still
have to register this service's own `ADMIN_SERVER_ID` address in `ZanixAdmin`'s `ServiceRegistry`
(`ZANIX_ADMIN_SERVICES`).

**Never enable `admin` on `Zanix.start()` in the same process as `ZanixAdmin.start()`** — both
independently register `@zanix/admin` metadata (this service's own triggers/templates/service-token
routes on one side, `ZanixAdmin`'s triggers-proxy/templates-store routes on the other — see
["Architecture"](#architecture-this-services-admin-api-vs-the-centralized-zanixadmin) above for why
these aren't the same routes) and call `bootstrapServers()` against the same process-global
registry; doing so used to silently corrupt it (one's cleanup could wipe routes/resolvers the other
registered before they were ever served). A runtime guard now throws immediately instead: whichever
of the two runs second raises an `InternalError` naming both callers. This is exactly why `admin`
defaults to `false` — the common "this service's own business API + a separate `ZanixAdmin` hub"
combination shown above only needs `Zanix.start()`'s _default_, not `admin: true`.

## Why `/admin/service-token` is always registered

`/admin/service-token` isn't scoped to either domain — it's the generic machine-to-machine
authentication primitive any caller needs before calling anything gated by a `type: 'api'` token,
whether that's `TriggersAdminClient`, `TemplatesAdminClient`, `ZanixAdmin`'s own aggregator,
`RemoteTemplateBackend`, or a future caller. That's why it stays available even when neither
`/admin/triggers` nor `/admin/templates` is registered. Its presence alone grants nothing: the
endpoint only exchanges a valid service assertion for an API token, and rejects any caller whose
`JWK_PUB_<serviceId>` isn't registered, regardless of what else is enabled.

## Is this architecture intentional?

For `/admin/service-token`, yes — `defineAdminMetadata()`'s own comment documents it as "safe by
default", making the endpoint always available regardless of which admin CRUD APIs exist.

For triggers, the coupling is less explicit: no comment states that `/admin/triggers` must always
mirror the persisted triggers module as a design invariant. But it isn't arbitrary either —
`TriggersAdminService`/`TriggersAdminRepository` are simply the CRUD layer over that persisted
triggers collection itself, not a separate abstraction in front of it, so there's no independent
admin surface to keep around once the collection doesn't exist. Treat it as a consequence of what
the admin API currently is, not an arbitrary implementation detail — but also not a documented
guarantee that can never evolve.

## Calling another service's admin API (`TriggersAdminClient`/`TemplatesAdminClient`)

A consumer that needs to call a business service's `/admin/triggers`/`/admin/templates` remotely
(e.g. `@zanix/admin`'s own `TriggersAggregator`) doesn't need to hand-roll an HTTP client —
`@zanix/admin` owns the same request/response contract's client-side counterpart (re-exported here
for convenience), so there's exactly one implementation of it instead of a server-side one here and
a second, hand-rolled one drifting apart in whoever calls it:

```typescript
import { TriggersAdminClient } from 'jsr:@zanix/core@[version]'

const client = new TriggersAdminClient({
  baseUrl: 'http://billing.internal:8000/billing-rest', // that service's own port + ADMIN_SERVER_ID prefix
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

await Zanix.start() // this service's own business API — leave `admin` at its default, false
await ZanixAdmin.start({ port: 3001 }) // the centralized admin hub, in the same process
```

`Zanix.start()` and `ZanixAdmin.start()` each resolve their own public REST server's port from the
same env-var fallback chain — calling both in the same process without passing a distinct `port` to
at least one of them fails with `AddrInUse`. See `@zanix/admin`'s own README for
`ZanixAdmin.start`'s full options.

## See also

- [`./admin-apis.md`](./admin-apis.md) — the `admin` option's configuration reference (ports, route
  prefix, Application rebinding), roles, protocol header, and `ADMIN_SERVER_ID`.
- [`../README.md`](../README.md) — package overview, installation, and basic usage.
- `@zanix/admin`'s own README — the domain owner for the roles, protocol, and client/service classes
  re-exported here.
- `@zanix/notifications`'s `docs/templates.md` — the per-service vs. shared-storage decision behind
  `/admin/templates`.
