import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import postgres from 'postgres'
import { sql as drizzleSql } from 'drizzle-orm'
import { app } from '../../src/app.js'
import { displayId } from '../../src/shared/utils/displayId.js'
import { signAccess } from '../../src/modules/auth/service.js'
import { withTenantTx } from '../../src/shared/db/withTenantTx.js'

const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': 'SVX' as const,
}
const PASSWORD = 'TestPass123!'

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  return setCookie
    ?.find((value) => value.startsWith(`${name}=`))
    ?.split(';')[0]
    ?.split('=')[1]
}

async function loginAs(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/auth/login')
    .set(FETCH_HEADER)
    .send({ email, password: PASSWORD })
  expect(response.status, JSON.stringify(response.body)).toBe(200)
  const cookie = findCookie(response.headers['set-cookie'] as unknown as string[], 'access_token')
  expect(cookie).toBeTruthy()
  return cookie as string
}

describe('runtime Review Center', () => {
  const hstPatientId = displayId('PAT')
  const tmgPatientId = displayId('PAT')
  const priorManilaEncounterId = displayId('ENC')
  const sameManilaDayEncounterId = displayId('ENC')
  const priorDrawerId = displayId('CSH')
  const uniqueName = `ReviewCenter${Date.now()}`
  const sql = postgres(process.env['DATABASE_MIGRATOR_URL'] || process.env['DATABASE_URL']!)
  let branchCookie: string
  let tmgBranchCookie: string
  let cashierCookie: string
  let nurseCookie: string
  let hstBranchId: number
  let tmgBranchId: number
  let adminUserId: number

  beforeAll(async () => {
    branchCookie = await loginAs('branch-main@surevax.com')
    tmgBranchCookie = await loginAs('surevax.tmg@surevax.com')

    const [hst] = await sql<{ id: number }[]>`
      SELECT id FROM branches WHERE tenant_id = 'SVX' AND code = 'HST' LIMIT 1
    `
    const [tmg] = await sql<{ id: number }[]>`
      SELECT id FROM branches WHERE tenant_id = 'SVX' AND code = 'TMG' LIMIT 1
    `
    const [admin] = await sql<{ id: number }[]>`
      SELECT id FROM users
      WHERE tenant_id = 'SVX' AND email = 'admin@surevax.com' LIMIT 1
    `
    const [cashier] = await sql<{ displayId: string; email: string }[]>`
      SELECT display_id AS "displayId", email FROM users
      WHERE tenant_id = 'SVX' AND email = 'jose.santos@surevax.com' LIMIT 1
    `
    const [nurse] = await sql<{ displayId: string; email: string }[]>`
      SELECT display_id AS "displayId", email FROM users
      WHERE tenant_id = 'SVX' AND email = 'juan.dc@surevax.com' LIMIT 1
    `
    hstBranchId = hst!.id
    tmgBranchId = tmg!.id
    adminUserId = admin!.id
    // Seeded clinical/cashier directory entries are intentionally PIN-only.
    // Mint the same signed tenant access token the login service would issue so
    // this test reaches the server role gate without changing account policy.
    cashierCookie = signAccess({
      sub: cashier!.displayId,
      email: cashier!.email,
      role: 'Cashier',
      tenantSlug: 'SVX',
      branchCode: 'HST',
    })
    nurseCookie = signAccess({
      sub: nurse!.displayId,
      email: nurse!.email,
      role: 'Nurse',
      tenantSlug: 'SVX',
      branchCode: 'HST',
    })

    await sql`SELECT set_config('app.current_tenant_id', 'SVX', false)`
    await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, false)`
    await sql`SELECT set_config('app.current_branch_id', ${String(hstBranchId)}, false)`
    await sql`
      INSERT INTO patients (
        display_id, tenant_id, home_branch_id, mrn, first_name, last_name,
        date_of_birth, created_by_id
      ) VALUES (
        ${hstPatientId}, 'SVX', ${hstBranchId}, ${`MRN-${Date.now()}1`},
        'Phase One', ${uniqueName}, '2015-04-12', ${adminUserId}
      )
    `
    await sql`SELECT set_config('app.current_branch_id', ${String(tmgBranchId)}, false)`
    await sql`
      INSERT INTO patients (
        display_id, tenant_id, home_branch_id, mrn, first_name, last_name,
        date_of_birth, created_by_id
      ) VALUES (
        ${tmgPatientId}, 'SVX', ${tmgBranchId}, ${`MRN-${Date.now()}2`},
        'Other Branch', ${uniqueName}, '2014-05-13', ${adminUserId}
      )
    `
    await sql`SELECT set_config('app.current_branch_id', ${String(hstBranchId)}, false)`
    await sql`
      INSERT INTO encounters (
        display_id, tenant_id, patient_id, branch_id, specialty, status,
        started_at, created_by_id
      ) VALUES
      (
        ${priorManilaEncounterId}, 'SVX',
        (SELECT id FROM patients WHERE display_id = ${hstPatientId}),
        ${hstBranchId}, 'Rabies', 'Open', '2026-08-22T15:30:00Z', ${adminUserId}
      ),
      (
        ${sameManilaDayEncounterId}, 'SVX',
        (SELECT id FROM patients WHERE display_id = ${hstPatientId}),
        ${hstBranchId}, 'Rabies', 'Open', '2026-08-22T16:30:00Z', ${adminUserId}
      )
    `
    await sql`SELECT set_config('app.current_branch_id', ${String(tmgBranchId)}, false)`
    await sql`
      INSERT INTO cash_drawer_sessions (
        display_id, tenant_id, user_id, branch_id, state, opening_float,
        opened_at, created_by_id
      ) VALUES (
        ${priorDrawerId}, 'SVX', ${adminUserId}, ${tmgBranchId}, 'Open', '1000.00',
        '2026-08-21T01:00:00Z', ${adminUserId}
      )
    `
  })

  afterAll(async () => {
    try {
      await sql`SELECT set_config('app.current_tenant_id', 'SVX', false)`
      await sql`SELECT set_config('app.current_user_id', ${String(adminUserId)}, false)`
      await sql`SELECT set_config('app.current_branch_id', ${String(hstBranchId)}, false)`
      await sql`
        DELETE FROM encounters
        WHERE display_id IN (${priorManilaEncounterId}, ${sameManilaDayEncounterId})
      `
      await sql`SELECT set_config('app.current_branch_id', ${String(tmgBranchId)}, false)`
      await sql`DELETE FROM cash_drawer_sessions WHERE display_id = ${priorDrawerId}`
      await sql`SELECT set_config('app.current_branch_id', ${String(hstBranchId)}, false)`
      await sql`DELETE FROM patients WHERE display_id IN (${hstPatientId}, ${tmgPatientId})`
      await sql`
        DELETE FROM audit_logs
        WHERE entity_id IN (
          ${hstPatientId}, ${tmgPatientId},
          ${priorManilaEncounterId}, ${sameManilaDayEncounterId}, ${priorDrawerId}
        )
      `
    } finally {
      await sql.end({ timeout: 5 })
    }
  })

  it('rejects a Cashier at the server role gate', async () => {
    const response = await request(app)
      .get('/api/review-center')
      .set('Cookie', `access_token=${cashierCookie}`)
      .set(FETCH_HEADER)
    expect(response.status).toBe(403)
    expect(response.body.code).toBe('FORBIDDEN')
  })

  it('rejects an impossible clinic date before it reaches PostgreSQL', async () => {
    const response = await request(app)
      .get('/api/review-center')
      .query({ date: '2026-02-30' })
      .set('Cookie', `access_token=${branchCookie}`)
      .set(FETCH_HEADER)
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('VALIDATION_ERROR')
  })

  it('classifies timestamped loose ends by the Asia/Manila clinic day', async () => {
    const response = await request(app)
      .get('/api/review-center')
      .query({ date: '2026-08-23' })
      .set('Cookie', `access_token=${branchCookie}`)
      .set(FETCH_HEADER)

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const encounterIds = response.body.yesterdayLooseEnds.staleOpenEncounters.rows.map(
      (row: { encounterId: string }) => row.encounterId,
    )
    expect(encounterIds).toContain(priorManilaEncounterId)
    expect(encounterIds).not.toContain(sameManilaDayEncounterId)
  })

  it('keeps a prior open drawer resolvable in its branch-kiosk owner workflow', async () => {
    const review = await request(app)
      .get('/api/review-center')
      .query({ date: '2026-08-23' })
      .set('Cookie', `access_token=${tmgBranchCookie}`)
      .set(FETCH_HEADER)
    expect(review.status, JSON.stringify(review.body)).toBe(200)
    expect(
      review.body.yesterdayLooseEnds.openPriorDrawers.rows.map(
        (row: { sessionId: string }) => row.sessionId,
      ),
    ).toContain(priorDrawerId)

    const owner = await request(app)
      .get('/api/cash-drawer/current')
      .set('Cookie', `access_token=${tmgBranchCookie}`)
      .set(FETCH_HEADER)
    expect(owner.status, JSON.stringify(owner.body)).toBe(200)
    expect(owner.body.id).toBe(priorDrawerId)
  })

  it('does not let a clinical-only reviewer operate the financial drawer', async () => {
    const review = await request(app)
      .get('/api/review-center')
      .query({ date: '2026-08-23' })
      .set('Cookie', `access_token=${nurseCookie}`)
      .set(FETCH_HEADER)
    expect(review.status, JSON.stringify(review.body)).toBe(200)

    const drawer = await request(app)
      .get('/api/cash-drawer/current')
      .set('Cookie', `access_token=${nurseCookie}`)
      .set(FETCH_HEADER)
    expect(drawer.status).toBe(403)
    expect(drawer.body.code).toBe('FORBIDDEN')
  })

  it('returns only the signed-in branch minor in the guardian queue', async () => {
    const response = await request(app)
      .get('/api/review-center')
      .query({ date: '2026-08-22', q: uniqueName })
      .set('Cookie', `access_token=${branchCookie}`)
      .set(FETCH_HEADER)

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.missingGuardians.count).toBe(1)
    expect(response.body.missingGuardians.rows).toHaveLength(1)
    expect(response.body.missingGuardians.rows[0].patientId).toBe(hstPatientId)
    expect(response.body.missingGuardians.rows[0].rowVersion).toBe(0)
  })

  it('does not expose a cross-branch guardian write target', async () => {
    const response = await request(app)
      .patch(`/api/review-center/missing-guardians/${tmgPatientId}`)
      .set('Cookie', `access_token=${branchCookie}`)
      .set(FETCH_HEADER)
      .send({
        guardianName: 'Wrong Branch',
        guardianRelationship: 'Parent',
        guardianContact: '09000000000',
        expectedRowVersion: 0,
      })
    expect(response.status).toBe(404)

    const [patient] = await sql<{ guardianName: string | null }[]>`
      SELECT guardian_name AS "guardianName" FROM patients WHERE display_id = ${tmgPatientId}
    `
    expect(patient?.guardianName).toBeNull()
  })

  it('rejects a stale review without partially changing guardian fields', async () => {
    const response = await request(app)
      .patch(`/api/review-center/missing-guardians/${hstPatientId}`)
      .set('Cookie', `access_token=${branchCookie}`)
      .set(FETCH_HEADER)
      .send({
        guardianName: 'Stale Parent',
        guardianRelationship: 'Parent',
        guardianContact: '09111111111',
        expectedRowVersion: 99,
      })
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('STALE_RECORD')

    const [patient] = await sql<{ guardianName: string | null; guardianContact: string | null }[]>`
      SELECT guardian_name AS "guardianName", guardian_contact AS "guardianContact"
      FROM patients WHERE display_id = ${hstPatientId}
    `
    expect(patient).toEqual({ guardianName: null, guardianContact: null })
  })

  it('rolls back the patient update when its accountable audit write fails', async () => {
    await expect(
      withTenantTx({ tenantId: 'SVX', branchId: hstBranchId, userId: adminUserId }, async (tx) => {
        await tx.execute(drizzleSql`
            UPDATE patients
            SET guardian_name = 'Rollback Parent',
                guardian_relationship = 'Parent',
                guardian_contact = '09222222222'
            WHERE tenant_id = 'SVX' AND display_id = ${hstPatientId}
          `)
        // The patient UPDATE and its database-triggered audit INSERT share
        // this transaction. A later failure must roll both writes back.
        throw new Error('forced failure after patient and audit writes')
      }),
    ).rejects.toBeTruthy()

    const [patient] = await sql<
      {
        guardianName: string | null
        guardianRelationship: string | null
        guardianContact: string | null
        rowVersion: number
      }[]
    >`
      SELECT guardian_name AS "guardianName",
        guardian_relationship AS "guardianRelationship",
        guardian_contact AS "guardianContact", row_version AS "rowVersion"
      FROM patients WHERE display_id = ${hstPatientId}
    `
    expect(patient).toEqual({
      guardianName: null,
      guardianRelationship: null,
      guardianContact: null,
      rowVersion: 0,
    })
    const [audit] = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM audit_logs
      WHERE tenant_id = 'SVX' AND entity_id = ${hstPatientId} AND action = 'UPDATE'
    `
    expect(audit?.count).toBe(0)
  })

  it('atomically saves the reviewed guardian fields and accountable audit event', async () => {
    const response = await request(app)
      .patch(`/api/review-center/missing-guardians/${hstPatientId}`)
      .set('Cookie', `access_token=${branchCookie}`)
      .set(FETCH_HEADER)
      .send({
        guardianName: 'Confirmed Parent',
        guardianRelationship: 'Mother',
        guardianContact: '09333333333',
        expectedRowVersion: 0,
      })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body).toMatchObject({
      patientId: hstPatientId,
      guardianName: 'Confirmed Parent',
      guardianRelationship: 'Mother',
      guardianContact: '09333333333',
      rowVersion: 1,
    })

    const [audit] = await sql<{ userId: number; action: string }[]>`
      SELECT user_id AS "userId", action::text
      FROM audit_logs
      WHERE tenant_id = 'SVX' AND entity_id = ${hstPatientId} AND action = 'UPDATE'
      ORDER BY "timestamp" DESC LIMIT 1
    `
    expect(audit?.userId).toBeTruthy()
    expect(audit?.action).toBe('UPDATE')
  })
})
