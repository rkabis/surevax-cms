import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'

// Keep this suite database/config independent. The factory below injects the
// actual behavior under test; these mocks only prevent module-load side effects.
vi.mock('../../src/shared/db/withTenantTx.js', () => ({ withPlatformTx: vi.fn() }))
vi.mock('../../src/shared/utils/logger.js', () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}))

import {
  createAuditChainVerificationService,
  type AuditChainVerificationDependencies,
  type ChainRow,
} from '../../src/workers/verifyAuditChain.js'
import type {
  SecurityAlert,
  SecurityAlertSink,
} from '../../src/shared/observability/securityAlert.js'

function makeLogger() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
  return logger as typeof logger & Pick<Logger, 'info' | 'warn' | 'error'>
}

function makeSink(
  deliver: SecurityAlertSink['deliver'] = vi.fn(async () => ({ eventId: 'event-123' })),
): SecurityAlertSink {
  return { deliver }
}

function makeService(
  overrides: Partial<AuditChainVerificationDependencies> = {},
): ReturnType<typeof createAuditChainVerificationService> {
  return createAuditChainVerificationService({
    verifyRows: vi.fn(async () => []),
    alertSink: makeSink(),
    logger: makeLogger(),
    now: () => new Date('2026-08-22T00:00:00.000Z'),
    ...overrides,
  })
}

describe('audit-chain verification alerts', () => {
  it('does not alert for an intact partition', async () => {
    const deliver = vi.fn(async () => ({ eventId: 'unused' }))
    const service = makeService({ alertSink: makeSink(deliver) })

    await expect(service.verifyPartition('audit_logs_2026_08')).resolves.toEqual({
      partition: 'audit_logs_2026_08',
      status: 'intact',
    })
    expect(deliver).not.toHaveBeenCalled()
  })

  it('emits a sanitized tamper alert and records delivery evidence', async () => {
    const rows: ChainRow[] = [
      { id: '73', ts: '2026-08-22T03:04:05Z', match: false },
      { id: '74', ts: '2026-08-22T03:05:05Z', match: false },
    ]
    const deliver = vi.fn(async (_alert: SecurityAlert) => ({ eventId: 'event-tamper' }))
    const service = makeService({
      verifyRows: vi.fn(async () => rows),
      alertSink: makeSink(deliver),
    })

    await expect(service.verifyPartition('audit_logs_2026_08')).resolves.toEqual({
      partition: 'audit_logs_2026_08',
      status: 'tampered',
      mismatchCount: 2,
      alertDelivered: true,
      alertEventId: 'event-tamper',
    })
    expect(deliver).toHaveBeenCalledWith({
      kind: 'audit_chain_tamper',
      partition: 'audit_logs_2026_08',
      mismatchCount: 2,
      firstMismatchAuditId: '73',
      firstMismatchTimestamp: '2026-08-22T03:04:05.000Z',
    })
  })

  it('keeps a mismatch classified as tamper when alert delivery fails', async () => {
    const logger = makeLogger()
    const deliveryError = new Error('proxy response contained sensitive diagnostics')
    const service = makeService({
      verifyRows: vi.fn(async () => [{ id: '73', ts: '2026-08-22T03:04:05Z', match: false }]),
      alertSink: makeSink(vi.fn(async () => Promise.reject(deliveryError))),
      logger,
    })

    await expect(service.verifyPartition('audit_logs_2026_08')).resolves.toEqual({
      partition: 'audit_logs_2026_08',
      status: 'tampered',
      mismatchCount: 1,
      alertDelivered: false,
    })

    expect(logger.error).toHaveBeenCalledWith(
      { alertKind: 'audit_chain_tamper', partition: 'audit_logs_2026_08' },
      '[verifyAuditChain] security alert delivery failed — next cycle will retry',
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(deliveryError.message)
  })

  it('distinguishes verifier failure from a confirmed chain mismatch', async () => {
    const deliver = vi.fn(async (_alert: SecurityAlert) => ({ eventId: 'event-verifier' }))
    const databaseError = Object.assign(new Error('query text must not be emitted'), {
      name: 'PostgresError',
      code: '42P01',
    })
    const service = makeService({
      verifyRows: vi.fn(async () => Promise.reject(databaseError)),
      alertSink: makeSink(deliver),
    })

    await expect(service.verifyPartition('audit_logs_2026_08')).resolves.toEqual({
      partition: 'audit_logs_2026_08',
      status: 'verification_error',
      alertDelivered: true,
      alertEventId: 'event-verifier',
    })
    expect(deliver).toHaveBeenCalledWith({
      kind: 'audit_chain_verification_error',
      partition: 'audit_logs_2026_08',
      errorName: 'PostgresError',
      errorCode: '42P01',
    })
    expect(deliver).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'audit_chain_tamper' }),
    )
  })

  it('omits unsafe exception names, codes, and messages from alert payloads', async () => {
    const deliver = vi.fn(async (_alert: SecurityAlert) => ({ eventId: 'event-verifier' }))
    const unsafeError = Object.assign(new Error('password=do-not-log'), {
      name: 'Bad Error: patient name',
      code: 'token=do-not-log',
    })
    const service = makeService({
      verifyRows: vi.fn(async () => Promise.reject(unsafeError)),
      alertSink: makeSink(deliver),
    })

    await service.verifyPartition('audit_logs_2026_08')

    expect(deliver).toHaveBeenCalledWith({
      kind: 'audit_chain_verification_error',
      partition: 'audit_logs_2026_08',
      errorName: 'UnknownError',
    })
    expect(JSON.stringify(deliver.mock.calls)).not.toContain('do-not-log')
  })

  it('checks the prior and current UTC partitions in one cycle', async () => {
    const verifyRows = vi.fn(async () => [])
    const service = makeService({ verifyRows })

    await expect(service.runVerifyCycle()).resolves.toEqual([
      { partition: 'audit_logs_2026_07', status: 'intact' },
      { partition: 'audit_logs_2026_08', status: 'intact' },
    ])
    expect(verifyRows.mock.calls).toEqual([['audit_logs_2026_07'], ['audit_logs_2026_08']])
  })
})
