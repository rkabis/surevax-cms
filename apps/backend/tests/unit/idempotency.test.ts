/**
 * Unit tests for the idempotency middleware factory.
 *
 * These tests exercise the factory-time identifier validation and the
 * request-level logic using a minimal Express stub. No real DB is involved.
 */
import { describe, it, expect, vi, type Mock } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { idempotency } from '../../src/shared/middleware/idempotency.js'

// ---------------------------------------------------------------------------
// Minimal Express stub helpers
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    get: (_name: string) => undefined,
    tenant: { id: 'TEN-SUREVAX', userId: 'U1', branchId: null },
    ...overrides,
  } as unknown as Request
}

function makeRes() {
  const res = {
    _status: 0,
    _body: null as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) {
      res._status = code
      return res
    },
    json(body: unknown) {
      res._body = body
      return res
    },
    setHeader(name: string, value: string) {
      res._headers[name] = value
      return res
    },
  }
  return res
}

// ---------------------------------------------------------------------------
// Factory-time validation
// ---------------------------------------------------------------------------

describe('idempotency factory', () => {
  it('throws on an invalid tableName', () => {
    expect(() => idempotency({ tableName: 'transactions; DROP TABLE users--' })).toThrow(
      /invalid tableName/,
    )
  })

  it('throws on an invalid keyColumn', () => {
    expect(() => idempotency({ tableName: 'transactions', keyColumn: 'col; bad' })).toThrow(
      /invalid keyColumn/,
    )
  })

  it('accepts valid identifiers', () => {
    expect(() =>
      idempotency({ tableName: 'transactions', keyColumn: 'idempotency_key' }),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Request-level logic (no DB — db.transaction is mocked)
// ---------------------------------------------------------------------------

// We mock the db module so no Postgres connection is needed.
vi.mock('../../src/shared/db/index.js', () => ({
  db: {
    transaction: vi.fn(),
  },
}))

// Import after mock so we get the mocked version.
const { db } = await import('../../src/shared/db/index.js')
const dbTxMock = db.transaction as Mock

describe('idempotency middleware', () => {
  it('passes GET requests through without querying DB', async () => {
    const mw = idempotency({ tableName: 'transactions' })
    const req = makeReq({ method: 'GET' })
    const res = makeRes()
    const next = vi.fn()

    await mw(req as Request, res as unknown as Response, next as NextFunction)

    expect(next).toHaveBeenCalledOnce()
    expect(dbTxMock).not.toHaveBeenCalled()
  })

  it('passes through when no Idempotency-Key header is present', async () => {
    const mw = idempotency({ tableName: 'transactions' })
    const req = makeReq({ get: () => undefined })
    const res = makeRes()
    const next = vi.fn()

    await mw(req as Request, res as unknown as Response, next as NextFunction)

    expect(next).toHaveBeenCalledOnce()
    expect(dbTxMock).not.toHaveBeenCalled()
  })

  it('returns 400 for a key that is too short', async () => {
    const mw = idempotency({ tableName: 'transactions' })
    const req = makeReq({ get: (h: string) => (h === 'idempotency-key' ? 'short' : undefined) })
    const res = makeRes()
    const next = vi.fn()

    await mw(req as Request, res as unknown as Response, next as NextFunction)

    expect(res._status).toBe(400)
    expect((res._body as { code: string }).code).toBe('IDEMPOTENCY_KEY_INVALID')
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 400 for a key with illegal characters', async () => {
    const mw = idempotency({ tableName: 'transactions' })
    const req = makeReq({
      get: (h: string) => (h === 'idempotency-key' ? 'key with spaces!' : undefined),
    })
    const res = makeRes()
    const next = vi.fn()

    await mw(req as Request, res as unknown as Response, next as NextFunction)

    expect(res._status).toBe(400)
    expect((res._body as { code: string }).code).toBe('IDEMPOTENCY_KEY_INVALID')
  })

  it('returns 500 when tenant context is missing', async () => {
    const mw = idempotency({ tableName: 'transactions' })
    const req = makeReq({
      get: (h: string) => (h === 'idempotency-key' ? 'valid-key-12345' : undefined),
      tenant: undefined as unknown as Request['tenant'],
    })
    const res = makeRes()
    const next = vi.fn()

    await mw(req as Request, res as unknown as Response, next as NextFunction)

    expect(res._status).toBe(500)
    expect((res._body as { code: string }).code).toBe('TENANT_MISSING')
  })

  it('returns 200 with replay header for a terminal row', async () => {
    dbTxMock.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        execute: vi.fn().mockResolvedValue([{ id: 'TXN-2026-ABC', status: 'completed' }]),
      }
      return fn(tx)
    })

    const mw = idempotency({ tableName: 'transactions' })
    const req = makeReq({
      get: (h: string) => (h === 'idempotency-key' ? 'valid-key-12345' : undefined),
    })
    const res = makeRes()
    const next = vi.fn()

    await mw(req as Request, res as unknown as Response, next as NextFunction)

    expect(res._status).toBe(200)
    expect(res._headers['X-Idempotent-Replay']).toBe('true')
    expect((res._body as { idempotentReplay: boolean }).idempotentReplay).toBe(true)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 409 for an in-flight row (non-terminal status)', async () => {
    dbTxMock.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      const tx = { execute: vi.fn().mockResolvedValue([{ id: 'TXN-2026-XYZ', status: 'pending' }]) }
      return fn(tx)
    })

    const mw = idempotency({ tableName: 'transactions' })
    const req = makeReq({
      get: (h: string) => (h === 'idempotency-key' ? 'valid-key-12345' : undefined),
    })
    const res = makeRes()
    const next = vi.fn()

    await mw(req as Request, res as unknown as Response, next as NextFunction)

    expect(res._status).toBe(409)
    expect((res._body as { code: string }).code).toBe('IDEMPOTENCY_IN_FLIGHT')
    expect(next).not.toHaveBeenCalled()
  })

  it('attaches req.idempotencyKey and calls next when row not found', async () => {
    dbTxMock.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      const tx = { execute: vi.fn().mockResolvedValue([]) }
      return fn(tx)
    })

    const mw = idempotency({ tableName: 'transactions' })
    const req = makeReq({
      get: (h: string) => (h === 'idempotency-key' ? 'valid-key-12345' : undefined),
    })
    const res = makeRes()
    const next = vi.fn()

    await mw(req as Request, res as unknown as Response, next as NextFunction)

    expect(next).toHaveBeenCalledOnce()
    expect((req as Request & { idempotencyKey: string }).idempotencyKey).toBe('valid-key-12345')
  })

  it('respects custom terminalStatuses', async () => {
    dbTxMock.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        execute: vi.fn().mockResolvedValue([{ id: 'ORD-2026-ABC', status: 'administered' }]),
      }
      return fn(tx)
    })

    const mw = idempotency({ tableName: 'clinical_orders', terminalStatuses: ['administered'] })
    const req = makeReq({
      get: (h: string) => (h === 'idempotency-key' ? 'valid-key-12345' : undefined),
    })
    const res = makeRes()
    const next = vi.fn()

    await mw(req as Request, res as unknown as Response, next as NextFunction)

    expect(res._status).toBe(200)
    expect((res._body as { idempotentReplay: boolean }).idempotentReplay).toBe(true)
  })

  /**
   * Regression guards. All three mounts of this middleware were non-functional
   * before 2026-07-25, in two distinct ways, and nothing caught it because the
   * only coverage used lower-case mock statuses that no real enum produces.
   */
  it('matches a terminal status case-insensitively', async () => {
    // transaction_status is capitalized ('Paid'), the default terminal list is
    // lower-case. Before the fold, `includes('Paid')` was false, so a replayed
    // key answered 409 IDEMPOTENCY_IN_FLIGHT for a fully-paid transaction.
    dbTxMock.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        execute: vi.fn().mockResolvedValue([{ id: '1', display_id: 'TXN_ABC', status: 'Paid' }]),
      }
      return fn(tx)
    })

    const mw = idempotency({ tableName: 'transactions' })
    const req = makeReq({
      get: (h: string) => (h === 'idempotency-key' ? 'valid-key-12345' : undefined),
    })
    const res = makeRes()
    await mw(req as Request, res as unknown as Response, vi.fn() as NextFunction)

    expect(res._status).toBe(200)
    expect((res._body as { idempotentReplay: boolean }).idempotentReplay).toBe(true)
  })

  it('treats any existing row as terminal when statusColumn is null', async () => {
    // `payments` has no `status` column, so the default projection raised
    // Postgres 42703 and the route 500'd for every Idempotency-Key request.
    dbTxMock.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      const tx = { execute: vi.fn().mockResolvedValue([{ id: '7', display_id: 'PMT_XYZ' }]) }
      return fn(tx)
    })

    const mw = idempotency({ tableName: 'payments', statusColumn: null })
    const req = makeReq({
      get: (h: string) => (h === 'idempotency-key' ? 'valid-key-12345' : undefined),
    })
    const res = makeRes()
    await mw(req as Request, res as unknown as Response, vi.fn() as NextFunction)

    expect(res._status).toBe(200)
    expect((res._body as { id: string }).id).toBe('PMT_XYZ')
    expect((res._body as { idempotentReplay: boolean }).idempotentReplay).toBe(true)
  })

  it('does not select a status column when statusColumn is null', async () => {
    // The projection itself is the bug surface: asking for a column the table
    // does not have is what produced the 42703.
    const execute = vi.fn().mockResolvedValue([])
    dbTxMock.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => fn({ execute }))

    const mw = idempotency({ tableName: 'payments', statusColumn: null })
    const req = makeReq({
      get: (h: string) => (h === 'idempotency-key' ? 'valid-key-12345' : undefined),
    })
    await mw(req as Request, makeRes() as unknown as Response, vi.fn() as NextFunction)

    const queryText = JSON.stringify(execute.mock.calls[0]?.[0] ?? {})
    expect(queryText).not.toMatch(/\bstatus\b/)
  })

  it('rejects an invalid statusColumn identifier at factory time', () => {
    expect(() =>
      idempotency({ tableName: 'payments', statusColumn: 'status; DROP TABLE' }),
    ).toThrow(/invalid statusColumn/)
  })
})
