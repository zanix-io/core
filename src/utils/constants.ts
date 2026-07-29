/**
 * Env var overriding whether `/admin/triggers` is mounted `isInternal: true` (default) or
 * `false` — set to `'false'` only if your deployment platform genuinely can't isolate an internal
 * server (see this package's `docs/admin-apis.md`). See `createTriggersAdminController`.
 */
export const ADMIN_TRIGGERS_ISINTERNAL_ENV = 'ADMIN_TRIGGERS_ISINTERNAL'

/**
 * Env var overriding whether `/admin/templates` is mounted `isInternal: true` (default) or
 * `false` — same caveat as {@link ADMIN_TRIGGERS_ISINTERNAL_ENV}. See
 * `createTemplatesController`.
 */
export const ADMIN_TEMPLATES_ISINTERNAL_ENV = 'ADMIN_TEMPLATES_ISINTERNAL'
