/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL for the backend API. Leave unset (or empty) in local dev so that
   * Vite's `/api` proxy (see vite.config.ts) forwards to `http://localhost:3000`.
   * Set to the full backend origin (e.g. `https://api.surevax.example`) for
   * production builds where the frontend is served from a different origin.
   */
  readonly VITE_API_URL?: string
  /**
   * Sentry DSN for frontend error aggregation (M14). When unset, Sentry.init
   * is skipped — local dev works without a Sentry project. Set in production
   * via Cloudflare Pages environment variables.
   */
  readonly VITE_SENTRY_DSN?: string
  /** Optional Sentry environment tag (defaults to `import.meta.env.MODE`). */
  readonly VITE_SENTRY_ENVIRONMENT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
