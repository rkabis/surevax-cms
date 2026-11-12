import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'

const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': 'SVX' as const,
}

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  return setCookie
    ?.find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(';')[0]
    ?.slice(name.length + 1)
}

describe('arrivals clinical safety guards', () => {
  let branchCookie: string

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .set(FETCH_HEADER)
      .send({ email: 'branch-main@surevax.com', password: 'TestPass123!' })

    expect(login.status, JSON.stringify(login.body)).toBe(200)
    const cookie = findCookie(login.headers['set-cookie'] as string[] | undefined, 'access_token')
    expect(cookie).toBeTruthy()
    branchCookie = cookie as string
  })

  it('refuses a Rabies atomic arrival without a WHO exposure category', async () => {
    const response = await request(app)
      .post('/api/arrivals/atomic')
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${branchCookie}`)
      .send({
        patientId: 'PAT_AAAAAAA1',
        templateIds: ['SOT_RABIES_PEP_IM'],
        specialty: 'Rabies',
        consentBy: 'Patient',
        consentObtained: true,
      })

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('BAD_REQUEST')
  })

  it('refuses a Category III arrival whose selected templates contain no RIG service', async () => {
    const response = await request(app)
      .post('/api/arrivals/atomic')
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${branchCookie}`)
      .send({
        patientId: 'PAT_AAAAAAA1',
        templateIds: ['SOT_RABIES_PEP_IM'],
        specialty: 'Rabies',
        triageCategory: 'III',
        specialtyData: { biteAssessment: { whoCategory: 'III' } },
        consentBy: 'Patient',
        consentObtained: true,
      })

    expect(response.status, JSON.stringify(response.body)).toBe(400)
    expect(response.body.code).toBe('CAT_III_RIG_REQUIRED')
  })

  it('routes duplicate-arrival attempts back to the existing open encounter', async () => {
    const response = await request(app)
      .post('/api/arrivals/atomic')
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${branchCookie}`)
      .send({
        patientId: 'PAT_AAAAAAA2',
        templateIds: ['SOT_FLU_ANNUAL'],
        specialty: 'Flu',
        consentBy: 'Patient',
        consentObtained: true,
      })

    expect(response.status, JSON.stringify(response.body)).toBe(409)
    expect(response.body).toMatchObject({
      code: 'ACTIVE_ENCOUNTER_EXISTS',
      activeEncounterId: expect.stringMatching(/^ENC_/),
    })
  })

  it('denies cross-branch patient, encounter, and protocol writes', async () => {
    const patientUpdate = await request(app)
      .patch('/api/patients/PAT_AAAAAAC1')
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${branchCookie}`)
      .send({ firstName: 'Teresa' })
    expect(patientUpdate.status, JSON.stringify(patientUpdate.body)).toBe(403)
    expect(patientUpdate.body.code).toBe('CROSS_BRANCH_WRITE_FORBIDDEN')

    const encounter = await request(app)
      .post('/api/encounters')
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${branchCookie}`)
      .send({ patientId: 'PAT_AAAAAAC1', specialty: 'General' })
    expect(encounter.status, JSON.stringify(encounter.body)).toBe(403)
    expect(encounter.body.code).toBe('CROSS_BRANCH_WRITE_FORBIDDEN')

    const protocol = await request(app)
      .post('/api/patient-standing-orders')
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${branchCookie}`)
      .send({
        patientId: 'PAT_AAAAAAC1',
        templateId: 'SOT_FLU_ANNUAL',
        authorizingProviderId: 'USR_AAAAAAA2',
      })
    expect(protocol.status, JSON.stringify(protocol.body)).toBe(403)
    expect(protocol.body.code).toBe('CROSS_BRANCH_WRITE_FORBIDDEN')
  })

  it('finds one patient by either name order, displayed comma format, MRN, and normalized phone', async () => {
    const queries = ['Miguel Torres', 'Torres Miguel', 'Torres, Miguel', '09182345678']

    for (const query of queries) {
      const response = await request(app)
        .get('/api/patients')
        .query({ q: query, limit: 10 })
        .set(FETCH_HEADER)
        .set('Cookie', `access_token=${branchCookie}`)

      expect(response.status, JSON.stringify(response.body)).toBe(200)
      expect(response.body.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'PAT_AAAAAAA2' })]),
      )
    }

    const baseline = await request(app)
      .get('/api/patients')
      .query({ q: 'Torres, Miguel', limit: 10 })
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${branchCookie}`)
    const torres = baseline.body.data.find(
      (patient: { id: string }) => patient.id === 'PAT_AAAAAAA2',
    )
    expect(torres?.mrn).toMatch(/^MRN-/)

    const byMrn = await request(app)
      .get('/api/patients')
      .query({ q: torres.mrn, limit: 10 })
      .set(FETCH_HEADER)
      .set('Cookie', `access_token=${branchCookie}`)
    expect(byMrn.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'PAT_AAAAAAA2' })]),
    )
  })
})
