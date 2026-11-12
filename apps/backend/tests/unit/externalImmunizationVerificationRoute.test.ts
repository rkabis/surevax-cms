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
    resolveClinicalReviewer: vi.fn(),
    verifyExternalImmunization: vi.fn(),
  }
})

vi.mock('../../src/modules/patients/db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/modules/patients/db.js')>()),
  resolvePatientBranchContext: mocks.resolvePatientBranchContext,
  verifyExternalImmunization: mocks.verifyExternalImmunization,
}))

vi.mock('../../src/shared/utils/clinicianAttestation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/utils/clinicianAttestation.js')>()),
  resolveClinicalReviewer: mocks.resolveClinicalReviewer,
}))

import { patientsRouter } from '../../src/modules/patients/routes.js'

function appFor(role: string, branchId = 1) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    Object.assign(req, {
      user: {
        id: 7,
        displayId: 'USR_AAAAAAA1',
        email: 'staff@example.test',
        role,
        tenantId: 'SVX',
        branchId,
        isPlatformAdmin: false,
      },
      tenant: { id: 'SVX', userId: 7, branchId },
    })
    next()
  })
  app.use('/api/patients', patientsRouter)
  return app
}

const path = '/api/patients/PAT_AAAAAAA1/external-immunizations/42/verify'

describe('external immunization verification route safety', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a cashier before reviewer attestation is attempted', async () => {
    const response = await request(appFor('Cashier')).patch(path).send({})
    expect(response.status).toBe(403)
    expect(mocks.resolveClinicalReviewer).not.toHaveBeenCalled()
  })

  it('rejects cross-branch verification before reviewer attestation', async () => {
    mocks.resolvePatientBranchContext.mockResolvedValue({ id: 42, homeBranchId: 2 })
    const response = await request(appFor('Nurse', 1)).patch(path).send({})
    expect(response.status).toBe(403)
    expect(response.body.code).toBe('CROSS_BRANCH_WRITE_FORBIDDEN')
    expect(mocks.resolveClinicalReviewer).not.toHaveBeenCalled()
  })

  it('reports an already-verified record as a conflict rather than not found', async () => {
    mocks.resolvePatientBranchContext.mockResolvedValue({ id: 42, homeBranchId: 1 })
    mocks.resolveClinicalReviewer.mockResolvedValue(7)
    mocks.verifyExternalImmunization.mockResolvedValue({
      ok: false,
      code: 'ALREADY_VERIFIED',
    })

    const response = await request(appFor('Nurse', 1)).patch(path).send({})
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('ALREADY_VERIFIED')
  })
})
