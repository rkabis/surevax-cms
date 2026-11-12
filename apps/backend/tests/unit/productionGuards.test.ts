import { describe, expect, it } from 'vitest'
import {
  parseEnvBoolean,
  productionSafetyErrors,
  runtimeRoleIsPrivileged,
  type ProductionSafetyConfig,
} from '../../src/shared/config/productionGuards.js'

describe('strict environment booleans', () => {
  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
    [' FALSE ', false],
  ])('parses %j as %j', (input, expected) => {
    expect(parseEnvBoolean(input)).toBe(expected)
  })

  it('does not coerce arbitrary non-empty strings to true', () => {
    expect(parseEnvBoolean('enabled')).toBe('enabled')
  })
})

const SAFE: ProductionSafetyConfig = {
  DATABASE_URL: 'postgresql://runtime:secret@db.example.com/app',
  DATABASE_MIGRATOR_URL: 'postgresql://migrator:secret@db.example.com/app',
  COOKIE_SECRET: 'c'.repeat(48),
  JWT_SECRET: 'j'.repeat(48),
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'r'.repeat(48),
  CORS_ORIGIN: 'https://app.example.com',
  EXPOSE_ERRORS: false,
  WORKERS_ENABLED: 'true',
  SENTRY_DSN: 'https://public@sentry.example.com/1',
  PAYMONGO_WEBHOOK_SECRET: 'p'.repeat(48),
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'surevax-production',
}

describe('production safety admission', () => {
  it('accepts a complete separated configuration', () => {
    expect(productionSafetyErrors(SAFE)).toEqual([])
  })

  it('fails closed for HTTP CORS, shared DB roles, disabled workers, and absent alerting', () => {
    const errors = productionSafetyErrors({
      ...SAFE,
      CORS_ORIGIN: 'http://app.example.com',
      DATABASE_MIGRATOR_URL: SAFE.DATABASE_URL,
      WORKERS_ENABLED: 'false',
      SENTRY_DSN: undefined,
    })
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('CORS_ORIGIN must use HTTPS'),
        expect.stringContaining('must use separate roles'),
        expect.stringContaining('WORKERS_ENABLED=true'),
        expect.stringContaining('SENTRY_DSN'),
      ]),
    )
  })

  it('rejects partial R2 configuration and exposed errors', () => {
    const errors = productionSafetyErrors({
      ...SAFE,
      R2_SECRET_ACCESS_KEY: undefined,
      EXPOSE_ERRORS: true,
    })
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('R2 configuration must be all-or-none'),
        expect.stringContaining('Complete R2 configuration'),
        expect.stringContaining('EXPOSE_ERRORS=true'),
      ]),
    )
  })
})

describe('runtime database role admission', () => {
  const SAFE_ROLE = {
    isSuperuser: false,
    bypassesRls: false,
    canCreateDb: false,
    canCreateRole: false,
    canReplicate: false,
  }

  it('accepts a role with no cluster-level privileges', () => {
    expect(runtimeRoleIsPrivileged(SAFE_ROLE)).toBe(false)
  })

  it.each(['isSuperuser', 'bypassesRls', 'canCreateDb', 'canCreateRole', 'canReplicate'] as const)(
    'rejects %s',
    (capability) => {
      expect(runtimeRoleIsPrivileged({ ...SAFE_ROLE, [capability]: true })).toBe(true)
    },
  )
})
