import { sql } from 'drizzle-orm'
import { db } from '../../shared/db/index.js'

// ---------------------------------------------------------------------------
// FHIR R4 projection view queries
// ---------------------------------------------------------------------------
// All queries run inside db.transaction() with tenant GUC set so RLS applies.
// Views (fhir_patient_view, fhir_encounter_view, fhir_immunization_view) filter
// deleted_at IS NULL; tenant isolation is enforced by the underlying table RLS.

// Canonical transaction type (matches transactions/db.ts pattern).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Sets tenant + user + branch GUCs (mirrors withTenantTx's three-GUC contract).
// userId/branchId are bigint internal — coerce to text for set_config (expects text).
// Null branchId → empty string (cross-branch read for the tenant); sets
// cross_branch_read=true so the branch_isolation RLS policy allows the query.
async function setGUCs(
  tx: Tx,
  tenantId: string,
  userId: number,
  branchId: number | null,
): Promise<void> {
  const branchStr = branchId === null ? '' : String(branchId)
  const crossBranch = branchId === null ? 'true' : 'false'
  await tx.execute(
    sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true),
               set_config('app.current_user_id', ${String(userId)}, true),
               set_config('app.current_branch_id', ${branchStr}, true),
               set_config('app.cross_branch_read', ${crossBranch}, true)`,
  )
}

async function getFhirResource(
  viewName: string,
  tenantId: string,
  userId: number,
  branchId: number | null,
  resourceId: string,
): Promise<Record<string, unknown> | null> {
  return db.transaction(async (tx: Tx) => {
    await setGUCs(tx, tenantId, userId, branchId)
    const rows = await tx.execute(
      sql`SELECT resource FROM ${sql.raw(viewName)} WHERE tenant_id = ${tenantId} AND id = ${resourceId} LIMIT 1`,
    )
    const row = rows[0] as Record<string, unknown> | undefined
    return row ? (row['resource'] as Record<string, unknown>) : null
  })
}

async function listFhirView(
  viewName: string,
  tenantId: string,
  userId: number,
  branchId: number | null,
  count: number,
  page: number,
): Promise<{ total: number; resources: Record<string, unknown>[] }> {
  const offset = (page - 1) * count
  return db.transaction(async (tx: Tx) => {
    await setGUCs(tx, tenantId, userId, branchId)
    const [totalRows, dataRows] = await Promise.all([
      tx.execute(
        sql`SELECT count(*)::int AS total FROM ${sql.raw(viewName)} WHERE tenant_id = ${tenantId}`,
      ),
      tx.execute(
        sql`SELECT resource FROM ${sql.raw(viewName)} WHERE tenant_id = ${tenantId} ORDER BY id LIMIT ${count} OFFSET ${offset}`,
      ),
    ])
    const totalRow = totalRows[0] as Record<string, unknown> | undefined
    const total = Number(totalRow?.['total'] ?? 0)
    const resources = (dataRows as Record<string, unknown>[]).map(
      (r) => r['resource'] as Record<string, unknown>,
    )
    return { total, resources }
  })
}

export async function getFhirPatient(
  tenantId: string,
  userId: number,
  branchId: number | null,
  patientId: string,
): Promise<Record<string, unknown> | null> {
  return getFhirResource('fhir_patient_view', tenantId, userId, branchId, patientId)
}

export async function listFhirPatients(
  tenantId: string,
  userId: number,
  branchId: number | null,
  count: number,
  page: number,
): Promise<{ total: number; resources: Record<string, unknown>[] }> {
  return listFhirView('fhir_patient_view', tenantId, userId, branchId, count, page)
}

export async function getFhirEncounter(
  tenantId: string,
  userId: number,
  branchId: number | null,
  encounterId: string,
): Promise<Record<string, unknown> | null> {
  return getFhirResource('fhir_encounter_view', tenantId, userId, branchId, encounterId)
}

export async function listFhirEncounters(
  tenantId: string,
  userId: number,
  branchId: number | null,
  count: number,
  page: number,
): Promise<{ total: number; resources: Record<string, unknown>[] }> {
  return listFhirView('fhir_encounter_view', tenantId, userId, branchId, count, page)
}

export async function getFhirImmunization(
  tenantId: string,
  userId: number,
  branchId: number | null,
  orderId: string,
): Promise<Record<string, unknown> | null> {
  return getFhirResource('fhir_immunization_view', tenantId, userId, branchId, orderId)
}

export async function listFhirImmunizations(
  tenantId: string,
  userId: number,
  branchId: number | null,
  count: number,
  page: number,
): Promise<{ total: number; resources: Record<string, unknown>[] }> {
  return listFhirView('fhir_immunization_view', tenantId, userId, branchId, count, page)
}
