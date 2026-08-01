# Admin APIs

`Zanix.start({ admin: true })` bootstraps a separate, **`'admin'`-Application** server (never
reachable through the public `server` options) that exposes three built-in APIs. It's **anchored**
(its own id doubles as an obscuring URL prefix) whenever `ADMIN_SERVER_ID` is set — see
["Pinning a stable address"](#pinning-a-stable-address-admin_server_id) below — and a plain,
unprefixed server otherwise; there is no auto-generated anchored id.

- **`/admin/triggers`** — manage `@zanix/datamaster`'s persisted trigger configurations at runtime,
  without a redeploy. Always registered (the underlying `datamaster` module is on by default; set
  `TRIGGERS_MODEL_NAME=false` to disable both). Its underlying service/repository
  (`TriggersAdminService`/`TriggersAdminRepository`) is owned by `@zanix/datamaster` (the actual
  data owner) — `@zanix/admin` only composes it into this HTTP surface, and this package re-exports
  the same classes from its own `mod.ts` unchanged, so a consuming app can reuse them to build its
  own custom triggers API instead of duplicating the CRUD logic. Composed under the `'admin'`
  Application by default — `ADMIN_TRIGGERS_APPLICATION` overrides which Application it's composed
  under instead (see
  ["Rebinding a capability to a different Application"](#rebinding-a-capability-to-a-different-application-admin_triggers_application-admin_templates_application)
  below).
- **`/admin/templates`** — manage `@zanix/notifications`'s Handlebars templates. Only registered
  once the app has opted into DB-backed templates (`DATABASE_TEMPLATES=true` or
  `TEMPLATES_MODEL_NAME` set) — see `@zanix/notifications`'s `docs/templates.md` for the per-service
  vs. shared-storage decision this depends on. Its underlying service/repository
  (`TemplatesAdminService`/`TemplatesAdminRepository`) is owned by `@zanix/notifications` the same
  way triggers' is owned by `@zanix/datamaster` — `@zanix/admin` only composes it, and re-exports
  the same classes here unchanged. Composed under the `'admin'` Application by default —
  `ADMIN_TEMPLATES_APPLICATION` overrides it the same way as triggers, above.
- **`/admin/service-token`** — machine-to-machine credential exchange, per `@zanix/auth`'s
  `docs/service-credential.md`. Always registered, unauthenticated (there's no session to gate yet —
  the caller is here to obtain one). A thin wrapper around `@zanix/auth`'s
  `exchangeServiceCredential`: POST `{ assertion }` (a JWT signed with the calling service's own key
  via `createServiceAssertion`), get back a real `type: 'api'` access token to use against this
  service's other admin/business APIs. Also built by `@zanix/admin`
  (`createServiceExchangeController`). See below for the two triggers/templates APIs; this one has
  no client wrapper of its own since it's a single POST — call it directly.

Alongside `/admin/templates` and `/admin/triggers`, read-only **`/.well-known/zanix/templates`** and
**`/.well-known/zanix/triggers`** endpoints are also registered on the same admin server —
`@zanix/server`'s Discovery mechanism (see its own `docs/HANDLERS.md#discovery`), for a central sync
job or aggregator to snapshot this service's current resources without going through the
authenticated CRUD surface. Each is gated by the same role pair as its CRUD counterpart
(`ADMIN_ROLE`/`ADMIN_TEMPLATES_ROLE`, `ADMIN_ROLE`/`ADMIN_TRIGGERS_ROLE`), and each provider is
authored by the same data owner as its CRUD layer above (`@zanix/notifications`,
`@zanix/datamaster`) — `@zanix/admin` only registers them.

## The `admin` option

`SetupOptions.admin` (`false`/`undefined` by default) controls all of this in one place:

```typescript
await Zanix.start() // admin: no admin server at all (default)
await Zanix.start({ admin: true }) // enabled, default per-type config (see below)
await Zanix.start({ admin: { rest: { port: 4000 } } }) // enabled, explicit REST port
```

Passing an object uses the exact same shape as the top-level `server` option — anything
`bootstrapServers` accepts per type (`rest`/`graphql`/`socket`) works here too, **except
`application`**: an admin sub-server is always bound to the `'admin'` Application (see
`@zanix/server`'s `docs/HANDLERS.md#applications`), so passing it is a type error rather than a
silently overridden value. `id`/`previousId` are accepted, but this bootstrap always resolves them
itself from `ADMIN_SERVER_ID`/`ADMIN_SERVER_ID_PREVIOUS` regardless of what's passed here — see
["Pinning a stable address"](#pinning-a-stable-address-admin_server_id) below.

### Ports and single-port platforms (Heroku, Render, Railway, …)

Each admin sub-server defaults to **the same port `server`'s own config resolves to for that type**
— i.e. sharing one real listener with the main server by default, dispatched by URL path. When
`ADMIN_SERVER_ID` is set, the admin routes live under their own id-derived prefix; when it isn't,
this bootstrap gives the admin server its own distinct default `globalPrefix`
(`` `admin-${type}` ``) instead of the generic per-type default the main server uses, so the two
still never collide on a shared port even without opting into anchoring.

Two ways to get a genuinely _separate_ port for a type instead:

- **`PORT_<TYPE>`** (e.g. `PORT_REST`) or plain **`PORT`** — an env var, if set, wins over
  everything for that type, applied uniformly to _both_ the main and admin server (they're both
  still `type: 'rest'`; see `@zanix/server`'s `WebServerManager.getEnvPort`). This is what makes the
  shared-by-default behavior automatic on a single-port platform with zero code changes — but it
  also means setting `PORT_REST` couples the main and admin REST ports together; use an explicit
  `admin.rest.port` below instead if you need them to differ while both are still configured via env
  vars.
- **`admin.<type>.port`** — an explicit value in code always wins over the "reuse `server`'s port"
  default (though `PORT`/`PORT_<TYPE>` still wins over _this_ too, per the point above).

No separate `ADMIN_PORT`-style env var exists (and none is planned) — it would be a second,
competing axis against `PORT`/`PORT_<TYPE>` with no clear precedence story. Use the two levers above
instead.

### Customizing the admin route prefix (`admin.<type>.globalPrefix`)

When `ADMIN_SERVER_ID` is set, each admin sub-server's own path is anchored by its derived id — that
part is never configurable, by design (see
["Pinning a stable address"](#pinning-a-stable-address-admin_server_id) below). A `globalPrefix`
passed alongside it is additive, not a replacement: it's inserted as an extra segment right after
that id, in front of the fixed `admin/triggers`/`admin/templates` route paths:

```typescript
Deno.env.set('ADMIN_SERVER_ID', 'billing')
await Zanix.start({ admin: { rest: { globalPrefix: 'ops' } } })
// /admin/triggers becomes reachable at /billing-rest/ops/admin/triggers instead of
// /billing-rest/admin/triggers. Omit `globalPrefix` to keep the bare path unchanged.
```

Without `ADMIN_SERVER_ID` set, the admin server is unprefixed and `globalPrefix` behaves the same
way it would for any other unanchored server — see
["Ports and single-port platforms"](#ports-and-single-port-platforms-heroku-render-railway-) above
for the distinct default prefix this bootstrap gives it in that case, to stay safe sharing a port
with the main server.

### Rebinding a capability to a different Application (`ADMIN_TRIGGERS_APPLICATION`, `ADMIN_TEMPLATES_APPLICATION`)

Both `/admin/triggers` and `/admin/templates` are, by default, composed under the `'admin'`
Application — the same server the rest of this page describes. Two env vars let you rebind either
one, independently, onto a **different** Application's Runtime instead:

```env
ADMIN_TRIGGERS_APPLICATION=main
ADMIN_TEMPLATES_APPLICATION=main
```

Setting either to `'main'` moves that one capability onto the default Application's own server — the
same `bootstrapServers(options.server)` call your own app's routes are served from — reachable at
its normal `globalPrefix` (`/api/...` by default) instead of under the admin server's own prefix.
Leaving both unset (the default) keeps both capabilities on the `'admin'` Application, exactly as
described above.

This is a **Runtime-binding override, not an authentication/authorization one** — rebinding
`/admin/triggers` onto `'main'` only changes _where_ it's served from; `AuthTokenValidation` and the
`ADMIN_ROLE`/`ADMIN_TRIGGERS_ROLE`/`ADMIN_TEMPLATES_ROLE` gate described further down remain the
actual access-control boundary either way. Use this only if your deployment platform genuinely can't
isolate the admin server on its own address — pinning `ADMIN_SERVER_ID` on the `'admin'` Application
(the default) is the safer, recommended choice otherwise: an unguessable, operator-chosen URL prefix
as defense-in-depth underneath the real auth gate.

Each env var accepts any Application name, not just `'main'` — e.g.
`ADMIN_TRIGGERS_APPLICATION=billing` composes it under a `'billing'` Application instead, which
would then need its own `bootstrapServers({..., application: 'billing'})` call somewhere in your own
app to actually serve it (`admin: true`'s own bootstrap only ever activates the `'admin'`
Application's Runtime).

### Scope: `admin` vs. a service's own Application routes

`admin` only toggles `@zanix/admin`'s own triggers/templates/service-token routes, all registered
under `@zanix/server`'s `'admin'` Application (see its `docs/HANDLERS.md#applications`). Application
itself is a generic `@zanix/server` mechanism — nothing stops your _own_ code from composing routes
into that same `'admin'` Application (via `ProgramModule.defineApplication('admin', ...)`) for your
own purposes; those share the same bucket described below. If you want a separate, non-default
Application server for your _own_ routes without `@zanix/admin`'s, register them under a different
Application name and call `bootstrapServers({ ..., application: 'your-name' })` directly rather than
going through `admin`.

**Caveat: `'admin'` is not exclusively reserved for this package.** `@zanix/server` keeps exactly
one route bucket per Application name per server type (`rest`/`graphql`/`socket`) — every capability
composed under `'admin'`, regardless of which package composed it, shares that same bucket.
`@zanix/admin`'s own triggers/templates/service-token routes and any of your own service's routes
you deliberately compose under `'admin'` share it too. If your own app also composes routes under
`'admin'` in the same process as `admin: true`, both sets of routes get mounted together by
whichever `bootstrapServers({..., application: 'admin'})` call serves that Application — and
potentially served twice, once under each call's own id/prefix, if you also bootstrap it a second
time yourself. See `@zanix/server`'s `docs/HANDLERS.md` "Applications" section for the underlying
mechanism.

See [`./admin-architecture.md`](./admin-architecture.md) for how this service's own admin API
relates to the centralized `ZanixAdmin` orchestrator — two independent HTTP servers, not two "modes"
of the same one — including the triggers-proxy-vs-templates-storage distinction, running both in one
process, and standing up `ZanixAdmin` alongside this service.

### Roles and authentication

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

### Protocol version header

Every response from all three APIs carries an `X-Znx-Admin-Protocol` header
(`ADMIN_PROTOCOL_HEADER`, currently `ADMIN_PROTOCOL_VERSION` = `1`) — a version identifier for the
admin protocol's own request/response shapes, independent of this package's semver. `@zanix/admin`
actually administers this protocol: it validates a caller's own declared version (same header, sent
on the _request_) against what it still understands, rejecting an unrecognized one with a
`400 Bad Request` rather than silently guessing — see `@zanix/admin`'s own "Protocol negotiation"
docs. No caller sends this header today, so nothing changes for an existing consumer: an absent
declared version always defaults to the current one. Both constants, along with the roles above and
the `TemplatesAdminClient`/`TriggersAdminClient` (see
[`./admin-architecture.md`](./admin-architecture.md)), are owned by `@zanix/admin` — this package
depends on it and re-exports them from its own `mod.ts` unchanged, so existing imports from
`@zanix/core` keep working exactly as shown above. `ADMIN_PROTOCOL_HEADER` itself is, one level
further down, re-exported from `@zanix/server` (only the header _name_, not the version), so
`@zanix/notifications` can use it without depending on either `@zanix/core` or `@zanix/admin` — see
`@zanix/server`'s `docs/CONFIGURATION.md#auth--admin-protocol-headers`.

### Pinning a stable address (`ADMIN_SERVER_ID`)

By default (no `ADMIN_SERVER_ID`), the admin server is a plain, unprefixed server — there is no
auto-generated/random anchored id. Set **`ADMIN_SERVER_ID`** to get a URL-prefixed (obscured) admin
API instead, giving an external caller (e.g. `@zanix/admin`) a stable address to reach this service
at:

```env
ADMIN_SERVER_ID=custom-billing
```

Each admin sub-server (REST/GraphQL/socket) gets its own suffixed id so the three never collide,
even if two are ever configured onto the same port. Leave it unset unless something external
actually needs to reach this service's admin API at a fixed address. `ZanixAdmin.start()` reads the
same env var, the same way — both go through the same `resolveAdminServerId` helper in
`@zanix/server`, so this is consistent regardless of which entrypoint you use.

**There is no discovery mechanism for the id, by design, and none is planned.** Since reachability
is always opt-in via pinning, never bootstrapped at runtime, no legitimate caller — internal or
external — is ever meant to reach an unpinned admin server by path; the only job an unset
`ADMIN_SERVER_ID` serves is raising the cost for a network-adjacent attacker without valid
credentials, not waiting for some future caller to learn it. A caller that genuinely needs
reachability gets it by knowing the pinned `ADMIN_SERVER_ID` value directly (the same out-of-band
channel used to share any other credential/config), and, for `@zanix/admin`'s own
`TriggersAggregator`/templates sync, by that value being baked into the corresponding
`ServiceRegistry` entry's `adminBaseUrl` — see `@zanix/admin`'s `docs/service-registry.md`.

**Rotating a pinned id safely — `ADMIN_SERVER_ID_PREVIOUS`.** Changing `ADMIN_SERVER_ID` outright
would otherwise need a perfectly synchronized cutover across every caller's own config, updated at
the exact moment this service redeploys. Set `ADMIN_SERVER_ID_PREVIOUS` to the old value alongside
the new `ADMIN_SERVER_ID` in one redeploy instead:

```env
ADMIN_SERVER_ID=billing-v2
ADMIN_SERVER_ID_PREVIOUS=billing-v1
```

Both prefixes reach the same routes simultaneously for as long as `ADMIN_SERVER_ID_PREVIOUS` stays
set — update callers' own config at your own pace, then drop the env var in a later redeploy to
close the window. Not supported for the admin GraphQL sub-server specifically (rebuilding its schema
for a second prefix would compile an empty stub instead of the real one) — the REST/socket admin
sub-servers rotate independently of that limitation.

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

- [`./admin-architecture.md`](./admin-architecture.md) — how this service's own admin API relates to
  the centralized `ZanixAdmin` orchestrator, calling another service's admin API remotely
  (`TriggersAdminClient`/`TemplatesAdminClient`), and standing up `ZanixAdmin` alongside this
  service.
- [`../README.md`](../README.md) — package overview, installation, and basic usage.
- `@zanix/admin`'s own README — the domain owner for the roles, protocol, and client/service classes
  re-exported here.
- `@zanix/auth`'s `docs/service-credential.md` — the service-credential exchange contract behind
  `/admin/service-token`.
- `@zanix/notifications`'s `docs/templates.md` — the per-service vs. shared-storage decision behind
  `/admin/templates`.
