import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { app } from '../../src/app.js'

// F1 (2026-06-12 comprehensive review) — vertical privilege escalation guard.
// /api/admin/users mounts with requireRole('TenantAdmin','BranchAdmin'), so a
// BranchAdmin reaches every handler. Without a caller-vs-target check they
// could mint a TenantAdmin or take over one by resetting its password. These
// tests lock the guard: only a TenantAdmin may assign admin-level roles
// (TenantAdmin/SuperAdmin/BranchAdmin) or mutate the credentials/roles of a
// user who holds one.

const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': 'SVX' as const,
}
const PASSWORD = 'TestPass123!'
// Supertest writes persist in the shared post-seed DB — suffix emails so
// repeated runs don't collide (see patterns.md "BEGIN/ROLLBACK test isolation",
// supertest caveat).
const SUFFIX = Date.now()

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined
  const match = setCookie.find((c) => c.startsWith(`${name}=`))
  return match?.split(';')[0]?.slice(`${name}=`.length)
}

async function loginAs(email: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .set(FETCH_HEADER)
    .send({ email, password: PASSWORD })
  expect(res.status, `login as ${email} → ${res.status}`).toBe(200)
  const cookie = findCookie(res.headers['set-cookie'] as unknown as string[], 'access_token')
  expect(cookie, `no access_token cookie for ${email}`).toBeTruthy()
  return cookie as string
}

function newUserBody(role: string, tag: string) {
  return {
    email: `f1-${tag}-${SUFFIX}@test.surevax.com`,
    firstName: 'F1',
    lastName: tag,
    password: PASSWORD,
    role,
  }
}

describe('admin users privilege guard (F1)', () => {
  let adminCookie: string
  let branchAdminCookie: string
  /** USR_ display_id of a TenantAdmin created by the test (safe to mutate). */
  let targetTenantAdminId: string
  /** USR_ display_id of a Nurse created by the test (non-admin target). */
  let targetNurseId: string

  beforeAll(async () => {
    adminCookie = await loginAs('admin@surevax.com')

    // TenantAdmin creates a BranchAdmin → 201 (TenantAdmin MAY assign admin-level roles).
    const baBody = newUserBody('BranchAdmin', 'branchadmin')
    const baRes = await request(app)
      .post('/api/admin/users')
      .set('Cookie', `access_token=${adminCookie}`)
      .set(FETCH_HEADER)
      .send(baBody)
    expect(baRes.status, JSON.stringify(baRes.body)).toBe(201)

    // TenantAdmin creates another TenantAdmin → 201 (required allow case).
    const taRes = await request(app)
      .post('/api/admin/users')
      .set('Cookie', `access_token=${adminCookie}`)
      .set(FETCH_HEADER)
      .send(newUserBody('TenantAdmin', 'tenantadmin'))
    expect(taRes.status, JSON.stringify(taRes.body)).toBe(201)
    targetTenantAdminId = taRes.body.id as string

    // TenantAdmin creates a Nurse — the non-admin PATCH target.
    const nurseRes = await request(app)
      .post('/api/admin/users')
      .set('Cookie', `access_token=${adminCookie}`)
      .set(FETCH_HEADER)
      .send(newUserBody('Nurse', 'nurse'))
    expect(nurseRes.status, JSON.stringify(nurseRes.body)).toBe(201)
    targetNurseId = nurseRes.body.id as string

    branchAdminCookie = await loginAs(baBody.email)
  })

  it('BranchAdmin cannot create a TenantAdmin → 403 ROLE_ESCALATION_FORBIDDEN', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Cookie', `access_token=${branchAdminCookie}`)
      .set(FETCH_HEADER)
      .send(newUserBody('TenantAdmin', 'escalate-create'))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ROLE_ESCALATION_FORBIDDEN')
  })

  it('BranchAdmin cannot create another BranchAdmin (admin-level role) → 403', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Cookie', `access_token=${branchAdminCookie}`)
      .set(FETCH_HEADER)
      .send(newUserBody('BranchAdmin', 'escalate-peer'))
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ROLE_ESCALATION_FORBIDDEN')
  })

  it('BranchAdmin can create a Nurse → 201', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Cookie', `access_token=${branchAdminCookie}`)
      .set(FETCH_HEADER)
      .send(newUserBody('Nurse', 'nurse-by-ba'))
    expect(res.status, JSON.stringify(res.body)).toBe(201)
  })

  it("BranchAdmin cannot reset a TenantAdmin's password → 403", async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${targetTenantAdminId}`)
      .set('Cookie', `access_token=${branchAdminCookie}`)
      .set(FETCH_HEADER)
      .send({ password: 'Hijacked123!' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ROLE_ESCALATION_FORBIDDEN')
  })

  it("BranchAdmin cannot change a TenantAdmin's roles (demotion) → 403", async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${targetTenantAdminId}`)
      .set('Cookie', `access_token=${branchAdminCookie}`)
      .set(FETCH_HEADER)
      .send({ roles: ['Nurse'] })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ROLE_ESCALATION_FORBIDDEN')
  })

  it('BranchAdmin cannot promote a Nurse to an admin-level role → 403', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${targetNurseId}`)
      .set('Cookie', `access_token=${branchAdminCookie}`)
      .set(FETCH_HEADER)
      .send({ roles: ['BranchAdmin'] })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ROLE_ESCALATION_FORBIDDEN')
  })

  it("BranchAdmin can reset a Nurse's password → 200", async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${targetNurseId}`)
      .set('Cookie', `access_token=${branchAdminCookie}`)
      .set(FETCH_HEADER)
      .send({ password: 'RotatedPass123!' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  })

  it("TenantAdmin can reset another TenantAdmin's password → 200", async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${targetTenantAdminId}`)
      .set('Cookie', `access_token=${adminCookie}`)
      .set(FETCH_HEADER)
      .send({ password: 'RotatedPass123!' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  })

  it("BranchAdmin cannot set a TenantAdmin's kiosk PIN → 403", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${targetTenantAdminId}/reset-pin`)
      .set('Cookie', `access_token=${branchAdminCookie}`)
      .set(FETCH_HEADER)
      .send({ pin: '1234' })
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ROLE_ESCALATION_FORBIDDEN')
  })

  it("BranchAdmin can set a Nurse's kiosk PIN → 200", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${targetNurseId}/reset-pin`)
      .set('Cookie', `access_token=${branchAdminCookie}`)
      .set(FETCH_HEADER)
      .send({ pin: '4321' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  })
})
