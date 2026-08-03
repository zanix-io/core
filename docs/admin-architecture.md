# Architecture: This Service's Admin API vs. the Centralized ZanixAdminHub

It's easy to read `Zanix.start()`'s admin server and `ZanixAdminHub.start()` (below) as two "modes"
of the same admin API. They aren't — they're **two independent HTTP servers with independent route
sets**. Each business service exposes its own internal admin API; `ZanixAdminHub` is a separate
application that may consume those APIs — it does not become them or replace them.

## High-level architecture

```text
                         ┌─────────────────────────┐
                         │ ZanixAdminHub              │
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

`ZanixAdminHub`'s `/triggers` owns no trigger data of its own. `TriggersAggregator` fans a `list()`
out across every service in its `ServiceRegistry` — via `DiscoveryAdminClient`, reading each
service's own `/.well-known/zanix/triggers` snapshot, since a plain enumeration is exactly what
Discovery exists for — and proxies `get`/`create`/`update`/`remove` to whichever service the call
names, using `TriggersAdminClient` to call that service's own `/admin/triggers` CRUD API over HTTP.
Today, there's no separate triggers storage on the `ZanixAdminHub` side — that makes this service's
own `/admin/triggers` the infrastructure the centralized aggregator depends on, not a redundant
duplicate of it. A service only participates in trigger aggregation if it exposes its own
`/admin/triggers`; since that route exists whenever the persisted triggers module is enabled (see
[`./admin-apis.md`](./admin-apis.md)), disabling that module also removes the service from what
`ZanixAdminHub` can aggregate.

## Templates: a storage decision

Unlike triggers, `ZanixAdminHub`'s `/templates` owns its own data — its `TemplatesController` uses
its own `TemplatesAdminService` and its own database connector, entirely independent of any business
service's local one. This makes templates a **storage choice**, not an aggregation dependency: a
service typically picks one of two deployment models.

```text
Option A — per-service storage             Option B — centralized storage

Business Service                           Business Service
    │                                           │
    ├── Database                                └── RemoteTemplateBackend
    │                                                      │
    └── /admin/templates                                   ▼
                                                     ZanixAdminHub
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
`await ZanixAdminHub.start({ port: 3001 })` (see
[below](#standing-up-the-centralized-orchestrator-alongside-this-service-zanixadminhub)) in the same
process starts two completely independent HTTP servers — co-locating them doesn't connect them
automatically. If you want `ZanixAdminHub`'s triggers aggregator to include this service, you still
have to register this service's own `ADMIN_SERVER_ID` address in `ZanixAdminHub`'s `ServiceRegistry`
(`ZANIX_ADMIN_SERVICES`).

**Enabling `admin` on `Zanix.start()` in the same process as `ZanixAdminHub.start()` is supported.**
Both independently register `@zanix/admin` metadata (this service's own triggers/templates/
service-token routes on one side, `ZanixAdminHub`'s triggers-proxy/templates-store routes on the
other — see ["Architecture"](#architecture-this-services-admin-api-vs-the-centralized-zanixadminhub)
above for why these aren't the same routes) and each independently calls `bootstrapServers()`
against the same process-global registry — this used to silently corrupt it (one's cleanup could
wipe routes/resolvers the other registered before they were ever served), which is why an earlier
version of this package outright forbade the combination. `@zanix/server` now scopes that cleanup to
each top-level sequence's own "boot session" (see `BootSessionContainer`), so two independent
sequences — even fired without a sequential `await` between them, e.g.
`Zanix.start({ admin: true }); ZanixAdminHub.start()` back to back with no `await` in between — can
never wipe each other's not-yet-served routes. The two route sets also compose under distinct
Applications now (`'admin'` for this service's own embedded API, `'admin-hub'` for `ZanixAdminHub`'s
own aggregator), keeping them logically distinguishable on top of that. You still only need
`admin: true` if you actually want this service to expose its own local admin API alongside hosting
the hub — the common "this service's own business API + a separate `ZanixAdminHub` hub, nothing
local" combination shown above still only needs `Zanix.start()`'s _default_.

## Why `/admin/service-token` is always registered

`/admin/service-token` isn't scoped to either domain — it's the generic machine-to-machine
authentication primitive any caller needs before calling anything gated by a `type: 'api'` token,
whether that's `TriggersAdminClient`, `TemplatesAdminClient`, `ZanixAdminHub`'s own aggregator,
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

## Standing up the centralized orchestrator alongside this service (`ZanixAdminHub`)

`@zanix/admin`'s own reference deployable entrypoint is re-exported from this package too, so a team
that wants both roles — this service's own business API, plus the centralized admin hub aggregating
`/admin/triggers`/`/admin/templates` across a fleet — can do so from `@zanix/core` alone, with no
separate import:

```typescript
import Zanix, { ZanixAdminHub } from 'jsr:@zanix/core@[version]'

// Neither call needs to be awaited before the other starts — each runs under its own isolated boot
// session (see "Running both servers" above), so registering/booting them concurrently is safe.
const core = Zanix.start() // this service's own business API — `admin` here is optional
const hub = ZanixAdminHub.start({ port: 3001 }) // the centralized admin hub, in the same process
await Promise.all([core, hub])
```

`Zanix.start()` and `ZanixAdminHub.start()` each resolve their own public REST server's port from
the same env-var fallback chain — calling both in the same process without passing a distinct `port`
to at least one of them fails with `AddrInUse`. If both also enable their own admin-side server
(`Zanix.start({ admin: true })` and `ZanixAdminHub.start()`'s own server), set distinct
`ADMIN_SERVER_ID`/`ADMIN_HUB_SERVER_ID` values if you want both anchored — see
[`./admin-apis.md`](./admin-apis.md#pinning-a-stable-address-admin_server_id). See `@zanix/admin`'s
own README for `ZanixAdminHub.start`'s full options.

## See also

- [`./admin-apis.md`](./admin-apis.md) — the `admin` option's configuration reference (ports, route
  prefix, Application rebinding), roles, protocol header, and `ADMIN_SERVER_ID`.
- [`../README.md`](../README.md) — package overview, installation, and basic usage.
- `@zanix/admin`'s own README — the domain owner for the roles, protocol, and client/service classes
  re-exported here.
- `@zanix/notifications`'s `docs/templates.md` — the per-service vs. shared-storage decision behind
  `/admin/templates`.
