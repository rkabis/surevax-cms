/**
 * Base URL for backend API calls.
 *
 * - Dev: unset → '' → requests are relative (`/api/...`) and hit Vite's
 *   proxy (see vite.config.ts) which forwards to `http://localhost:3000`.
 * - Prod: set `VITE_API_URL=https://api.example.com` at build time so
 *   requests target the Railway backend directly (Cloudflare Pages does
 *   not proxy /api).
 *
 * Trailing slashes are stripped so callers can always write `${API_BASE_URL}/api/...`.
 */
export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')

/**
 * Tenant slug sent on every API request via the `X-Tenant-Slug` header.
 *
 * The backend's tenant-resolution middleware (post-#219) requires either a
 * JWT-borne tenant claim, an X-Tenant-Slug header, or the request hostname's
 * first label to match a row in `tenants.slug`. Cloudflare Pages → Railway
 * deploys never hit the subdomain path, so the header is mandatory for the
 * pre-auth requests (login, refresh).
 *
 * Phase 2 is still single-tenant; defaults to `SVX` (the value seeded by
 * `seed.ts` — `tenants.id` and `tenants.slug` carry the same value).
 * Multi-tenant deploys override per build via `VITE_TENANT_SLUG` — once
 * subdomain routing lands the constant can be derived from
 * `window.location.hostname` instead.
 */
export const TENANT_SLUG = import.meta.env.VITE_TENANT_SLUG ?? 'SVX'

/**
 * Standard headers sent on every API request:
 *   - `X-Requested-With: fetch` — CSRF defense (backend rejects state-changing
 *     requests without it).
 *   - `X-Tenant-Slug` — tenant resolution.
 *
 * Spread into every `fetch` call's `headers` field.
 */
export const STANDARD_API_HEADERS = {
  'X-Requested-With': 'fetch',
  'X-Tenant-Slug': TENANT_SLUG,
}
