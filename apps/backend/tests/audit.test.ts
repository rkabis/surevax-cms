/**
 * Integration tests for the admin audit-log surface.
 *
 * Two-tier IDs (2026-05-19 ID redesign):
 *   - `audit_logs.id` is bigserial — detail URLs use the integer id as a
 *     string; INVALID_ID is returned for non-integer params.
 *   - `audit_logs.entity_id` stores the audited row's display_id (text).
 *   - `withTenantTx({ tenantId, userId, branchId })` takes user/branch as
 *     bigints; we resolve the seeded admin user's bigint at suite startup.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { app } from '../src/app.js'
import { db } from '../src/shared/db/index.js'
import { auditLogs, users } from '../src/shared/db/schema.js'
import { withTenantTx } from '../src/shared/db/withTenantTx.js'

const TENANT_ID = 'SVX'
// Pre-login requests resolve the tenant via X-Tenant-Slug. JWT-authenticated
// requests ignore the slug header (JWT claim wins), so sending it on every
// request is safe.
const FETCH_HEADER = {
  'X-Requested-With': 'fetch' as const,
  'X-Tenant-Slug': 'SVX' as const,
}

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined
  const match = setCookie.find((c) => c.startsWith(`${name}=`))
  if (!match) return undefined
  return match.split(';')[0]?.slice(`${name}=`.length)
}

async function loginAsAdmin(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .set(FETCH_HEADER)
    .send({ email: 'admin@surevax.com', password: 'TestPass123!' })
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  const cookie = findCookie(res.headers['set-cookie'] as unknown as string[], 'access_token')
  if (!cookie) throw new Error('login response did not set access_token')
  return cookie
}

async function resolveAdminUserId(): Promise<number> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@surevax.com'))
    .limit(1)
  if (!row) throw new Error('seeded admin user not found')
  return row.id
}

describe('Audit Router', () => {
  let accessToken: string
  let adminUserId: number

  beforeAll(async () => {
    accessToken = await loginAsAdmin()
    adminUserId = await resolveAdminUserId()
  })

  describe('GET /api/admin/audit', () => {
    it('returns a list of audit logs', async () => {
      const res = await request(app)
        .get('/api/admin/audit')
        .set('Cookie', `access_token=${accessToken}`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data.length).toBeGreaterThan(0)
      expect(res.body.data[0]).toHaveProperty('id')
      expect(res.body.data[0]).toHaveProperty('action')
    })

    it('filters audit logs by action', async () => {
      const res = await request(app)
        .get('/api/admin/audit?action=LOGIN')
        .set('Cookie', `access_token=${accessToken}`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      for (const log of res.body.data) {
        expect(log.action).toBe('LOGIN')
      }
    })

    it('filters audit logs by user name (q param)', async () => {
      const res = await request(app)
        .get('/api/admin/audit?q=Admin')
        .set('Cookie', `access_token=${accessToken}`)

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.data)).toBe(true)
      // Seed creates an Admin user (`admin@surevax.com`, first name "Admin").
      if (res.body.data.length > 0) {
        expect(res.body.data[0].userName).toContain('Admin')
      }
    })
  })

  describe('GET /api/admin/audit/:id', () => {
    it('fetches a single audit log by ID', async () => {
      const listRes = await request(app)
        .get('/api/admin/audit')
        .set('Cookie', `access_token=${accessToken}`)

      const logId = listRes.body.data[0].id
      expect(logId).toMatch(/^\d+$/)

      const res = await request(app)
        .get(`/api/admin/audit/${logId}`)
        .set('Cookie', `access_token=${accessToken}`)

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('id', logId)
      expect(res.body).toHaveProperty('action')
      expect(res.body).toHaveProperty('changes')
    })

    it('returns 400 for an invalid ID format', async () => {
      const res = await request(app)
        .get('/api/admin/audit/not-a-number')
        .set('Cookie', `access_token=${accessToken}`)

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('INVALID_ID')
    })

    it('returns 404 for a non-existent valid ID', async () => {
      const res = await request(app)
        .get('/api/admin/audit/999999999')
        .set('Cookie', `access_token=${accessToken}`)

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('NOT_FOUND')
    })

    it('redacts sensitive keys in the changes payload', async () => {
      // Insert a dummy audit row with sensitive data. audit_logs.id is
      // bigserial so we let the DB allocate; the audit trigger requires
      // app.current_tenant_id to be set (withTenantTx handles that).
      const inserted = await withTenantTx(
        { tenantId: TENANT_ID, userId: adminUserId, branchId: null },
        async (tx) => {
          const rows = await tx
            .insert(auditLogs)
            .values({
              tenantId: TENANT_ID,
              action: 'UPDATE',
              entityType: 'patients',
              entityId: 'PAT_TESTREDACT',
              timestamp: new Date(),
              changes: JSON.stringify({
                description: 'Updated patient',
                password_hash: 'secret123',
                email: 'test@example.com',
                contact_number: '1234567890',
                normal_field: 'safe_value',
              }),
            })
            .returning({ id: auditLogs.id })
          return rows[0]
        },
      )
      expect(inserted).toBeDefined()

      const res = await request(app)
        .get(`/api/admin/audit/${inserted!.id}`)
        .set('Cookie', `access_token=${accessToken}`)

      expect(res.status).toBe(200)

      const changes = res.body.changes
      expect(changes.password_hash).toBe('[REDACTED]')
      expect(changes.email).toBe('[REDACTED]')
      expect(changes.contact_number).toBe('[REDACTED]')
      expect(changes.normal_field).toBe('safe_value')
      expect(changes.description).toBe('Updated patient')
    })
  })
})
