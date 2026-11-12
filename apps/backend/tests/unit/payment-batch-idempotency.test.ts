import { describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'

vi.hoisted(() => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://surevax:test@localhost:5432/surevax_test',
    COOKIE_SECRET: 'test-cookie-secret',
    JWT_SECRET: 'test-jwt-secret',
    JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
    CORS_ORIGIN: 'http://localhost:5173',
  })
})

import { rejectUnsupportedBatchIdempotency } from '../../src/modules/transactions/routes.js'

function responseRecorder() {
  const state: { status?: number; body?: unknown } = {}
  const response = {
    status(code: number) {
      state.status = code
      return response
    },
    json(body: unknown) {
      state.body = body
      return response
    },
  } as unknown as Response
  return { response, state }
}

describe('payment batch idempotency contract', () => {
  it('rejects an unsupported replay key before any batch action can run', () => {
    const { response, state } = responseRecorder()
    const request = {
      get: vi.fn((name: string) => (name === 'Idempotency-Key' ? 'batch-key' : undefined)),
    } as unknown as Request
    const next = vi.fn() as NextFunction

    rejectUnsupportedBatchIdempotency(request, response, next)

    expect(state).toEqual({
      status: 400,
      body: {
        error: 'Idempotency-Key is not supported for payment batches',
        code: 'IDEMPOTENCY_UNSUPPORTED',
      },
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('passes an ordinary atomic batch through', () => {
    const { response, state } = responseRecorder()
    const request = { get: vi.fn(() => undefined) } as unknown as Request
    const next = vi.fn() as NextFunction

    rejectUnsupportedBatchIdempotency(request, response, next)

    expect(state).toEqual({})
    expect(next).toHaveBeenCalledOnce()
  })
})
