/**
 * Environment validation — runs at process start.
 *
 * All env access in the backend should go through the exported `env` object
 * rather than reading `process.env` directly. This guarantees:
 *   1. Required vars exist (fail fast at boot, not at first request).
 *   2. Production-only safety rules (no dev secrets, no localhost CORS).
 *   3. A typed, autocompleted surface for callers.
 *
 * Import ordering matters: this module reads `process.env` at import time,
 * so `dotenv/config` MUST be imported before it in the entry file.
 */
import { z } from 'zod'
import { parseEnvBoolean, productionSafetyErrors } from './productionGuards.js'

const envBoolean = z.preprocess(parseEnvBoolean, z.boolean())

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Global per-IP request cap (express-rate-limit). Sized for this app's
  // deployment model: a whole clinic of staff behind ONE NAT IP, each on a
  // polling dashboard, all count against the same bucket. The prior 100/min
  // (~1.6 req/s for the entire clinic) bounced legitimate multi-user bursts —
  // and the shared-IP E2E suite — off the app. Tunable per environment; the
  // per-route credential limiter (login/refresh/verify-pin, 10/min) is separate.
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),

  // Database
  // DATABASE_URL — the RUNTIME app connection. Post AUTH-2 capstone this
  // points at the `surevax_app` role (NOBYPASSRLS) so RLS policies are
  // actually enforced for every read/write.
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  // DATABASE_MIGRATOR_URL — used by migrate.ts and seed/db.ts only. Points
  // at the migrator role (`surevax` locally / Railway's master role in prod)
  // which has BYPASSRLS + DDL privileges. Optional in dev: falls back to
  // DATABASE_URL for backwards compatibility while a worktree is being
  // bootstrapped. Required once `surevax_app` is the runtime role.
  DATABASE_MIGRATOR_URL: z.string().url('DATABASE_MIGRATOR_URL must be a valid URL').optional(),

  // Auth secrets
  COOKIE_SECRET: z.string().min(1, 'COOKIE_SECRET is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),

  // CORS — no safe default, must be set explicitly
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN is required'),

  // Google Places API key for address autocomplete. Optional — the
  // autocomplete endpoint returns 503 when the key is not configured.
  GOOGLE_PLACES_API_KEY: z.string().optional(),

  // When truthy, the global error handler includes the underlying error
  // string in the JSON response under `detail`. Off by default — only
  // enable for short-lived debugging. Coerces "1"/"true" → true.
  // Do not use z.coerce.boolean(): JavaScript Boolean('false') is true, which
  // would accidentally enable error details or fail production admission.
  EXPOSE_ERRORS: envBoolean.default(false),

  // Cloudflare R2 — required for presigned PUT URL generation.
  // When not set, the /upload-url endpoint returns 503 STORAGE_NOT_CONFIGURED.
  R2_ENDPOINT: z.string().url().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  // Sentry error aggregation (M14). When SENTRY_DSN is unset, init is
  // skipped — local dev works without a Sentry project. Set in production
  // via Railway env vars.
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.0),

  WORKERS_ENABLED: z.enum(['true', 'false']).default('false'),

  // PayMongo webhook signing secret (from Developers → Webhooks → Signing secret
  // in the PayMongo dashboard). When set, every inbound webhook is verified via
  // HMAC-SHA256 against the Paymongo-Signature header. When unset, verification
  // is skipped with a WARNING (dev-only acceptable). Production deploys should
  // always set this variable.
  PAYMONGO_WEBHOOK_SECRET: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('\n❌ Invalid environment variables:')
  for (const [key, errors] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`   • ${key}: ${(errors ?? []).join(', ')}`)
  }
  console.error('\nSee .env.example for required variables.\n')
  process.exit(1)
}

export const env = parsed.data

// ─── Production-only fail-closed guards ───────────────────────────────────────
// These run ONLY when NODE_ENV=production. Dev defaults and localhost origins
// are fine for everything else. The goal: make it impossible to deploy to
// production with dev secrets or a dev CORS origin still in place.
if (env.NODE_ENV === 'production') {
  const errors = productionSafetyErrors(env)

  if (errors.length > 0) {
    console.error('\n❌ Production environment checks failed:')
    for (const e of errors) console.error(`   • ${e}`)
    console.error('')
    process.exit(1)
  }
}

export const isProduction = env.NODE_ENV === 'production'
export const isDevelopment = env.NODE_ENV === 'development'
