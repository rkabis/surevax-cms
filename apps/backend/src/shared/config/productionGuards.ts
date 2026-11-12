export type ProductionSafetyConfig = {
  DATABASE_URL: string
  DATABASE_MIGRATOR_URL?: string
  COOKIE_SECRET: string
  JWT_SECRET: string
  JWT_ACCESS_SECRET: string
  JWT_REFRESH_SECRET: string
  CORS_ORIGIN: string
  EXPOSE_ERRORS: boolean
  WORKERS_ENABLED: 'true' | 'false'
  SENTRY_DSN?: string
  PAYMONGO_WEBHOOK_SECRET?: string
  R2_ENDPOINT?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
}

export type RuntimeRoleCapabilities = {
  isSuperuser: boolean
  bypassesRls: boolean
  canCreateDb: boolean
  canCreateRole: boolean
  canReplicate: boolean
}

/** Normalize only explicit boolean spellings; leave invalid values for Zod to reject. */
export function parseEnvBoolean(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  return value
}

export function runtimeRoleIsPrivileged(role: RuntimeRoleCapabilities): boolean {
  return (
    role.isSuperuser ||
    role.bypassesRls ||
    role.canCreateDb ||
    role.canCreateRole ||
    role.canReplicate
  )
}

const DEV_SECRET_MARKERS = ['dev_', 'change_in_production', 'changeme', 'example']

/** Pure production-admission checks so the negative matrix is unit-testable. */
export function productionSafetyErrors(config: ProductionSafetyConfig): string[] {
  const errors: string[] = []
  const looksDev = (value: string) =>
    DEV_SECRET_MARKERS.some((marker) => value.toLowerCase().includes(marker)) || value.length < 32

  for (const [name, value] of [
    ['COOKIE_SECRET', config.COOKIE_SECRET],
    ['JWT_SECRET', config.JWT_SECRET],
    ['JWT_ACCESS_SECRET', config.JWT_ACCESS_SECRET],
    ['JWT_REFRESH_SECRET', config.JWT_REFRESH_SECRET],
  ] as const) {
    if (looksDev(value)) errors.push(`${name} looks like a dev default or is too short (<32 chars)`)
  }

  const origins = config.CORS_ORIGIN.split(',').map((origin) => origin.trim())
  if (origins.some((origin) => origin === '*')) {
    errors.push('CORS_ORIGIN cannot include "*" in production')
  }
  for (const origin of origins) {
    try {
      const parsed = new URL(origin)
      if (parsed.protocol !== 'https:') errors.push(`CORS_ORIGIN must use HTTPS: ${origin}`)
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        errors.push(`CORS_ORIGIN is not allowed in production: ${origin}`)
      }
      if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
        errors.push(`CORS_ORIGIN must be an origin without path/query/fragment: ${origin}`)
      }
    } catch {
      errors.push(`CORS_ORIGIN is not a valid URL origin: ${origin}`)
    }
  }

  if (!config.DATABASE_MIGRATOR_URL) {
    errors.push('DATABASE_MIGRATOR_URL is required in production')
  } else if (config.DATABASE_MIGRATOR_URL === config.DATABASE_URL) {
    errors.push('DATABASE_URL and DATABASE_MIGRATOR_URL must use separate roles')
  }
  if (config.WORKERS_ENABLED !== 'true') {
    errors.push('WORKERS_ENABLED=true is required in production')
  }
  if (!config.SENTRY_DSN) errors.push('SENTRY_DSN is required for production security alerts')
  if (!config.PAYMONGO_WEBHOOK_SECRET || looksDev(config.PAYMONGO_WEBHOOK_SECRET)) {
    errors.push('PAYMONGO_WEBHOOK_SECRET is required and must be production-strength')
  }

  const r2Values = [
    config.R2_ENDPOINT,
    config.R2_ACCESS_KEY_ID,
    config.R2_SECRET_ACCESS_KEY,
    config.R2_BUCKET,
  ]
  if (r2Values.some(Boolean) && !r2Values.every(Boolean)) {
    errors.push('R2 configuration must be all-or-none')
  }
  if (!r2Values.every(Boolean)) {
    errors.push('Complete R2 configuration is required before production PHI')
  }
  if (config.EXPOSE_ERRORS) errors.push('EXPOSE_ERRORS=true is not allowed in production')
  return errors
}
