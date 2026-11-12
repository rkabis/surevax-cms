import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { and, eq } from 'drizzle-orm'
import { app } from '../src/app.js'
import { db } from '../src/shared/db/index.js'
import {
  approvalDecisions,
  approvalRequests,
  attachments,
  auditLogs,
  branches,
  dpaErasureExecutions,
  patients,
  userRoles,
  users,
} from '../src/shared/db/schema.js'
import { withTenantTx } from '../src/shared/db/withTenantTx.js'
import { displayId } from '../src/shared/utils/displayId.js'

const TENANT_ID = 'SVX'
const FETCH_HEADERS = { 'X-Requested-With': 'fetch', 'X-Tenant-Slug': TENANT_ID }

function cookieValue(setCookie: string[] | undefined, name: string): string {
  const row = setCookie?.find((value) => value.startsWith(`${name}=`))
  if (!row) throw new Error(`missing ${name} cookie`)
  return row.split(';')[0]!.slice(name.length + 1)
}

describe('DPA erasure authorization and execution', () => {
  let accessToken: string
  let adminUserId: number
  let secondUserId: number
  let thirdUserId: number
  let fourthUserId: number
  let branchId: number

  beforeAll(async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .set(FETCH_HEADERS)
      .send({ email: 'admin@surevax.com', password: 'TestPass123!' })
    expect(login.status).toBe(200)
    accessToken = cookieValue(login.headers['set-cookie'] as unknown as string[], 'access_token')

    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, TENANT_ID), eq(users.email, 'admin@surevax.com')))
      .limit(1)
    adminUserId = admin!.id
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.tenantId, TENANT_ID))
      .limit(1)
    branchId = branch!.id
    await withTenantTx({ tenantId: TENANT_ID, userId: adminUserId, branchId }, async (tx) => {
      const fixtureUsers = await tx
        .insert(users)
        .values([
          {
            displayId: 'USR_DPATST01',
            tenantId: TENANT_ID,
            email: 'dpa-approver@example.test',
            passwordHash: 'test-only-disabled-password',
            firstName: 'DPA',
            lastName: 'Approver',
            primaryBranchId: branchId,
          },
          {
            displayId: 'USR_DPATST02',
            tenantId: TENANT_ID,
            email: 'dpa-requester@example.test',
            passwordHash: 'test-only-disabled-password',
            firstName: 'DPA',
            lastName: 'Requester',
            primaryBranchId: branchId,
          },
          {
            displayId: 'USR_DPATST03',
            tenantId: TENANT_ID,
            email: 'dpa-non-admin@example.test',
            passwordHash: 'test-only-disabled-password',
            firstName: 'DPA',
            lastName: 'NonAdmin',
            primaryBranchId: branchId,
          },
        ])
        .returning({ id: users.id, displayId: users.displayId })
      secondUserId = fixtureUsers.find((row) => row.displayId === 'USR_DPATST01')!.id
      thirdUserId = fixtureUsers.find((row) => row.displayId === 'USR_DPATST02')!.id
      fourthUserId = fixtureUsers.find((row) => row.displayId === 'USR_DPATST03')!.id
      await tx.insert(userRoles).values({
        tenantId: TENANT_ID,
        userId: secondUserId,
        role: 'TenantAdmin',
        branchId,
      })
    })
  })

  it('rejects an unauthenticated purge request', async () => {
    const response = await request(app)
      .post('/api/admin/dpa/purge')
      .set(FETCH_HEADERS)
      .send({ patientDisplayId: displayId('PAT'), acknowledgeDryRun: true })
    expect(response.status).toBe(401)
    expect(response.body.code).toBe('AUTH_REQUIRED')
  })

  it('rejects a signed-in non-admin purge request', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .set(FETCH_HEADERS)
      .send({ email: 'branch-main@surevax.com', password: 'TestPass123!' })
    expect(login.status).toBe(200)
    const branchToken = cookieValue(
      login.headers['set-cookie'] as unknown as string[],
      'access_token',
    )

    const response = await request(app)
      .post('/api/admin/dpa/purge')
      .set('Cookie', `access_token=${branchToken}`)
      .set('X-Requested-With', 'fetch')
      .send({ patientDisplayId: displayId('PAT'), acknowledgeDryRun: true })
    expect(response.status).toBe(403)
    expect(response.body.code).toBe('FORBIDDEN')
  })

  it('rejects free-text retention evidence before it can enter audit storage', async () => {
    const response = await request(app)
      .post('/api/admin/dpa/erasure-requests')
      .set('Cookie', `access_token=${accessToken}`)
      .set('X-Requested-With', 'fetch')
      .send({
        patientDisplayId: displayId('PAT'),
        requestReference: 'DPA-NO-PHI-001',
        legalBasis: 'data_subject_request',
        retentionDecision: 'patient name and diagnosis must never be copied here',
        rollbackReference: 'BACKUP-NO-PHI-001',
        acknowledgeIrreversible: true,
        acknowledgeStatutoryDeletionIncomplete: true,
      })
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('INVALID_INPUT')
  })

  it('redacts structured approval details from audit API output', async () => {
    const patientDisplayId = displayId('PAT')
    const requestReference = `DPA-AUDIT-${Date.now()}`
    await withTenantTx({ tenantId: TENANT_ID, userId: adminUserId, branchId: null }, (tx) =>
      tx.insert(patients).values({
        displayId: patientDisplayId,
        tenantId: TENANT_ID,
        mrn: `MRN-${String(Date.now()).slice(-6)}`,
        homeBranchId: branchId,
        firstName: 'Audit',
        lastName: 'Redaction',
      }),
    )

    const created = await request(app)
      .post('/api/admin/dpa/erasure-requests')
      .set('Cookie', `access_token=${accessToken}`)
      .set('X-Requested-With', 'fetch')
      .send({
        patientDisplayId,
        requestReference,
        legalBasis: 'data_subject_request',
        retentionDecision: 'retain_required_records',
        rollbackReference: `BACKUP-AUDIT-${Date.now()}`,
        acknowledgeIrreversible: true,
        acknowledgeStatutoryDeletionIncomplete: true,
      })
    expect(created.status, JSON.stringify(created.body)).toBe(201)

    const [audit] = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, TENANT_ID),
          eq(auditLogs.entityType, 'approval_requests'),
          eq(auditLogs.entityId, created.body.approvalRequestId),
        ),
      )
      .limit(1)
    expect(audit).toBeDefined()

    const detail = await request(app)
      .get(`/api/admin/audit/${audit!.id}`)
      .set('Cookie', `access_token=${accessToken}`)
      .set('X-Requested-With', 'fetch')
    expect(detail.status).toBe(200)
    expect(JSON.stringify(detail.body.changes)).not.toContain(requestReference)
    expect(JSON.stringify(detail.body.changes)).not.toContain('retentionDecision')
  })

  it('enforces compliance approver identity and one-vote invariants in the database', async () => {
    const approvalDisplayId = displayId('APR')
    const approvalId = await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId },
      async (tx) => {
        const [approval] = await tx
          .insert(approvalRequests)
          .values({
            displayId: approvalDisplayId,
            tenantId: TENANT_ID,
            branchId,
            requestType: 'patient_erasure',
            description: 'DPA approval invariant fixture',
            status: 'Pending',
            entityType: 'patients',
            entityId: displayId('PAT'),
            requestedById: thirdUserId,
            expiresAt: new Date(Date.now() + 60_000),
            requiredApprovers: 2,
            approverRole: 'TenantAdmin',
          })
          .returning({ id: approvalRequests.id })
        return approval!.id
      },
    )

    await expect(
      withTenantTx({ tenantId: TENANT_ID, userId: thirdUserId, branchId }, (tx) =>
        tx.insert(approvalDecisions).values({
          displayId: displayId('APD'),
          tenantId: TENANT_ID,
          approvalRequestId: approvalId,
          decision: 'Approved',
          decidedById: thirdUserId,
        }),
      ),
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      withTenantTx({ tenantId: TENANT_ID, userId: fourthUserId, branchId }, (tx) =>
        tx.insert(approvalDecisions).values({
          displayId: displayId('APD'),
          tenantId: TENANT_ID,
          approvalRequestId: approvalId,
          decision: 'Approved',
          decidedById: fourthUserId,
        }),
      ),
    ).rejects.toMatchObject({ code: '23514' })

    await withTenantTx({ tenantId: TENANT_ID, userId: adminUserId, branchId }, (tx) =>
      tx
        .update(userRoles)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(and(eq(userRoles.userId, secondUserId), eq(userRoles.role, 'TenantAdmin'))),
    )
    await expect(
      withTenantTx({ tenantId: TENANT_ID, userId: secondUserId, branchId }, (tx) =>
        tx.insert(approvalDecisions).values({
          displayId: displayId('APD'),
          tenantId: TENANT_ID,
          approvalRequestId: approvalId,
          decision: 'Approved',
          decidedById: secondUserId,
        }),
      ),
    ).rejects.toMatchObject({ code: '23514' })
    await withTenantTx({ tenantId: TENANT_ID, userId: adminUserId, branchId }, (tx) =>
      tx
        .update(userRoles)
        .set({ expiresAt: null })
        .where(and(eq(userRoles.userId, secondUserId), eq(userRoles.role, 'TenantAdmin'))),
    )

    await withTenantTx({ tenantId: TENANT_ID, userId: adminUserId, branchId }, (tx) =>
      tx.insert(approvalDecisions).values({
        displayId: displayId('APD'),
        tenantId: TENANT_ID,
        approvalRequestId: approvalId,
        decision: 'Approved',
        decidedById: adminUserId,
      }),
    )
    await expect(
      withTenantTx({ tenantId: TENANT_ID, userId: adminUserId, branchId }, (tx) =>
        tx.insert(approvalDecisions).values({
          displayId: displayId('APD'),
          tenantId: TENANT_ID,
          approvalRequestId: approvalId,
          decision: 'Approved',
          decidedById: adminUserId,
        }),
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('executes an approved request once, reports incomplete statutory deletion, and rejects replay', async () => {
    const patientDisplayId = displayId('PAT')
    const approvalDisplayId = displayId('APR')
    const approvalId = await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: null },
      async (tx) => {
        await tx.insert(patients).values({
          displayId: patientDisplayId,
          tenantId: TENANT_ID,
          mrn: `MRN-${String(Date.now()).slice(-6)}`,
          homeBranchId: branchId,
          firstName: 'Erasure',
          lastName: 'Fixture',
        })
        const [approval] = await tx
          .insert(approvalRequests)
          .values({
            displayId: approvalDisplayId,
            tenantId: TENANT_ID,
            branchId,
            requestType: 'patient_erasure',
            description: 'DPA test fixture',
            details: JSON.stringify({
              requestReference: 'DPA-TEST-001',
              rollbackReference: 'BACKUP-TEST-001',
            }),
            status: 'Approved',
            entityType: 'patients',
            entityId: patientDisplayId,
            requestedById: thirdUserId,
            expiresAt: new Date(Date.now() + 60_000),
            requiredApprovers: 2,
            approverRole: 'TenantAdmin',
          })
          .returning({ id: approvalRequests.id })
        await tx.insert(approvalDecisions).values([
          {
            displayId: displayId('APD'),
            tenantId: TENANT_ID,
            approvalRequestId: approval!.id,
            decision: 'Approved',
            decidedById: adminUserId,
          },
          {
            displayId: displayId('APD'),
            tenantId: TENANT_ID,
            approvalRequestId: approval!.id,
            decision: 'Approved',
            decidedById: secondUserId,
          },
        ])
        return approval!.id
      },
    )

    await withTenantTx({ tenantId: TENANT_ID, userId: adminUserId, branchId }, (tx) =>
      tx
        .update(userRoles)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(and(eq(userRoles.userId, secondUserId), eq(userRoles.role, 'TenantAdmin'))),
    )
    const expiredApprover = await request(app)
      .post(`/api/admin/dpa/erasure-requests/${approvalDisplayId}/execute`)
      .set('Cookie', `access_token=${accessToken}`)
      .set('X-Requested-With', 'fetch')
      .send({
        patientDisplayId,
        confirmation: 'DEIDENTIFY PRIMARY STORE',
        acknowledgeStatutoryDeletionIncomplete: true,
      })
    expect(expiredApprover.status).toBe(403)
    expect(expiredApprover.body.code).toBe('APPROVAL_REQUIRED')
    await withTenantTx({ tenantId: TENANT_ID, userId: adminUserId, branchId }, (tx) =>
      tx
        .update(userRoles)
        .set({ expiresAt: null })
        .where(and(eq(userRoles.userId, secondUserId), eq(userRoles.role, 'TenantAdmin'))),
    )

    const execute = await request(app)
      .post(`/api/admin/dpa/erasure-requests/${approvalDisplayId}/execute`)
      .set('Cookie', `access_token=${accessToken}`)
      .set('X-Requested-With', 'fetch')
      .send({
        patientDisplayId,
        confirmation: 'DEIDENTIFY PRIMARY STORE',
        acknowledgeStatutoryDeletionIncomplete: true,
      })
    expect(execute.status, JSON.stringify(execute.body)).toBe(200)
    expect(execute.body.statutoryDeletionComplete).toBe(false)
    expect(execute.body.completion.primaryStoreDeidentified).toBe(true)

    const [patient] = await db
      .select({
        firstName: patients.firstName,
        email: patients.email,
        deletedAt: patients.deletedAt,
      })
      .from(patients)
      .where(eq(patients.displayId, patientDisplayId))
    expect(patient?.firstName).toBe('Erased')
    expect(patient?.email).toBeNull()
    expect(patient?.deletedAt).toBeInstanceOf(Date)

    const [evidence] = await db
      .select({ id: dpaErasureExecutions.id })
      .from(dpaErasureExecutions)
      .where(eq(dpaErasureExecutions.approvalRequestId, approvalId))
    expect(evidence).toBeDefined()

    const replay = await request(app)
      .post(`/api/admin/dpa/erasure-requests/${approvalDisplayId}/execute`)
      .set('Cookie', `access_token=${accessToken}`)
      .set('X-Requested-With', 'fetch')
      .send({
        patientDisplayId,
        confirmation: 'DEIDENTIFY PRIMARY STORE',
        acknowledgeStatutoryDeletionIncomplete: true,
      })
    expect(replay.status).toBe(409)
    expect(replay.body.code).toBe('ALREADY_EXECUTED')
  })

  it('rejects an expired approval before touching patient data', async () => {
    const patientDisplayId = displayId('PAT')
    const approvalDisplayId = displayId('APR')
    await withTenantTx({ tenantId: TENANT_ID, userId: adminUserId, branchId: null }, async (tx) => {
      await tx.insert(patients).values({
        displayId: patientDisplayId,
        tenantId: TENANT_ID,
        mrn: `MRN-${String(Date.now() + 1).slice(-6)}`,
        homeBranchId: branchId,
        firstName: 'Still',
        lastName: 'Present',
      })
      await tx.insert(approvalRequests).values({
        displayId: approvalDisplayId,
        tenantId: TENANT_ID,
        branchId,
        requestType: 'patient_erasure',
        description: 'Expired DPA test fixture',
        details: JSON.stringify({
          requestReference: 'DPA-TEST-EXPIRED',
          rollbackReference: 'BACKUP-TEST-EXPIRED',
        }),
        status: 'Approved',
        entityType: 'patients',
        entityId: patientDisplayId,
        requestedById: secondUserId,
        expiresAt: new Date(Date.now() - 1),
        requiredApprovers: 2,
        approverRole: 'TenantAdmin',
      })
    })

    const response = await request(app)
      .post(`/api/admin/dpa/erasure-requests/${approvalDisplayId}/execute`)
      .set('Cookie', `access_token=${accessToken}`)
      .set('X-Requested-With', 'fetch')
      .send({
        patientDisplayId,
        confirmation: 'DEIDENTIFY PRIMARY STORE',
        acknowledgeStatutoryDeletionIncomplete: true,
      })
    expect(response.status).toBe(410)
    expect(response.body.code).toBe('APPROVAL_EXPIRED')

    const [patient] = await db
      .select({ firstName: patients.firstName, deletedAt: patients.deletedAt })
      .from(patients)
      .where(eq(patients.displayId, patientDisplayId))
    expect(patient).toMatchObject({ firstName: 'Still', deletedAt: null })
  })

  it('blocks execution when soft-deleted attachment metadata still identifies an object', async () => {
    const patientDisplayId = displayId('PAT')
    const approvalDisplayId = displayId('APR')
    await withTenantTx({ tenantId: TENANT_ID, userId: adminUserId, branchId: null }, async (tx) => {
      await tx.insert(patients).values({
        displayId: patientDisplayId,
        tenantId: TENANT_ID,
        mrn: `MRN-${String(Date.now() + 2).slice(-6)}`,
        homeBranchId: branchId,
        firstName: 'Attachment',
        lastName: 'Pending',
      })
      await tx.insert(attachments).values({
        displayId: displayId('ATT'),
        tenantId: TENANT_ID,
        ownerType: 'patient',
        ownerId: patientDisplayId,
        fileName: 'synthetic.txt',
        contentType: 'text/plain',
        sizeBytes: 9,
        storageBackend: 'r2',
        storageKey: `synthetic/${crypto.randomUUID()}`,
        contentHashSha256: 'a'.repeat(64),
        deletedAt: new Date(),
      })
      const [approval] = await tx
        .insert(approvalRequests)
        .values({
          displayId: approvalDisplayId,
          tenantId: TENANT_ID,
          branchId,
          requestType: 'patient_erasure',
          description: 'DPA attachment reconciliation fixture',
          details: JSON.stringify({
            requestReference: 'DPA-ATTACHMENT-001',
            rollbackReference: 'BACKUP-ATTACHMENT-001',
          }),
          status: 'Approved',
          entityType: 'patients',
          entityId: patientDisplayId,
          requestedById: thirdUserId,
          expiresAt: new Date(Date.now() + 60_000),
          requiredApprovers: 2,
          approverRole: 'TenantAdmin',
        })
        .returning({ id: approvalRequests.id })
      await tx.insert(approvalDecisions).values([
        {
          displayId: displayId('APD'),
          tenantId: TENANT_ID,
          approvalRequestId: approval!.id,
          decision: 'Approved',
          decidedById: adminUserId,
        },
        {
          displayId: displayId('APD'),
          tenantId: TENANT_ID,
          approvalRequestId: approval!.id,
          decision: 'Approved',
          decidedById: secondUserId,
        },
      ])
    })

    const response = await request(app)
      .post(`/api/admin/dpa/erasure-requests/${approvalDisplayId}/execute`)
      .set('Cookie', `access_token=${accessToken}`)
      .set('X-Requested-With', 'fetch')
      .send({
        patientDisplayId,
        confirmation: 'DEIDENTIFY PRIMARY STORE',
        acknowledgeStatutoryDeletionIncomplete: true,
      })
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('EXTERNAL_OBJECTS_PENDING')

    const [patient] = await db
      .select({ firstName: patients.firstName, deletedAt: patients.deletedAt })
      .from(patients)
      .where(eq(patients.displayId, patientDisplayId))
    expect(patient).toMatchObject({ firstName: 'Attachment', deletedAt: null })
  })
})
