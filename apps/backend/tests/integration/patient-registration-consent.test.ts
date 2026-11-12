import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { createPatient } from '../../src/modules/patients/db.js'
import { db } from '../../src/shared/db/index.js'
import { consents, patients, users } from '../../src/shared/db/schema.js'
import { withTenantTx } from '../../src/shared/db/withTenantTx.js'

const TENANT_ID = 'SVX'
let adminUserId = 0
let createdPatientId: string | null = null

beforeAll(async () => {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@surevax.com'))
    .limit(1)
  if (!admin) throw new Error('admin user not found: run pnpm setup first')
  adminUserId = admin.id
})

afterAll(async () => {
  if (!createdPatientId) return
  await withTenantTx({ tenantId: TENANT_ID, userId: adminUserId, branchId: null }, async (tx) => {
    const [patient] = await tx
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.tenantId, TENANT_ID), eq(patients.displayId, createdPatientId!)))
      .limit(1)
    if (!patient) return
    await tx.delete(consents).where(eq(consents.patientId, patient.id))
    await tx.delete(patients).where(eq(patients.id, patient.id))
  })
})

describe('direct patient registration consent', () => {
  it('commits the new patient and active patient-scoped consent together', async () => {
    const created = await createPatient({
      tenantId: TENANT_ID,
      createdById: adminUserId,
      branchId: null,
      firstName: 'ConsentFixture',
      lastName: `Patient${Date.now()}`,
      consentObtained: true,
      consentBy: 'Guardian',
    })
    createdPatientId = created.id

    const result = await withTenantTx(
      { tenantId: TENANT_ID, userId: adminUserId, branchId: null },
      async (tx) => {
        const [patient] = await tx
          .select({ id: patients.id })
          .from(patients)
          .where(and(eq(patients.tenantId, TENANT_ID), eq(patients.displayId, created.id)))
          .limit(1)
        if (!patient) throw new Error('created patient not found')
        const [consent] = await tx
          .select({
            scope: consents.scope,
            scopeRefType: consents.scopeRefType,
            scopeRefId: consents.scopeRefId,
            consenterRelation: consents.consenterRelation,
          })
          .from(consents)
          .where(
            and(
              eq(consents.tenantId, TENANT_ID),
              eq(consents.patientId, patient.id),
              isNull(consents.revokedAt),
              isNull(consents.deletedAt),
            ),
          )
          .limit(1)
        return { patient, consent }
      },
    )

    expect(result.patient).toBeDefined()
    expect(result.consent).toEqual({
      scope: 'patient',
      scopeRefType: null,
      scopeRefId: null,
      consenterRelation: 'Guardian',
    })
  })
})
