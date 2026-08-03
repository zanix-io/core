// deno-coverage-ignore-file

/**
 * Compile-only fixture: `SetupOptions.admin.<type>.application` must be a type error — an
 * admin sub-server is always bound to the `'admin'` Application (see `modules/start.ts`'s admin
 * bootstrap block), so it can't be silently overridden, it must not compile at all. If the
 * `@ts-expect-error` becomes *unused* (TS no longer errors there), that unused-directive error is
 * itself a compile failure `deno test`'s default type-checking catches — so a regression back to
 * silently accepting the field fails the suite either way.
 *
 * There is no `anchored` counterpart anymore: that option was removed from `@zanix/server` entirely
 * (a server is anchored iff an explicit `id` is given — see `BootstrapServerOptions[K].id`'s own
 * doc), so `anchored` is now a type error on every `BootstrapServerOptions[K]`, not something
 * specific to the admin sub-server this fixture exists to guard.
 */
import type { AdminBootstrapServerOptions } from 'typings/setup.ts'

export const adminApplicationIsATypeError: AdminBootstrapServerOptions = {
  rest: {
    // @ts-expect-error application isn't accepted here — the admin REST server is always bound to 'admin'.
    application: 'main',
  },
}
