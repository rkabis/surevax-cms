// PHI access logging — default-on for all /api/* GETs except an explicit non-PHI allowlist.
//
// DPA §20(c)(4) + HIPAA §164.312(b) require logging ALL PHI views, not just the three
// detail patterns previously covered. The old allowlist approach (3 URL patterns) missed:
//   - List endpoints: /api/patients, /api/encounters, /api/clinical-orders, etc.
//   - /api/lab-orders, /api/adverse-events, /api/bite-incidents, /api/scheduled-orders
//   - /api/transactions (contains PHI via items)
//   - /api/admin/audit (viewing audit rows is a PHI-adjacent access event)
//   - FHIR endpoints (/api/fhir/*)
//
// Approach B (allowlist inversion): log all /api/* GETs by default, minus explicit
// non-PHI paths listed in NON_PHI_PREFIXES.
//
// Patient ID resolution strategy:
//   - Detail endpoints for well-known resources: resolve patient_id from DB join
//   - List endpoints + resources without direct patient FK on URL: skip (patient_id NOT NULL
//     in schema — cannot write NULL; a future migration making the column nullable would
//     allow logging bulk-access events too). Documented gap per spec §5c.
//   - All writes are fire-and-forget — failures logged, never surfaced to callers.
//   - The res.on('finish') pattern ensures logging never blocks the response.

import type { Request, Response, NextFunction } from 'express'
import { sql } from 'drizzle-orm'
import { phiAccessLog } from '../db/schema.js'
import { withTenantTx } from '../db/withTenantTx.js'
import { logger } from '../utils/logger.js'
import type { AuthUser } from './auth.js'

// ─── Non-PHI allowlist ──────────────────────────────────────────────────────
// Any /api/* GET whose prefix appears here will NOT be logged.
// When adding a new non-PHI router, append its prefix here.
const NON_PHI_PREFIXES: string[] = [
  '/api/auth/',
  '/api/auth', // covers /api/auth itself (login, logout, refresh, me)
  '/api/operator/',
  '/api/operator', // operator-only admin routes, not patient-facing
  '/api/payments/webhooks',
  '/api/csrf-token',
  '/api/feature-flags',
  '/api/health',
  '/api/ready',
  '/api/services', // service catalog — product/pricing data, no PHI
  '/api/payer-profiles', // payer master data — no PHI
  '/api/partner-labs', // lab partner directory — no PHI
  '/api/places', // geographic lookup — no PHI
  '/api/standing-order-templates', // template master data — no PHI
  '/api/dashboard', // aggregate stats with no per-patient rows in response
  '/api/day-summary', // aggregate daily totals — no per-patient PHI
  '/api/shifts', // staff shift records — HR data, not PHI
  '/api/staff-time-logs', // staff time records — HR data, not PHI
  '/api/cash-drawer', // cash-drawer sessions — financial ops, no PHI
  '/api/inventory', // stock levels — no PHI
  '/api/inventory-transfers', // stock transfers — no PHI
  '/api/attachments', // file-level ops; PHI-adjacent but patient is resolved separately
  '/api/branch', // branch service-account routes — no direct PHI exposure
  '/api/admin/users', // user management — HR/admin, not clinical PHI
  '/api/admin/attendance', // staff attendance — HR data
  '/api/admin/approvals', // approval workflows — no direct PHI
  '/api/admin/branches', // branch configuration — no PHI
  '/api/admin/notifications', // notification templates — no PHI
  '/api/admin/product-recalls', // recall management — product, not patient
  '/api/admin/standing-orders', // template management
  '/api/admin/patient-standing-orders', // accessed via patients path; patient_id on URL
  '/api/admin/patients', // cancel-pending admin action; not a PHI read
  '/api/admin/dpa', // DPA tooling routes — meta, not a PHI view
  // Cross-branch access grants list: returns metadata about WHO accessed WHICH patient
  // at which branch, not the clinical chart rows themselves. PHI-adjacent but the
  // grant rows don't contain diagnoses, doses, or lab data. The break-glass chart
  // read (/api/patients/:id routes) is PHI-logged by the default-on path above.
  '/api/admin/cross-branch-access',
]

// ─── Resource type inference from URL prefix ─────────────────────────────────
// Maps the start of req.path to a contextEntityType for the log row.
const RESOURCE_TYPE_MAP: Array<[string, string]> = [
  ['/api/patients', 'patient'],
  ['/api/encounters', 'encounter'],
  ['/api/clinical-orders', 'clinical_order'],
  ['/api/lab-orders', 'lab_order'],
  ['/api/adverse-events', 'adverse_event'],
  ['/api/bite-incidents', 'bite_incident'],
  ['/api/admin/audit', 'audit_log'],
  ['/api/audit', 'audit_log'],
  ['/api/fhir/Patient', 'fhir_patient'],
  ['/api/fhir/Encounter', 'fhir_encounter'],
  ['/api/fhir/Immunization', 'fhir_immunization'],
  ['/api/fhir', 'fhir_resource'],
  ['/api/scheduled-orders', 'scheduled_order'],
  ['/api/transactions', 'transaction'],
  ['/api/group-bills', 'group_bill'],
  ['/api/appointments', 'appointment'],
  ['/api/arrivals', 'arrival'],
  ['/api/standing-orders', 'standing_order'],
  ['/api/patient-standing-orders', 'patient_standing_order'],
  ['/api/health-cards', 'health_card'],
  ['/api/product-recalls', 'product_recall'],
  // Clinic-wide list of patients who owe money. Unambiguously PHI (named
  // patients + financial state), so it is NOT in NON_PHI_PREFIXES; it logs via
  // the bulk branch with a null patient_id.
  ['/api/accounts-receivable', 'accounts_receivable'],
]

// ─── Detail-endpoint patient resolution patterns ──────────────────────────────
// For endpoints where a display_id appears in the URL and we can cheaply resolve
// the bigint patient_id, do so.  For list endpoints, we skip (see file header).
const PATIENT_DETAIL = /^\/api\/patients\/([^/]+?)(?:\/.*)?$/
const ENCOUNTER_DETAIL = /^\/api\/encounters\/([^/]+)$/
const CLINICAL_ORDER_DETAIL = /^\/api\/clinical-orders\/([^/]+)$/
const LAB_ORDER_DETAIL = /^\/api\/lab-orders\/([^/]+)$/
const ADVERSE_EVENT_DETAIL = /^\/api\/adverse-events\/([^/]+)$/
const BITE_INCIDENT_DETAIL = /^\/api\/bite-incidents\/([^/]+)$/
const SCHEDULED_ORDER_DETAIL = /^\/api\/scheduled-orders\/([^/]+)$/
const TRANSACTION_DETAIL = /^\/api\/transactions\/([^/]+)$/
const GROUP_BILL_DETAIL = /^\/api\/group-bills\/(GBL_[^/]+)$/
const APPOINTMENT_DETAIL = /^\/api\/appointments\/([^/]+)$/

/** Returns the inferred contextEntityType for the URL, or null if non-PHI. */
function inferResourceType(path: string): string | null {
  for (const [prefix, type] of RESOURCE_TYPE_MAP) {
    if (path.startsWith(prefix)) return type
  }
  return 'unknown_phi'
}

/** Returns true when the path is in the non-PHI allowlist. */
function isNonPhi(path: string): boolean {
  for (const prefix of NON_PHI_PREFIXES) {
    if (path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '?')) {
      return true
    }
  }
  return false
}

/**
 * Middleware: writes a phi_access_log row after any 2xx GET to a PHI endpoint.
 * Runs asynchronously on res.finish so it NEVER blocks the response.
 *
 * Coverage: all /api/* GETs except paths in NON_PHI_PREFIXES.
 * Patient ID resolution: resolved for known detail endpoints; list endpoints
 * and multi-resource endpoints skip the log insert because patient_id is NOT NULL
 * in the schema (a future migration making it nullable will allow bulk-access logging).
 */
export function phiAccessLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    if (req.method !== 'GET') return
    if (res.statusCode < 200 || res.statusCode >= 300) return
    if (!req.path.startsWith('/api/')) return
    if (isNonPhi(req.path)) return

    const user = (req as Request & { user?: AuthUser }).user
    if (!user || user.id == null) return

    const tenantId = req.tenant?.id
    if (!tenantId) return

    const ipAddress = req.ip ?? null
    const userAgent = req.headers['user-agent'] ?? null
    const resourceType = inferResourceType(req.path)

    // ── Patient detail (/api/patients/:id and sub-resources like /api/patients/:id/consents) ──
    const patientMatch = PATIENT_DETAIL.exec(req.path)
    if (patientMatch?.[1]) {
      const patientDisplayId = patientMatch[1]
      void writePhiLogWithSelect({
        tenantId,
        user,
        selectSql: sql`SELECT id AS patient_id FROM patients
                WHERE display_id = ${patientDisplayId} AND tenant_id = ${tenantId}
                LIMIT 1`,
        ipAddress,
        userAgent,
        contextEntityType: resourceType ?? 'patient',
        contextEntityId: patientDisplayId,
        logLabel: 'patient lookup',
      })
      return
    }

    // ── Encounter detail ──
    const encounterMatch = ENCOUNTER_DETAIL.exec(req.path)
    if (encounterMatch?.[1]) {
      const encounterDisplayId = encounterMatch[1]
      void writePhiLogWithSelect({
        tenantId,
        user,
        selectSql: sql`SELECT patient_id FROM encounters
                WHERE display_id = ${encounterDisplayId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
                LIMIT 1`,
        ipAddress,
        userAgent,
        contextEntityType: 'encounter',
        contextEntityId: encounterDisplayId,
        logLabel: 'encounter lookup',
      })
      return
    }

    // ── Clinical-order detail ──
    const orderMatch = CLINICAL_ORDER_DETAIL.exec(req.path)
    if (orderMatch?.[1]) {
      const orderDisplayId = orderMatch[1]
      void writePhiLogWithSelect({
        tenantId,
        user,
        selectSql: sql`SELECT pso.patient_id
                FROM clinical_orders co
                JOIN patient_standing_orders pso ON pso.id = co.patient_standing_order_id
                WHERE co.display_id = ${orderDisplayId} AND co.tenant_id = ${tenantId} AND co.deleted_at IS NULL
                LIMIT 1`,
        ipAddress,
        userAgent,
        contextEntityType: 'clinical_order',
        contextEntityId: orderDisplayId,
        logLabel: 'clinical-order lookup',
      })
      return
    }

    // ── Lab-order detail ──
    const labOrderMatch = LAB_ORDER_DETAIL.exec(req.path)
    if (labOrderMatch?.[1]) {
      const labOrderDisplayId = labOrderMatch[1]
      void writePhiLogWithSelect({
        tenantId,
        user,
        selectSql: sql`SELECT co.patient_id
                FROM lab_orders lo
                JOIN clinical_orders co ON co.id = lo.clinical_order_id
                WHERE lo.display_id = ${labOrderDisplayId} AND lo.tenant_id = ${tenantId} AND lo.deleted_at IS NULL
                LIMIT 1`,
        ipAddress,
        userAgent,
        contextEntityType: 'lab_order',
        contextEntityId: labOrderDisplayId,
        logLabel: 'lab-order lookup',
      })
      return
    }

    // ── Adverse-event detail ──
    const adverseEventMatch = ADVERSE_EVENT_DETAIL.exec(req.path)
    if (adverseEventMatch?.[1]) {
      const aeDisplayId = adverseEventMatch[1]
      void writePhiLogWithSelect({
        tenantId,
        user,
        selectSql: sql`SELECT patient_id FROM adverse_events
                WHERE display_id = ${aeDisplayId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
                LIMIT 1`,
        ipAddress,
        userAgent,
        contextEntityType: 'adverse_event',
        contextEntityId: aeDisplayId,
        logLabel: 'adverse-event lookup',
      })
      return
    }

    // ── Bite-incident detail ──
    const biteMatch = BITE_INCIDENT_DETAIL.exec(req.path)
    if (biteMatch?.[1]) {
      const biteDisplayId = biteMatch[1]
      void writePhiLogWithSelect({
        tenantId,
        user,
        selectSql: sql`SELECT patient_id FROM bite_incidents
                WHERE display_id = ${biteDisplayId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
                LIMIT 1`,
        ipAddress,
        userAgent,
        contextEntityType: 'bite_incident',
        contextEntityId: biteDisplayId,
        logLabel: 'bite-incident lookup',
      })
      return
    }

    // ── Scheduled-order detail ──
    const scheduledOrderMatch = SCHEDULED_ORDER_DETAIL.exec(req.path)
    if (scheduledOrderMatch?.[1]) {
      const soDisplayId = scheduledOrderMatch[1]
      void writePhiLogWithSelect({
        tenantId,
        user,
        selectSql: sql`SELECT pso.patient_id
                FROM patient_standing_orders pso
                WHERE pso.display_id = ${soDisplayId} AND pso.tenant_id = ${tenantId} AND pso.deleted_at IS NULL
                LIMIT 1`,
        ipAddress,
        userAgent,
        contextEntityType: 'scheduled_order',
        contextEntityId: soDisplayId,
        logLabel: 'scheduled-order lookup',
      })
      return
    }

    // ── Transaction detail ──
    const txMatch = TRANSACTION_DETAIL.exec(req.path)
    if (txMatch?.[1]) {
      const txDisplayId = txMatch[1]
      void writePhiLogWithSelect({
        tenantId,
        user,
        selectSql: sql`SELECT patient_id FROM transactions
                WHERE display_id = ${txDisplayId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
                LIMIT 1`,
        ipAddress,
        userAgent,
        contextEntityType: 'transaction',
        contextEntityId: txDisplayId,
        logLabel: 'transaction lookup',
      })
      return
    }

    // ── Appointment detail ──
    const apptMatch = APPOINTMENT_DETAIL.exec(req.path)
    if (apptMatch?.[1]) {
      const apptDisplayId = apptMatch[1]
      void writePhiLogWithSelect({
        tenantId,
        user,
        selectSql: sql`SELECT patient_id FROM appointments
                WHERE display_id = ${apptDisplayId} AND tenant_id = ${tenantId} AND deleted_at IS NULL
                LIMIT 1`,
        ipAddress,
        userAgent,
        contextEntityType: 'appointment',
        contextEntityId: apptDisplayId,
        logLabel: 'appointment lookup',
      })
      return
    }

    // A group bill intentionally spans several patients, so one patient_id
    // would be misleading. Record the exact aggregate context with the bulk
    // nullable-patient shape instead.
    const groupBillMatch = GROUP_BILL_DETAIL.exec(req.path)
    if (groupBillMatch?.[1]) {
      void writePhiLog({
        tenantId,
        user,
        patientId: null,
        ipAddress,
        userAgent,
        contextEntityType: 'group_bill',
        contextEntityId: groupBillMatch[1],
      })
      return
    }

    // ── List endpoints and unresolvable detail endpoints ────────────────────
    // patient_id became nullable in 0023_phi_access_log_nullable_patient.sql,
    // so we can now record bulk-access events with patient_id IS NULL.
    // Per-patient audit queries must filter `WHERE patient_id IS NOT NULL`
    // explicitly. Aggregate access reporting works across both shapes.
    void writePhiLog({
      tenantId,
      user,
      patientId: null,
      ipAddress,
      userAgent,
      contextEntityType: resourceType ?? 'unknown_phi',
      contextEntityId: req.path,
    })
  })

  next()
}

type WritePhiLogOpts = {
  tenantId: string
  user: AuthUser
  /** Bigint patient FK; null for bulk-list access where no single patient is identified at the URL. */
  patientId: number | null
  ipAddress: string | null
  userAgent: string | null
  contextEntityType?: string
  contextEntityId?: string
}

// AUTH-2: phi_access_log INSERT wrapped in withTenantTx so the RLS GUCs are set.
// user.id is non-null at call sites (guard at top of writePhiLog / writePhiLogWithSelect).
async function writePhiLog(opts: WritePhiLogOpts): Promise<void> {
  const { tenantId, user, patientId, ipAddress, userAgent, contextEntityType, contextEntityId } =
    opts
  if (user.id == null) return
  const userBigintId: number = user.id
  try {
    await withTenantTx(
      { tenantId, userId: userBigintId, branchId: user.branchId ?? null },
      async (tx) => {
        await tx.insert(phiAccessLog).values({
          tenantId,
          userId: userBigintId,
          patientId,
          accessType: 'read',
          contextEntityType: contextEntityType ?? null,
          contextEntityId: contextEntityId ?? null,
          ipAddress,
          userAgent,
        })
      },
    )
  } catch (err) {
    logger.error({ err, patientId, userId: user.id }, 'phi_access_log write failed')
  }
}

type WritePhiLogWithSelectOpts = {
  tenantId: string
  user: AuthUser
  /** A parameterised SQL fragment that returns a single row with a `patient_id` column. */
  selectSql: ReturnType<typeof sql>
  ipAddress: string | null
  userAgent: string | null
  contextEntityType?: string
  contextEntityId?: string
  logLabel: string
}

/**
 * AUTH-2: resolves patient_id and writes the phi_access_log row in ONE withTenantTx.
 * Collapsing the SELECT + INSERT into the same transaction satisfies RLS on both
 * the source table read and the phi_access_log write.
 */
async function writePhiLogWithSelect(opts: WritePhiLogWithSelectOpts): Promise<void> {
  const {
    tenantId,
    user,
    selectSql,
    ipAddress,
    userAgent,
    contextEntityType,
    contextEntityId,
    logLabel,
  } = opts
  if (user.id == null) return
  const userBigintId: number = user.id
  try {
    await withTenantTx(
      { tenantId, userId: userBigintId, branchId: user.branchId ?? null },
      async (tx) => {
        type Row = { patient_id: number }
        const rows = await tx.execute<Row>(selectSql)
        const patientId = rows[0]?.patient_id
        if (patientId == null) return
        await tx.insert(phiAccessLog).values({
          tenantId,
          userId: userBigintId,
          patientId,
          accessType: 'read',
          contextEntityType: contextEntityType ?? null,
          contextEntityId: contextEntityId ?? null,
          ipAddress,
          userAgent,
        })
      },
    )
  } catch (err) {
    logger.error({ err, userId: user.id }, `phi_access_log ${logLabel} failed`)
  }
}
