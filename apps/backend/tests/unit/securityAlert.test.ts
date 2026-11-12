import { describe, expect, it, vi } from 'vitest'
import {
  createSentrySecurityAlertSink,
  SecurityAlertDeliveryError,
  type SentrySecurityAlertClient,
} from '../../src/shared/observability/securityAlert.js'

function makeClient(overrides: Partial<SentrySecurityAlertClient> = {}): SentrySecurityAlertClient {
  return {
    isConfigured: vi.fn(() => true),
    captureMessage: vi.fn(() => 'event-123'),
    flush: vi.fn(async () => true),
    ...overrides,
  }
}

describe('Sentry security alert sink', () => {
  it('delivers a PHI-free tamper signal with stable routing metadata', async () => {
    const client = makeClient()
    const sink = createSentrySecurityAlertSink({ client, flushTimeoutMs: 250 })

    await expect(
      sink.deliver({
        kind: 'audit_chain_tamper',
        partition: 'audit_logs_2026_08',
        mismatchCount: 2,
        firstMismatchAuditId: '42',
        firstMismatchTimestamp: '2026-08-22T01:02:03.000Z',
      }),
    ).resolves.toEqual({ eventId: 'event-123' })

    expect(client.captureMessage).toHaveBeenCalledWith('Audit chain tamper detected', {
      level: 'fatal',
      tags: {
        security_alert_kind: 'audit_chain_tamper',
        security_component: 'audit_chain',
        audit_partition: 'audit_logs_2026_08',
      },
      fingerprint: ['surevax-security-alert', 'audit_chain_tamper', 'audit_logs_2026_08'],
      contexts: {
        security_alert: {
          kind: 'audit_chain_tamper',
          partition: 'audit_logs_2026_08',
          mismatch_count: 2,
          first_mismatch_audit_id: '42',
          first_mismatch_timestamp: '2026-08-22T01:02:03.000Z',
        },
      },
    })
    expect(client.flush).toHaveBeenCalledWith(250)
  })

  it('fails delivery when Sentry does not confirm a flush', async () => {
    const sink = createSentrySecurityAlertSink({
      client: makeClient({ flush: vi.fn(async () => false) }),
    })

    const delivery = sink.deliver({
      kind: 'audit_chain_verification_error',
      partition: 'audit_logs_2026_08',
      errorName: 'PostgresError',
      errorCode: '42P01',
    })

    await expect(delivery).rejects.toMatchObject<SecurityAlertDeliveryError>({
      name: 'SecurityAlertDeliveryError',
      code: 'FLUSH_FAILED',
    })
  })

  it('fails closed when Sentry has not been initialized', async () => {
    const sink = createSentrySecurityAlertSink({
      client: makeClient({ isConfigured: vi.fn(() => false) }),
    })

    await expect(
      sink.deliver({
        kind: 'audit_chain_tamper',
        partition: 'audit_logs_2026_08',
        mismatchCount: 1,
      }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' })
  })
})
