import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://surevax:test@localhost:5432/surevax_test',
    COOKIE_SECRET: 'test-cookie-secret',
    JWT_SECRET: 'test-jwt-secret',
    JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
    CORS_ORIGIN: 'http://localhost:5173',
  })

  return {
    resolvePatientBranchContext: vi.fn(),
    payOnAccount: vi.fn(),
    applyCreditOnAccount: vi.fn(),
    generateHealthCard: vi.fn(),
  }
})

vi.mock('../../src/modules/patients/db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/modules/patients/db.js')>()),
  resolvePatientBranchContext: mocks.resolvePatientBranchContext,
}))

vi.mock('../../src/modules/transactions/db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/modules/transactions/db.js')>()),
  payOnAccount: mocks.payOnAccount,
  applyCreditOnAccount: mocks.applyCreditOnAccount,
}))

vi.mock('../../src/modules/health_cards/service.js', () => ({
  generateHealthCard: mocks.generateHealthCard,
}))

import { patientAccountsRouter } from '../../src/modules/patient_accounts/routes.js'
import { healthCardsRouter } from '../../src/modules/health_cards/routes.js'

function appFor(branchId = 1) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    Object.assign(req, {
      user: {
        id: 7,
        displayId: 'USR_AAAAAAA1',
        email: 'staff@example.test',
        role: 'Nurse',
        tenantId: 'SVX',
        branchId,
        isPlatformAdmin: false,
      },
      tenant: { id: 'SVX', userId: 7, branchId },
    })
    next()
  })
  app.use('/api/patients', patientAccountsRouter)
  app.use('/api/patients', healthCardsRouter)
  return app
}

const patientId = 'PAT_AAAAAAA1'

describe('cross-branch patient financial and export boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePatientBranchContext.mockResolvedValue({ id: 42, homeBranchId: 2 })
  })

  it('rejects a patient-account payment before payment attribution or writes', async () => {
    const response = await request(appFor()).post(`/api/patients/${patientId}/payments`).send({})

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('CROSS_BRANCH_WRITE_FORBIDDEN')
    expect(mocks.payOnAccount).not.toHaveBeenCalled()
  })

  it('rejects applying patient credit before financial writes', async () => {
    const response = await request(appFor())
      .post(`/api/patients/${patientId}/apply-credit`)
      .send({})

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('CROSS_BRANCH_WRITE_FORBIDDEN')
    expect(mocks.applyCreditOnAccount).not.toHaveBeenCalled()
  })

  it('rejects health-card export before PDF generation', async () => {
    const response = await request(appFor()).get(`/api/patients/${patientId}/health-card`)

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('CROSS_BRANCH_EXPORT_FORBIDDEN')
    expect(mocks.generateHealthCard).not.toHaveBeenCalled()
  })
})
