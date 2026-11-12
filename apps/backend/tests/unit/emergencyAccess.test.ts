import { describe, expect, it } from 'vitest'
import {
  assertEmergencyGrantUsable,
  EmergencyAccessError,
  hashEmergencyToken,
} from '../../src/tools/emergencyAccess.js'

const NOW = new Date('2026-08-22T12:00:00.000Z')

describe('emergency account-recovery lease', () => {
  it('accepts an unused, unrevoked, unexpired single-purpose lease', () => {
    expect(() =>
      assertEmergencyGrantUsable(
        {
          purpose: 'restore_tenant_admin_login',
          expiresAt: new Date(NOW.getTime() + 60_000),
          usedAt: null,
          revokedAt: null,
        },
        NOW,
      ),
    ).not.toThrow()
  })

  it('rejects replay after the lease was consumed', () => {
    expect(() =>
      assertEmergencyGrantUsable(
        {
          purpose: 'restore_tenant_admin_login',
          expiresAt: new Date(NOW.getTime() + 60_000),
          usedAt: new Date(NOW.getTime() - 1),
          revokedAt: null,
        },
        NOW,
      ),
    ).toThrowError(expect.objectContaining<EmergencyAccessError>({ code: 'GRANT_REPLAYED' }))
  })

  it('rejects an expired lease', () => {
    expect(() =>
      assertEmergencyGrantUsable(
        {
          purpose: 'restore_tenant_admin_login',
          expiresAt: NOW,
          usedAt: null,
          revokedAt: null,
        },
        NOW,
      ),
    ).toThrowError(expect.objectContaining<EmergencyAccessError>({ code: 'GRANT_EXPIRED' }))
  })

  it('rejects revocation and wrong-purpose broadening', () => {
    expect(() =>
      assertEmergencyGrantUsable(
        {
          purpose: 'restore_tenant_admin_login',
          expiresAt: new Date(NOW.getTime() + 60_000),
          usedAt: null,
          revokedAt: NOW,
        },
        NOW,
      ),
    ).toThrowError(expect.objectContaining<EmergencyAccessError>({ code: 'GRANT_REVOKED' }))
    expect(() =>
      assertEmergencyGrantUsable(
        {
          purpose: 'tenant_admin',
          expiresAt: new Date(NOW.getTime() + 60_000),
          usedAt: null,
          revokedAt: null,
        },
        NOW,
      ),
    ).toThrowError(expect.objectContaining<EmergencyAccessError>({ code: 'WRONG_PURPOSE' }))
  })

  it('hashes activation tokens without retaining plaintext', () => {
    const token = 'A'.repeat(32)
    expect(hashEmergencyToken(token)).toMatch(/^[a-f0-9]{64}$/)
    expect(hashEmergencyToken(token)).not.toContain(token)
  })
})
