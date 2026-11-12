import { PassThrough } from 'node:stream'
import { sql, and, eq, isNull, asc } from 'drizzle-orm'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { patients, patientAllergies, patientConditions, tenants } from '../../shared/db/schema.js'
import { buildHealthCardPdf, type HealthCardPatient } from './pdf.js'
import { getUploader } from '../../shared/storage/index.js'
import { logger } from '../../shared/utils/logger.js'

export type HealthCardResult =
  | { found: false }
  | {
      found: true
      fileName: string
      pdfStream: PassThrough
    }

/**
 * Generate a patient health-card PDF.
 * Fetches patient PHI inside a tenant-scoped transaction, builds the PDF,
 * optionally uploads to cloud storage (stub returns null today), and returns a
 * PassThrough stream ready to pipe to the HTTP response.
 */
export async function generateHealthCard(opts: {
  patientDisplayId: string
  tenantId: string
  userId: number
  branchId: number | null
}): Promise<HealthCardResult> {
  const { patientDisplayId, tenantId, userId, branchId } = opts

  // ── 1. Fetch patient + relations inside a tenant-scoped tx (audit GUC set) ─
  type PatientRow = {
    id: number
    displayId: string
    mrn: string
    firstName: string
    lastName: string
    middleName: string | null
    dateOfBirth: string | null
    sex: string | null
    contactNumber: string | null
    address: string | null
    province: string | null
    city: string | null
    barangay: string | null
    guardianName: string | null
    guardianRelationship: string | null
    guardianContact: string | null
    tenantId: string
  }

  const result = await withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [row] = await tx
      .select({
        id: patients.id,
        displayId: patients.displayId,
        mrn: patients.mrn,
        firstName: patients.firstName,
        lastName: patients.lastName,
        middleName: patients.middleName,
        dateOfBirth: patients.dateOfBirth,
        sex: patients.sex,
        contactNumber: patients.contactNumber,
        address: patients.address,
        province: patients.province,
        city: patients.city,
        barangay: patients.barangay,
        guardianName: patients.guardianName,
        guardianRelationship: patients.guardianRelationship,
        guardianContact: patients.guardianContact,
        tenantId: patients.tenantId,
      })
      .from(patients)
      .where(
        and(
          eq(patients.tenantId, tenantId),
          eq(patients.displayId, patientDisplayId),
          isNull(patients.deletedAt),
        ),
      )
      .limit(1)

    if (!row) return null

    const internalId = row.id

    const [allergyRows, conditionRows, tenantRow] = await Promise.all([
      tx
        .select({
          allergen: patientAllergies.allergen,
          severity: patientAllergies.severity,
          reaction: patientAllergies.reaction,
        })
        .from(patientAllergies)
        .where(
          and(
            eq(patientAllergies.patientId, internalId),
            eq(patientAllergies.tenantId, tenantId),
            isNull(patientAllergies.deletedAt),
          ),
        )
        .orderBy(asc(patientAllergies.allergen))
        .limit(5),

      tx
        .select({
          conditionName: patientConditions.conditionName,
          icd10Code: patientConditions.icd10Code,
          status: patientConditions.status,
        })
        .from(patientConditions)
        .where(
          and(
            eq(patientConditions.patientId, internalId),
            eq(patientConditions.tenantId, tenantId),
            isNull(patientConditions.deletedAt),
          ),
        )
        .orderBy(asc(patientConditions.conditionName))
        .limit(5),

      tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    ])

    return { row: row as PatientRow, allergyRows, conditionRows, tenantRow }
  })

  if (!result) return { found: false }

  const { row, allergyRows, conditionRows, tenantRow } = result
  const tenantName = tenantRow[0]?.name ?? 'SureVax Clinic'

  // ── 2. Build PDF ─────────────────────────────────────────────────────────
  const patientData: HealthCardPatient = {
    displayId: row.displayId,
    mrn: row.mrn,
    firstName: row.firstName,
    lastName: row.lastName,
    middleName: row.middleName,
    dateOfBirth: row.dateOfBirth,
    sex: row.sex,
    contactNumber: row.contactNumber,
    address: row.address,
    province: row.province,
    city: row.city,
    barangay: row.barangay,
    guardianName: row.guardianName,
    guardianRelationship: row.guardianRelationship,
    guardianContact: row.guardianContact,
    allergies: allergyRows,
    conditions: conditionRows,
  }

  const fileName = `health-card-${row.mrn ?? row.displayId}.pdf`
  const pdfStream = buildHealthCardPdf(patientData, { tenantName, generatedAt: new Date() })

  // ── 3. Optionally upload to cloud storage (stub returns null today) ────────
  // We need to fork the stream: one copy goes to HTTP response, one to cloud.
  // Use a second PassThrough as the cloud branch.
  const responseStream = new PassThrough()
  const uploaderStream = new PassThrough()

  pdfStream.on('data', (chunk: Buffer) => {
    responseStream.push(chunk)
    uploaderStream.push(chunk)
  })
  pdfStream.on('end', () => {
    responseStream.push(null)
    uploaderStream.push(null)
  })
  pdfStream.on('error', (err) => {
    responseStream.destroy(err)
    uploaderStream.destroy(err)
  })

  // Fire-and-forget cloud upload — don't block the HTTP response
  void (async () => {
    try {
      const uploader = getUploader()
      const attachmentId = await uploader.uploadPatientHealthCard({
        tenantId,
        patientDisplayId: row.displayId,
        pdfStream: uploaderStream,
        fileName,
      })

      // If the uploader returned an attachment id, persist it on the patient row
      if (attachmentId != null) {
        await withTenantTx({ tenantId, userId, branchId }, async (tx) => {
          await tx.execute(
            sql`UPDATE patients
                   SET health_card_attachment_id = ${attachmentId},
                       updated_at = now()
                 WHERE tenant_id = ${tenantId}
                   AND display_id = ${patientDisplayId}
                   AND deleted_at IS NULL`,
          )
        })
      }
    } catch (err) {
      logger.warn(
        { err, patientDisplayId, tenantId },
        'health-card cloud upload failed (non-fatal)',
      )
    }
  })()

  return { found: true, fileName, pdfStream: responseStream }
}
