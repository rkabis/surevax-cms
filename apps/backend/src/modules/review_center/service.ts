import { sql } from 'drizzle-orm'
import type {
  ReviewCenterGuardianUpdate,
  ReviewCenterGuardianUpdateResponse,
  ReviewCenterResponse,
} from '@surevax/shared'
import { withTenantTx, type Tx } from '../../shared/db/withTenantTx.js'

const ROW_LIMIT = 200

type ReviewContext = {
  tenantId: string
  branchId: number
  userId: number
}

type GuardianRow = ReviewCenterResponse['missingGuardians']['rows'][number]
type StaleEncounterRow =
  ReviewCenterResponse['yesterdayLooseEnds']['staleOpenEncounters']['rows'][number]
type UnsettledTransactionRow =
  ReviewCenterResponse['yesterdayLooseEnds']['unsettledTransactions']['rows'][number]
type OpenDrawerRow = ReviewCenterResponse['yesterdayLooseEnds']['openPriorDrawers']['rows'][number]
type UndocumentedAdministrationRow =
  ReviewCenterResponse['yesterdayLooseEnds']['undocumentedAdministrations']['rows'][number]
type PotentialDuplicateRow = ReviewCenterResponse['potentialDuplicates']['rows'][number]
type ExternalImmunizationReviewRow = ReviewCenterResponse['externalImmunizations']['rows'][number]

function asCount(value: string | number | undefined): number {
  return Number(value ?? 0)
}

async function getMissingGuardians(
  tx: Tx,
  opts: ReviewContext & { date: string; q?: string },
): Promise<ReviewCenterResponse['missingGuardians']> {
  const searchPattern = opts.q ? `%${opts.q}%` : null
  const filter = sql`
    p.tenant_id = ${opts.tenantId}
    AND p.home_branch_id = ${opts.branchId}
    AND p.date_of_birth IS NOT NULL
    AND p.date_of_birth > (${opts.date}::date - INTERVAL '18 years')
    AND (
      NULLIF(BTRIM(p.guardian_name), '') IS NULL
      OR NULLIF(BTRIM(p.guardian_relationship), '') IS NULL
      OR NULLIF(BTRIM(p.guardian_contact), '') IS NULL
    )
    AND p.is_active = true
    AND p.deleted_at IS NULL
    AND p.merged_into_id IS NULL
    AND (
      ${searchPattern}::text IS NULL
      OR CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name) ILIKE ${searchPattern}
      OR p.mrn ILIKE ${searchPattern}
      OR p.display_id ILIKE ${searchPattern}
    )
  `

  const [countRow] = await tx.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM patients p
    WHERE ${filter}
  `)

  const rows = await tx.execute<{
    patientId: string
    mrn: string
    patientName: string
    dateOfBirth: string
    age: string
    contactNumber: string | null
    guardianName: string | null
    guardianRelationship: string | null
    guardianContact: string | null
    rowVersion: number
  }>(sql`
    SELECT
      p.display_id AS "patientId",
      p.mrn,
      TRIM(CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name)) AS "patientName",
      p.date_of_birth::text AS "dateOfBirth",
      EXTRACT(YEAR FROM AGE(${opts.date}::date, p.date_of_birth))::int::text AS age,
      p.contact_number AS "contactNumber",
      p.guardian_name AS "guardianName",
      p.guardian_relationship AS "guardianRelationship",
      p.guardian_contact AS "guardianContact",
      p.row_version AS "rowVersion"
    FROM patients p
    WHERE ${filter}
    ORDER BY p.date_of_birth DESC, p.last_name, p.first_name
    LIMIT ${ROW_LIMIT}
  `)

  return {
    count: asCount(countRow?.count),
    rows: rows.map((row) => ({ ...row, age: asCount(row.age) }) satisfies GuardianRow),
  }
}

async function getStaleOpenEncounters(
  tx: Tx,
  opts: ReviewContext & { date: string },
): Promise<ReviewCenterResponse['yesterdayLooseEnds']['staleOpenEncounters']> {
  const [countRow] = await tx.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM encounters e
    WHERE e.tenant_id = ${opts.tenantId}
      AND e.branch_id = ${opts.branchId}
      AND e.status IN ('Open', 'InProgress')
      AND (e.started_at AT TIME ZONE 'Asia/Manila')::date < ${opts.date}::date
      AND e.deleted_at IS NULL
  `)
  const rows = await tx.execute<StaleEncounterRow>(sql`
    SELECT
      e.display_id AS "encounterId",
      p.display_id AS "patientId",
      TRIM(CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name)) AS "patientName",
      e.specialty,
      e.status,
      e.started_at AS "startedAt"
    FROM encounters e
    JOIN patients p ON p.id = e.patient_id AND p.tenant_id = ${opts.tenantId}
    WHERE e.tenant_id = ${opts.tenantId}
      AND e.branch_id = ${opts.branchId}
      AND e.status IN ('Open', 'InProgress')
      AND (e.started_at AT TIME ZONE 'Asia/Manila')::date < ${opts.date}::date
      AND e.deleted_at IS NULL
    ORDER BY e.started_at ASC
    LIMIT ${ROW_LIMIT}
  `)
  return { count: asCount(countRow?.count), rows }
}

async function getUnsettledTransactions(
  tx: Tx,
  opts: ReviewContext & { date: string },
): Promise<ReviewCenterResponse['yesterdayLooseEnds']['unsettledTransactions']> {
  const [summary] = await tx.execute<{ count: string; totalOutstanding: string }>(sql`
    SELECT
      COUNT(*)::text AS count,
      COALESCE(SUM(t.amount_outstanding), 0)::numeric(12,2)::text AS "totalOutstanding"
    FROM transactions t
    WHERE t.tenant_id = ${opts.tenantId}
      AND t.branch_id = ${opts.branchId}
      AND t.status IN ('Pending', 'Paid')
      AND t.amount_outstanding > 0
      AND t.is_prepayment = false
      AND (t.created_at AT TIME ZONE 'Asia/Manila')::date < ${opts.date}::date
      AND t.deleted_at IS NULL
  `)
  const rows = await tx.execute<UnsettledTransactionRow>(sql`
    SELECT
      t.display_id AS "transactionId",
      p.display_id AS "patientId",
      TRIM(CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name)) AS "patientName",
      t.status,
      t.amount_outstanding::numeric(12,2)::text AS "outstandingAmount",
      t.created_at AS "createdAt"
    FROM transactions t
    JOIN patients p ON p.id = t.patient_id AND p.tenant_id = ${opts.tenantId}
    WHERE t.tenant_id = ${opts.tenantId}
      AND t.branch_id = ${opts.branchId}
      AND t.status IN ('Pending', 'Paid')
      AND t.amount_outstanding > 0
      AND t.is_prepayment = false
      AND (t.created_at AT TIME ZONE 'Asia/Manila')::date < ${opts.date}::date
      AND t.deleted_at IS NULL
    ORDER BY t.created_at ASC
    LIMIT ${ROW_LIMIT}
  `)
  return {
    count: asCount(summary?.count),
    totalOutstanding: summary?.totalOutstanding ?? '0.00',
    rows,
  }
}

async function getOpenPriorDrawers(
  tx: Tx,
  opts: ReviewContext & { date: string },
): Promise<ReviewCenterResponse['yesterdayLooseEnds']['openPriorDrawers']> {
  const [countRow] = await tx.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM cash_drawer_sessions cds
    WHERE cds.tenant_id = ${opts.tenantId}
      AND cds.branch_id = ${opts.branchId}
      AND cds.state = 'Open'
      AND (cds.opened_at AT TIME ZONE 'Asia/Manila')::date < ${opts.date}::date
  `)
  const rows = await tx.execute<OpenDrawerRow>(sql`
    SELECT
      cds.display_id AS "sessionId",
      cds.opened_at AS "openedAt",
      CASE WHEN u.first_name IS NOT NULL OR u.last_name IS NOT NULL
        THEN TRIM(CONCAT_WS(' ', u.first_name, u.last_name))
        ELSE NULL
      END AS "userName",
      cds.opening_float::numeric(12,2)::text AS "openingFloat"
    FROM cash_drawer_sessions cds
    LEFT JOIN users u ON u.id = cds.user_id AND u.tenant_id = ${opts.tenantId}
    WHERE cds.tenant_id = ${opts.tenantId}
      AND cds.branch_id = ${opts.branchId}
      AND cds.state = 'Open'
      AND (cds.opened_at AT TIME ZONE 'Asia/Manila')::date < ${opts.date}::date
    ORDER BY cds.opened_at ASC
    LIMIT ${ROW_LIMIT}
  `)
  return { count: asCount(countRow?.count), rows }
}

async function getUndocumentedAdministrations(
  tx: Tx,
  opts: ReviewContext & { date: string },
): Promise<ReviewCenterResponse['yesterdayLooseEnds']['undocumentedAdministrations']> {
  const [countRow] = await tx.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM clinical_orders co
    JOIN encounters e ON e.id = co.encounter_id AND e.tenant_id = ${opts.tenantId}
    WHERE co.tenant_id = ${opts.tenantId}
      AND e.branch_id = ${opts.branchId}
      AND co.status = 'Completed'
      AND co.completed_at IS NOT NULL
      AND (co.completed_at AT TIME ZONE 'Asia/Manila')::date < ${opts.date}::date
      AND co.documented_by_id IS NULL
      AND co.deleted_at IS NULL
  `)
  const rows = await tx.execute<UndocumentedAdministrationRow>(sql`
    SELECT
      co.display_id AS "orderId",
      e.display_id AS "encounterId",
      p.display_id AS "patientId",
      TRIM(CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name)) AS "patientName",
      sc.name AS "serviceName",
      co.completed_at AS "completedAt"
    FROM clinical_orders co
    JOIN encounters e ON e.id = co.encounter_id AND e.tenant_id = ${opts.tenantId}
    JOIN patients p ON p.id = co.patient_id AND p.tenant_id = ${opts.tenantId}
    JOIN service_catalog sc ON sc.id = co.service_id AND sc.tenant_id = ${opts.tenantId}
    WHERE co.tenant_id = ${opts.tenantId}
      AND e.branch_id = ${opts.branchId}
      AND co.status = 'Completed'
      AND co.completed_at IS NOT NULL
      AND (co.completed_at AT TIME ZONE 'Asia/Manila')::date < ${opts.date}::date
      AND co.documented_by_id IS NULL
      AND co.deleted_at IS NULL
    ORDER BY co.completed_at ASC
    LIMIT ${ROW_LIMIT}
  `)
  return { count: asCount(countRow?.count), rows }
}

async function getPotentialDuplicates(
  tx: Tx,
  opts: ReviewContext & { q?: string },
): Promise<ReviewCenterResponse['potentialDuplicates']> {
  const searchPattern = opts.q ? `%${opts.q}%` : null
  const filter = sql`
    p.tenant_id = ${opts.tenantId}
    AND (p.home_branch_id = ${opts.branchId} OR p.home_branch_id IS NULL)
    AND p.is_active = true
    AND p.deleted_at IS NULL
    AND p.merged_into_id IS NULL
    AND td.tenant_id = ${opts.tenantId}
    AND td.tag = 'POTENTIAL_DUPLICATE'
    AND td.is_active = true
    AND (
      ${searchPattern}::text IS NULL
      OR CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name) ILIKE ${searchPattern}
      OR p.mrn ILIKE ${searchPattern}
      OR p.display_id ILIKE ${searchPattern}
    )
  `

  const [countRow] = await tx.execute<{ count: string }>(sql`
    SELECT COUNT(DISTINCT p.id)::text AS count
    FROM patient_tags pt
    JOIN patients p ON p.id = pt.patient_id AND p.tenant_id = ${opts.tenantId}
    JOIN tag_definitions td ON td.id = pt.tag_definition_id
    WHERE ${filter}
  `)
  const rows = await tx.execute<PotentialDuplicateRow>(sql`
    SELECT DISTINCT ON (p.id)
      p.display_id AS "patientId",
      p.mrn,
      TRIM(CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name)) AS "patientName",
      p.date_of_birth::text AS "dateOfBirth",
      p.contact_number AS "contactNumber",
      pt.applied_at AS "flaggedAt"
    FROM patient_tags pt
    JOIN patients p ON p.id = pt.patient_id AND p.tenant_id = ${opts.tenantId}
    JOIN tag_definitions td ON td.id = pt.tag_definition_id
    WHERE ${filter}
    ORDER BY p.id, pt.applied_at ASC
    LIMIT ${ROW_LIMIT}
  `)
  return { count: asCount(countRow?.count), rows }
}

async function getUnverifiedExternalImmunizations(
  tx: Tx,
  opts: ReviewContext & { q?: string },
): Promise<ReviewCenterResponse['externalImmunizations']> {
  const searchPattern = opts.q ? `%${opts.q}%` : null
  const filter = sql`
    pei.tenant_id = ${opts.tenantId}
    AND pei.verified_at IS NULL
    AND pei.deleted_at IS NULL
    AND (p.home_branch_id = ${opts.branchId} OR p.home_branch_id IS NULL)
    AND p.is_active = true
    AND p.deleted_at IS NULL
    AND p.merged_into_id IS NULL
    AND (
      ${searchPattern}::text IS NULL
      OR CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name) ILIKE ${searchPattern}
      OR p.mrn ILIKE ${searchPattern}
      OR p.display_id ILIKE ${searchPattern}
      OR pei.vaccine_name ILIKE ${searchPattern}
    )
  `

  const [countRow] = await tx.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM patient_external_immunizations pei
    JOIN patients p ON p.id = pei.patient_id AND p.tenant_id = ${opts.tenantId}
    WHERE ${filter}
  `)
  const rows = await tx.execute<ExternalImmunizationReviewRow>(sql`
    SELECT
      p.display_id AS "patientId",
      p.mrn,
      TRIM(CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name)) AS "patientName",
      pei.vaccine_name AS "vaccineName",
      pei.administered_date::text AS "administeredDate",
      pei.administered_date_precision AS "administeredDatePrecision",
      pei.administered_at_facility AS "administeredAtFacility",
      pei.source,
      pei.created_at AS "createdAt"
    FROM patient_external_immunizations pei
    JOIN patients p ON p.id = pei.patient_id AND p.tenant_id = ${opts.tenantId}
    WHERE ${filter}
    ORDER BY pei.created_at ASC
    LIMIT ${ROW_LIMIT}
  `)
  return { count: asCount(countRow?.count), rows }
}

export async function getReviewCenter(
  opts: ReviewContext & { date: string; q?: string },
): Promise<ReviewCenterResponse> {
  return withTenantTx(opts, async (tx) => {
    const [branch] = await tx.execute<{ displayId: string }>(sql`
      SELECT display_id AS "displayId"
      FROM branches
      WHERE tenant_id = ${opts.tenantId} AND id = ${opts.branchId}
      LIMIT 1
    `)
    const [
      missingGuardians,
      staleOpenEncounters,
      unsettledTransactions,
      openPriorDrawers,
      undocumentedAdministrations,
      potentialDuplicates,
      externalImmunizations,
    ] = await Promise.all([
      getMissingGuardians(tx, opts),
      getStaleOpenEncounters(tx, opts),
      getUnsettledTransactions(tx, opts),
      getOpenPriorDrawers(tx, opts),
      getUndocumentedAdministrations(tx, opts),
      getPotentialDuplicates(tx, opts),
      getUnverifiedExternalImmunizations(tx, opts),
    ])
    const yesterdayLooseEndsCount =
      staleOpenEncounters.count +
      unsettledTransactions.count +
      openPriorDrawers.count +
      undocumentedAdministrations.count

    return {
      generatedAt: new Date().toISOString(),
      asOfDate: opts.date,
      branchId: branch?.displayId ?? String(opts.branchId),
      counts: {
        missingGuardians: missingGuardians.count,
        yesterdayLooseEnds: yesterdayLooseEndsCount,
        potentialDuplicates: potentialDuplicates.count,
        externalImmunizations: externalImmunizations.count,
      },
      missingGuardians,
      potentialDuplicates,
      externalImmunizations,
      yesterdayLooseEnds: {
        count: yesterdayLooseEndsCount,
        staleOpenEncounters,
        unsettledTransactions,
        openPriorDrawers,
        undocumentedAdministrations,
      },
    }
  })
}

export class ReviewCenterUpdateError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'STALE_RECORD',
    readonly status: 404 | 409,
  ) {
    super(message)
  }
}

export async function updateGuardianFromReview(
  opts: ReviewContext & {
    patientId: string
    reviewerDisplayId: string
    input: ReviewCenterGuardianUpdate
  },
): Promise<ReviewCenterGuardianUpdateResponse> {
  return withTenantTx(opts, async (tx) => {
    const [updated] = await tx.execute<{
      patientId: string
      patientName: string
      guardianName: string
      guardianRelationship: string
      guardianContact: string
      rowVersion: number
      updatedAt: string
    }>(sql`
      UPDATE patients p
      SET
        guardian_name = ${opts.input.guardianName},
        guardian_relationship = ${opts.input.guardianRelationship},
        guardian_contact = ${opts.input.guardianContact}
      WHERE p.tenant_id = ${opts.tenantId}
        AND p.home_branch_id = ${opts.branchId}
        AND p.display_id = ${opts.patientId}
        AND p.row_version = ${opts.input.expectedRowVersion}
        AND p.date_of_birth IS NOT NULL
        AND p.date_of_birth > (
          (now() AT TIME ZONE 'Asia/Manila')::date - INTERVAL '18 years'
        )
        AND p.is_active = true
        AND p.deleted_at IS NULL
        AND p.merged_into_id IS NULL
      RETURNING
        p.display_id AS "patientId",
        TRIM(CONCAT_WS(' ', p.first_name, p.middle_name, p.last_name)) AS "patientName",
        p.guardian_name AS "guardianName",
        p.guardian_relationship AS "guardianRelationship",
        p.guardian_contact AS "guardianContact",
        p.row_version AS "rowVersion",
        p.updated_at AS "updatedAt"
    `)

    if (!updated) {
      const [visible] = await tx.execute<{ rowVersion: number }>(sql`
        SELECT row_version AS "rowVersion"
        FROM patients
        WHERE tenant_id = ${opts.tenantId}
          AND home_branch_id = ${opts.branchId}
          AND display_id = ${opts.patientId}
          AND is_active = true
          AND deleted_at IS NULL
          AND merged_into_id IS NULL
        LIMIT 1
      `)
      if (visible) {
        throw new ReviewCenterUpdateError(
          'The patient record changed while you were reviewing it. Reload and confirm again.',
          'STALE_RECORD',
          409,
        )
      }
      throw new ReviewCenterUpdateError('Patient not found in this branch', 'NOT_FOUND', 404)
    }

    return {
      patientId: updated.patientId,
      patientName: updated.patientName,
      guardianName: updated.guardianName,
      guardianRelationship: updated.guardianRelationship,
      guardianContact: updated.guardianContact,
      rowVersion: updated.rowVersion,
      reviewedById: opts.reviewerDisplayId,
      reviewedAt: updated.updatedAt,
    }
  })
}
