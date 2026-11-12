import { beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  createEmergencyAccessRequest,
  createEmergencyGrant,
  executeEmergencyGrant,
} from '../src/tools/emergencyAccess.js'
import { db } from '../src/shared/db/index.js'
import {
  approvalDecisions,
  approvalRequests,
  branches,
  userRoles,
  users,
} from '../src/shared/db/schema.js'
import { withTenantTx } from '../src/shared/db/withTenantTx.js'
import { displayId } from '../src/shared/utils/displayId.js'

const TENANT_ID = 'SVX'
let targetDisplayId: string
let requesterDisplayId: string
let firstApproverId: number
let secondApproverId: number
let branchId: number

async function approvedGrantArgs(token: string, now = new Date()) {
  const incidentId = `INC-${now.getTime()}-${crypto.randomUUID()}`
  const request = await createEmergencyAccessRequest({
    tenantId: TENANT_ID,
    requesterUserDisplayId: requesterDisplayId,
    targetUserDisplayId: targetDisplayId,
    incidentId,
    now,
  })
  await withTenantTx({ tenantId: TENANT_ID, userId: firstApproverId, branchId }, async (tx) => {
    const [approval] = await tx
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(eq(approvalRequests.displayId, request.approvalRequestDisplayId))
      .limit(1)
    await tx.insert(approvalDecisions).values([
      {
        displayId: displayId('APD'),
        tenantId: TENANT_ID,
        approvalRequestId: approval!.id,
        decision: 'Approved',
        decidedById: firstApproverId,
      },
      {
        displayId: displayId('APD'),
        tenantId: TENANT_ID,
        approvalRequestId: approval!.id,
        decision: 'Approved',
        decidedById: secondApproverId,
      },
    ])
    await tx
      .update(approvalRequests)
      .set({ status: 'Approved', reviewedById: secondApproverId, reviewedAt: now })
      .where(eq(approvalRequests.id, approval!.id))
  })

  return {
    tenantId: TENANT_ID,
    targetUserDisplayId: targetDisplayId,
    incidentId,
    approvalRequestDisplayId: request.approvalRequestDisplayId,
    durationMinutes: 5,
    activationToken: token,
    now,
  }
}

describe('repository-native emergency account recovery', () => {
  beforeAll(async () => {
    const [target] = await db
      .select({ id: users.id, displayId: users.displayId })
      .from(users)
      .where(and(eq(users.tenantId, TENANT_ID), eq(users.email, 'admin@surevax.com')))
      .limit(1)
    targetDisplayId = target!.displayId
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(eq(branches.tenantId, TENANT_ID))
      .limit(1)
    branchId = branch!.id
    await withTenantTx({ tenantId: TENANT_ID, userId: target!.id, branchId }, async (tx) => {
      const fixtureUsers = await tx
        .insert(users)
        .values([
          {
            displayId: 'USR_EMGREQ01',
            tenantId: TENANT_ID,
            email: 'emergency-requester@example.test',
            passwordHash: 'test-only-disabled-password',
            firstName: 'Emergency',
            lastName: 'Requester',
            primaryBranchId: branchId,
          },
          {
            displayId: 'USR_EMGAPP01',
            tenantId: TENANT_ID,
            email: 'emergency-approver-one@example.test',
            passwordHash: 'test-only-disabled-password',
            firstName: 'Emergency',
            lastName: 'ApproverOne',
            primaryBranchId: branchId,
          },
          {
            displayId: 'USR_EMGAPP02',
            tenantId: TENANT_ID,
            email: 'emergency-approver-two@example.test',
            passwordHash: 'test-only-disabled-password',
            firstName: 'Emergency',
            lastName: 'ApproverTwo',
            primaryBranchId: branchId,
          },
        ])
        .returning({ id: users.id, displayId: users.displayId })
      requesterDisplayId = 'USR_EMGREQ01'
      firstApproverId = fixtureUsers.find((row) => row.displayId === 'USR_EMGAPP01')!.id
      secondApproverId = fixtureUsers.find((row) => row.displayId === 'USR_EMGAPP02')!.id
      await tx.insert(userRoles).values([
        { tenantId: TENANT_ID, userId: firstApproverId, role: 'TenantAdmin', branchId },
        { tenantId: TENANT_ID, userId: secondApproverId, role: 'TenantAdmin', branchId },
      ])
    })
  })

  it('rejects invented or unapproved authorization records', async () => {
    const token = `unauthorized-${crypto.randomUUID()}-${crypto.randomUUID()}`
    await expect(
      createEmergencyGrant({
        tenantId: TENANT_ID,
        targetUserDisplayId: targetDisplayId,
        incidentId: `INC-${crypto.randomUUID()}`,
        approvalRequestDisplayId: displayId('APR'),
        durationMinutes: 5,
        activationToken: token,
      }),
    ).rejects.toMatchObject({ code: 'APPROVAL_NOT_FOUND' })
  })

  it('rejects an approval after an approver role expires', async () => {
    const token = `expired-role-${crypto.randomUUID()}-${crypto.randomUUID()}`
    const args = await approvedGrantArgs(token)
    await withTenantTx({ tenantId: TENANT_ID, userId: secondApproverId, branchId }, (tx) =>
      tx
        .update(userRoles)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(and(eq(userRoles.userId, firstApproverId), eq(userRoles.role, 'TenantAdmin'))),
    )
    await expect(createEmergencyGrant(args)).rejects.toMatchObject({
      code: 'APPROVAL_NOT_AUTHORIZED',
    })
    await withTenantTx({ tenantId: TENANT_ID, userId: secondApproverId, branchId }, (tx) =>
      tx
        .update(userRoles)
        .set({ expiresAt: null })
        .where(and(eq(userRoles.userId, firstApproverId), eq(userRoles.role, 'TenantAdmin'))),
    )
  })

  it('consumes a tenant-bound grant once and rejects replay', async () => {
    const token = `valid-${crypto.randomUUID()}-${crypto.randomUUID()}`
    const grant = await createEmergencyGrant(await approvedGrantArgs(token))

    await expect(
      executeEmergencyGrant({
        tenantId: TENANT_ID,
        grantDisplayId: grant.grantDisplayId,
        activationToken: token,
      }),
    ).resolves.toMatchObject({ targetUserDisplayId: targetDisplayId })

    await expect(
      executeEmergencyGrant({
        tenantId: TENANT_ID,
        grantDisplayId: grant.grantDisplayId,
        activationToken: token,
      }),
    ).rejects.toMatchObject({ code: 'GRANT_REPLAYED' })
  })

  it('rejects an expired grant without changing the target account', async () => {
    const token = `expired-${crypto.randomUUID()}-${crypto.randomUUID()}`
    const createdAt = new Date(Date.now() - 10 * 60_000)
    const grant = await createEmergencyGrant(await approvedGrantArgs(token, createdAt))

    await expect(
      executeEmergencyGrant({
        tenantId: TENANT_ID,
        grantDisplayId: grant.grantDisplayId,
        activationToken: token,
      }),
    ).rejects.toMatchObject({ code: 'GRANT_EXPIRED' })
  })
})
