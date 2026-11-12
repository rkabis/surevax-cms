import { describe, expect, it } from 'vitest'
import { assertDevelopmentWriteAuthorized } from '../../../src/modules/data_migration/writeAuthorization.js'

const authorization = {
  targetClass: 'disposable_development' as const,
  databaseFingerprint: 'postgres://localhost/surevax_migration_test',
  approvedBy: 'app-owner',
  approvedAt: '2026-08-16T10:00:00+08:00',
}

describe('migration write authorization', () => {
  it('always permits dry-run without a write authorization', () => {
    expect(() => assertDevelopmentWriteAuthorized(true, undefined, 'production')).not.toThrow()
  })

  it('permits an explicitly authorized development target', () => {
    expect(() =>
      assertDevelopmentWriteAuthorized(false, authorization, 'development'),
    ).not.toThrow()
  })

  it('rejects writes with no explicit target authorization', () => {
    expect(() => assertDevelopmentWriteAuthorized(false, undefined, 'development')).toThrow()
  })

  it('rejects production even when a development authorization is supplied', () => {
    expect(() => assertDevelopmentWriteAuthorized(false, authorization, 'production')).toThrow(
      /production migration writes are not authorized/,
    )
  })

  it('rejects unknown fields and unsupported target classes', () => {
    expect(() =>
      assertDevelopmentWriteAuthorized(
        false,
        { ...authorization, targetClass: 'production', bypass: true },
        'development',
      ),
    ).toThrow()
  })
})
