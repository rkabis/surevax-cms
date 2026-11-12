import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { displayId } from '../../shared/utils/displayId.js'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import type { Tx } from '../../shared/db/withTenantTx.js'
import {
  clinicalOrders,
  consents,
  patientStandingOrders,
  patientStandingOrdersStatusHistory,
  patients,
  serviceCatalog,
  standingOrderTemplateItems,
  standingOrderTemplates,
  users,
} from '../../shared/db/schema.js'
import { applyRecomputeTx, type RecomputeSource } from '../scheduled_orders/db.js'

// ── Resolver helpers ──────────────────────────────────────────────────────────
// URL/body display_ids are resolved to bigint PKs before any FK write.

async function resolvePatientId(
  tx: Tx,
  tenantId: string,
  patientDisplayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.tenantId, tenantId), eq(patients.displayId, patientDisplayId)))
    .limit(1)
  return row?.id ?? null
}

async function resolveEncounterId(
  tx: Tx,
  tenantId: string,
  encounterDisplayId: string,
): Promise<number | null> {
  const { encounters } = await import('../../shared/db/schema.js')
  const [row] = await tx
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.tenantId, tenantId), eq(encounters.displayId, encounterDisplayId)))
    .limit(1)
  return row?.id ?? null
}

async function resolveUserId(
  tx: Tx,
  tenantId: string,
  userDisplayId: string,
): Promise<number | null> {
  const { users } = await import('../../shared/db/schema.js')
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.displayId, userDisplayId)))
    .limit(1)
  return row?.id ?? null
}

/**
 * List standing order templates for the tenant.
 * When `specialty` is provided, returns only active templates whose specialty
 * matches OR is NULL (universal templates visible in all encounters).
 *
 * `id` is the raw template code (text PK) — surfaced directly.
 */
export async function listStandingOrderTemplates(tenantId: string, specialty?: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        id: standingOrderTemplates.id,
        code: standingOrderTemplates.code,
        name: standingOrderTemplates.name,
        description: standingOrderTemplates.description,
        version: standingOrderTemplates.version,
        requiresPhysicianAuth: standingOrderTemplates.requiresPhysicianAuth,
        isActive: standingOrderTemplates.isActive,
        isLocked: standingOrderTemplates.isLocked,
        specialty: standingOrderTemplates.specialty,
        createdAt: standingOrderTemplates.createdAt,
        updatedAt: standingOrderTemplates.updatedAt,
        createdById: standingOrderTemplates.createdById,
      })
      .from(standingOrderTemplates)
      .where(
        and(
          eq(standingOrderTemplates.tenantId, tenantId),
          specialty
            ? and(
                eq(standingOrderTemplates.isActive, true),
                or(
                  isNull(standingOrderTemplates.specialty),
                  eq(standingOrderTemplates.specialty, specialty),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(standingOrderTemplates.code)),
  )
}

/**
 * List active templates joined with their items in two queries (no N+1).
 * Used by the protocol initiation flow so the picker can preview Day-offsets
 * without one round-trip per template.
 *
 * Each item surfaces its display_id (`STI_<base32>`); template id stays raw.
 */
export async function listActiveTemplatesWithItems(tenantId: string) {
  const templates = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        id: standingOrderTemplates.id,
        code: standingOrderTemplates.code,
        name: standingOrderTemplates.name,
        description: standingOrderTemplates.description,
        version: standingOrderTemplates.version,
        requiresPhysicianAuth: standingOrderTemplates.requiresPhysicianAuth,
        isActive: standingOrderTemplates.isActive,
        isLocked: standingOrderTemplates.isLocked,
        specialty: standingOrderTemplates.specialty,
        createdAt: standingOrderTemplates.createdAt,
        updatedAt: standingOrderTemplates.updatedAt,
        createdById: standingOrderTemplates.createdById,
      })
      .from(standingOrderTemplates)
      .where(
        and(
          eq(standingOrderTemplates.tenantId, tenantId),
          eq(standingOrderTemplates.isActive, true),
        ),
      )
      .orderBy(asc(standingOrderTemplates.code)),
  )

  if (templates.length === 0) return []

  const items = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        // Surface display_id as the public `id`.
        id: standingOrderTemplateItems.displayId,
        templateId: standingOrderTemplateItems.templateId,
        dayOffset: standingOrderTemplateItems.dayOffset,
        sequence: standingOrderTemplateItems.sequence,
        serviceId: standingOrderTemplateItems.serviceId,
        serviceName: serviceCatalog.name,
        serviceCode: serviceCatalog.code,
        quantity: standingOrderTemplateItems.quantity,
        instructions: standingOrderTemplateItems.instructions,
      })
      .from(standingOrderTemplateItems)
      .innerJoin(serviceCatalog, eq(standingOrderTemplateItems.serviceId, serviceCatalog.id))
      .where(
        and(
          eq(standingOrderTemplateItems.tenantId, tenantId),
          inArray(
            standingOrderTemplateItems.templateId,
            templates.map((t) => t.id),
          ),
        ),
      )
      .orderBy(asc(standingOrderTemplateItems.dayOffset), asc(standingOrderTemplateItems.sequence)),
  )

  const itemsByTemplate = new Map<string, typeof items>()
  for (const item of items) {
    const list = itemsByTemplate.get(item.templateId) ?? []
    list.push(item)
    itemsByTemplate.set(item.templateId, list)
  }

  return templates.map((t) => ({
    ...t,
    items: (itemsByTemplate.get(t.id) ?? []).map(({ templateId: _tid, ...rest }) => rest),
  }))
}

/**
 * Fetch a single standing-order template (by raw code id) plus its items,
 * with createdBy resolved to a structured object.
 */
export async function getStandingOrderTemplate(tenantId: string, id: string) {
  const createdByUser = alias(users, 'created_by_user')
  const templateRow = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({
        template: standingOrderTemplates,
        createdByUserId: createdByUser.id,
        createdByDisplayId: createdByUser.displayId,
        createdByFirstName: createdByUser.firstName,
        createdByLastName: createdByUser.lastName,
      })
      .from(standingOrderTemplates)
      .leftJoin(createdByUser, eq(createdByUser.id, standingOrderTemplates.createdById))
      .where(and(eq(standingOrderTemplates.tenantId, tenantId), eq(standingOrderTemplates.id, id)))
      .limit(1)
    return row ?? null
  })

  if (!templateRow) return null

  const items = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        id: standingOrderTemplateItems.displayId,
        dayOffset: standingOrderTemplateItems.dayOffset,
        sequence: standingOrderTemplateItems.sequence,
        serviceId: standingOrderTemplateItems.serviceId,
        serviceName: serviceCatalog.name,
        serviceCode: serviceCatalog.code,
        quantity: standingOrderTemplateItems.quantity,
        instructions: standingOrderTemplateItems.instructions,
      })
      .from(standingOrderTemplateItems)
      .innerJoin(serviceCatalog, eq(standingOrderTemplateItems.serviceId, serviceCatalog.id))
      .where(
        and(
          eq(standingOrderTemplateItems.tenantId, tenantId),
          eq(standingOrderTemplateItems.templateId, id),
        ),
      )
      .orderBy(asc(standingOrderTemplateItems.dayOffset), asc(standingOrderTemplateItems.sequence)),
  )

  return {
    ...templateRow.template,
    createdBy: templateRow.createdByUserId
      ? {
          id: templateRow.createdByUserId,
          displayId: templateRow.createdByDisplayId!,
          firstName: templateRow.createdByFirstName!,
          lastName: templateRow.createdByLastName!,
        }
      : null,
    items,
  }
}

// ── Patient standing orders ───────────────────────────────────────────────────

/**
 * `clinical_orders.indication` classification, by standing-order template
 * identity: the only in-app write path for this column (the alternative,
 * a migration-only column, was ruled out, see the nurse-testing-readiness
 * handover). `standing_order_templates.id` IS the raw catalog code (e.g.
 * `SOT_RABIES_PEP_IM`), so it is the template's own identity, not a derived
 * or inferred signal, true to the data model rather than the encounter's
 * `specialty` (shared by PEP, PrEP, booster, and the Cat III bundles alike,
 * so it cannot discriminate) or the bite-incident/exposure-category context
 * (arrivals wizard collects that for the physician's decision of WHICH
 * template to start, but by the time `startStandingOrderTx` runs, that
 * decision is already baked into `templateId`; re-deriving it from the
 * incident would be redundant and could disagree with the template actually
 * chosen).
 *
 * Deliberately only the plain single-purpose IM/ID PEP and PrEP templates
 * are classified. `getPepProgress` (patients/db.ts) renders a course against
 * one of two FIXED label arrays (`PEP_DOSE_LABELS`, 5 entries, `Day 0`
 * through `Day 28`; `PREP_DOSE_LABELS`, 3 entries) keyed by `doseNumber`.
 * Booster (`SOT_RABIES_BOOSTER_IM/ID`, a 2-dose re-exposure regimen for
 * already-immunized patients) and the Cat III composite bundles
 * (`SOT_RABIES_CAT3_ID_ERIG/HRIG`, which interleave ARV-PEP-ID doses with
 * RIG and Tetanus Toxoid items in the SAME template, so `doseNumber` walks
 * across three different service types) do not fit either fixed shape:
 * tagging them would make `getPepProgress` render wrong day labels rather
 * than fixing anything. They stay `indication: null`; their real schedule is
 * still visible via the generic per-course dose strip (`doseStates`, from
 * `getActiveDoseStatesTx` in patients/db.ts) which is indication-independent.
 *
 * These string literals mirror `SOT_RABIES_PEP_IM` etc. in
 * `shared/db/seed/constants.ts`, not imported from there, since that module
 * wires up the seed-only migrator DB client and has no business being a
 * runtime dependency of a request-handling module.
 */
const RABIES_PEP_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  'SOT_RABIES_PEP_IM',
  'SOT_RABIES_PEP_ID',
])
const RABIES_PREP_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  'SOT_RABIES_PREP_IM',
  'SOT_RABIES_PREP_ID',
])

function deriveStandingOrderIndication(templateId: string): string | null {
  if (RABIES_PEP_TEMPLATE_IDS.has(templateId)) return 'Post-Exposure Prophylaxis'
  if (RABIES_PREP_TEMPLATE_IDS.has(templateId)) return 'Pre-Exposure Prophylaxis'
  return null
}

export type CreatedStandingOrder = {
  id: string // display_id
  templateId: string
  status: string
  startDate: Date
  clinicalOrders: Array<{
    id: string // display_id
    serviceId: string
    doseNumber: number | null
    currentScheduledDate: Date | null
    status: string
  }>
}

export type StartStandingOrderInput = {
  tenantId: string
  /** Caller branch. Cross-branch reveal is read-only, including protocols. */
  branchId: number | null
  /** Display ID — `PAT_…`. */
  patientId: string
  /** Display ID — `ENC_…`, or null when initiated outside a visit (e.g. a
   *  booster started from the patient chart). Both `initiating_encounter_id`
   *  and `clinical_orders.encounter_id` are nullable FKs. */
  encounterId: string | null
  /** Raw template code (text PK). */
  templateId: string
  /** Display ID — `USR_…` or null. */
  authorizingProviderId: string | null
  startDateIso: string
  /** Bigint — the creating user's PK. */
  createdById: number
}

/**
 * Insert one patient_standing_orders row plus one clinical_orders row per
 * template item. Caller is responsible for opening the transaction with RLS
 * SET LOCAL context — see service.startStandingOrder.
 *
 * Resolves display_id inputs (patient, encounter, authorizing provider) to
 * bigint PKs at the start; surfaces display_id-only results.
 */
export async function startStandingOrderTx(
  tx: Tx,
  input: StartStandingOrderInput,
): Promise<CreatedStandingOrder> {
  const {
    tenantId,
    branchId,
    patientId: patientDisplayId,
    encounterId: encounterDisplayId,
    templateId,
    authorizingProviderId: authorizingProviderDisplayId,
    startDateIso,
    createdById,
  } = input

  // Resolve display_ids → bigint PKs.
  const patientId = await resolvePatientId(tx, tenantId, patientDisplayId)
  if (patientId === null) throw new Error('PATIENT_NOT_FOUND')
  if (branchId !== null) {
    const [patientBranch] = await tx
      .select({ homeBranchId: patients.homeBranchId })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), eq(patients.id, patientId)))
      .limit(1)
    if (patientBranch?.homeBranchId !== null && patientBranch?.homeBranchId !== branchId) {
      throw new Error('CROSS_BRANCH_WRITE_FORBIDDEN')
    }
  }

  let encounterId: number | null = null
  if (encounterDisplayId) {
    encounterId = await resolveEncounterId(tx, tenantId, encounterDisplayId)
    if (encounterId === null) throw new Error('ENCOUNTER_NOT_FOUND')
  }

  let authorizingProviderId: number | null = null
  if (authorizingProviderDisplayId) {
    authorizingProviderId = await resolveUserId(tx, tenantId, authorizingProviderDisplayId)
    if (authorizingProviderId === null) throw new Error('AUTHORIZING_PROVIDER_NOT_FOUND')
  }

  // 1. Verify the template exists and is active in this tenant.
  const [template] = await tx
    .select({
      id: standingOrderTemplates.id,
      isActive: standingOrderTemplates.isActive,
      isLocked: standingOrderTemplates.isLocked,
      requiresPhysicianAuth: standingOrderTemplates.requiresPhysicianAuth,
    })
    .from(standingOrderTemplates)
    .where(
      and(eq(standingOrderTemplates.tenantId, tenantId), eq(standingOrderTemplates.id, templateId)),
    )
    .limit(1)

  if (!template) {
    throw new Error('TEMPLATE_NOT_FOUND')
  }
  if (!template.isActive) {
    throw new Error('TEMPLATE_INACTIVE')
  }
  // Server-side enforcement of the physician-auth flag (previously only
  // checked client-side in the arrivals wizard, Step3Protocol.tsx). A direct
  // API call bypassing that wizard could otherwise start a physician-required
  // protocol with no physician on record. This is a rabies PEP clinic, and
  // the flag exists to record who authorised the protocol.
  if (template.requiresPhysicianAuth && authorizingProviderId === null) {
    throw new Error('PHYSICIAN_AUTH_REQUIRED')
  }

  // Lock the template on first PSO creation (idempotent — already locked is fine).
  if (!template.isLocked) {
    await tx
      .update(standingOrderTemplates)
      .set({ isLocked: true, updatedAt: sql`now()` })
      .where(
        and(
          eq(standingOrderTemplates.tenantId, tenantId),
          eq(standingOrderTemplates.id, templateId),
        ),
      )
  }

  const items = await tx
    .select({
      serviceId: standingOrderTemplateItems.serviceId,
      dayOffset: standingOrderTemplateItems.dayOffset,
      sequence: standingOrderTemplateItems.sequence,
      quantity: standingOrderTemplateItems.quantity,
    })
    .from(standingOrderTemplateItems)
    .where(
      and(
        eq(standingOrderTemplateItems.tenantId, tenantId),
        eq(standingOrderTemplateItems.templateId, templateId),
      ),
    )
    .orderBy(asc(standingOrderTemplateItems.dayOffset), asc(standingOrderTemplateItems.sequence))

  if (items.length === 0) {
    throw new Error('TEMPLATE_HAS_NO_ITEMS')
  }

  // 2. Insert the patient_standing_orders row. display_id surfaced as the public id.
  const startDate = new Date(startDateIso)

  const [created] = await tx
    .insert(patientStandingOrders)
    .values({
      displayId: displayId('PSO'),
      tenantId,
      patientId,
      templateId,
      initiatingEncounterId: encounterId,
      authorizingProviderId,
      status: 'Active',
      startDate,
      createdById,
    })
    .returning({
      id: patientStandingOrders.id,
      displayId: patientStandingOrders.displayId,
      templateId: patientStandingOrders.templateId,
      status: patientStandingOrders.status,
      startDate: patientStandingOrders.startDate,
    })

  if (!created) {
    throw new Error('FAILED_TO_CREATE_STANDING_ORDER')
  }

  // 3. Insert one clinical_orders row per template item. encounterId column
  // links the order to an encounter via its FK.
  //
  // doseNumber = 1-based position of the item in the schedule (idx + 1), NOT
  // item.sequence. `sequence` is a within-visit site index (IM PEP: always 1;
  // ID PEP: 1 or 2 for L/R deltoid). Using sequence caused all five IM PEP
  // doses to get doseNumber=1, poisoning hasBlockingOverdue / getPepProgress
  // (CLIN-2 fix). Items are already ordered by (dayOffset ASC, sequence ASC).
  //
  // indication, see deriveStandingOrderIndication above. This is the ONLY
  // in-app write path for clinical_orders.indication (previously only the
  // AppSheet migration transform wrote it), so getPepProgress returned
  // "not-started" for every patient registered through the app.
  const indication = deriveStandingOrderIndication(templateId)
  const orderRows = items.map((item, idx) => {
    const scheduled = new Date(startDate.getTime())
    scheduled.setUTCDate(scheduled.getUTCDate() + item.dayOffset)
    return {
      displayId: displayId('ORD'),
      tenantId,
      patientStandingOrderId: created.id,
      patientId,
      serviceId: item.serviceId,
      encounterId,
      orderType: 'Standing_Order' as const,
      status: 'Pending' as const,
      originalScheduledDate: scheduled,
      currentScheduledDate: scheduled,
      quantity: item.quantity,
      doseNumber: idx + 1,
      indication,
      createdById,
    }
  })

  const insertedOrders = await tx.insert(clinicalOrders).values(orderRows).returning({
    id: clinicalOrders.id,
    displayId: clinicalOrders.displayId,
    serviceId: clinicalOrders.serviceId,
    doseNumber: clinicalOrders.doseNumber,
    currentScheduledDate: clinicalOrders.currentScheduledDate,
    status: clinicalOrders.status,
  })

  return {
    id: created.displayId,
    templateId: created.templateId,
    status: created.status,
    startDate: created.startDate,
    clinicalOrders: insertedOrders.map((o) => ({
      id: o.displayId,
      serviceId: o.serviceId,
      doseNumber: o.doseNumber,
      currentScheduledDate: o.currentScheduledDate,
      status: o.status,
    })),
  }
}

/**
 * List patient_standing_orders for a given tenant (most recent first).
 * Surfaces display_id as the public id.
 */
export async function listPatientStandingOrders(tenantId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        id: patientStandingOrders.displayId,
        tenantId: patientStandingOrders.tenantId,
        templateId: patientStandingOrders.templateId,
        templateName: standingOrderTemplates.name,
        patientId: patients.displayId,
        patientName: sql<string>`${patients.lastName} || ', ' || ${patients.firstName}`,
        status: patientStandingOrders.status,
        startDate: patientStandingOrders.startDate,
        endDate: patientStandingOrders.endDate,
        authorizingProviderId: patientStandingOrders.authorizingProviderId,
        suspendedAt: patientStandingOrders.suspendedAt,
        discontinuedAt: patientStandingOrders.discontinuedAt,
        createdAt: patientStandingOrders.createdAt,
        updatedAt: patientStandingOrders.updatedAt,
        dosesCompleted: sql<number>`(SELECT COUNT(*)::int FROM ${clinicalOrders} WHERE ${clinicalOrders.patientStandingOrderId} = ${patientStandingOrders.id} AND ${clinicalOrders.status} = 'Completed' AND ${clinicalOrders.deletedAt} IS NULL)`,
        dosesTotal: sql<number>`(SELECT COUNT(*)::int FROM ${clinicalOrders} WHERE ${clinicalOrders.patientStandingOrderId} = ${patientStandingOrders.id} AND ${clinicalOrders.deletedAt} IS NULL)`,
      })
      .from(patientStandingOrders)
      .innerJoin(patients, eq(patientStandingOrders.patientId, patients.id))
      .innerJoin(
        standingOrderTemplates,
        eq(patientStandingOrders.templateId, standingOrderTemplates.id),
      )
      .where(eq(patientStandingOrders.tenantId, tenantId))
      .orderBy(desc(patientStandingOrders.createdAt)),
  )
}

/**
 * Pause (Suspended) or resume (Active) a patient standing order.
 * Only Active ↔ Suspended transitions are allowed — Completed/Discontinued
 * PSOs throw PSO_NOT_PAUSABLE. Status history is captured by the DB trigger.
 */
export async function setPatientStandingOrderStatus(
  ctx: { tenantId: string; userId: number; branchId: number | null },
  psoDisplayId: string,
  status: 'Active' | 'Suspended',
) {
  return withTenantTx(ctx, async (tx) => {
    const [current] = await tx
      .select({ id: patientStandingOrders.id, status: patientStandingOrders.status })
      .from(patientStandingOrders)
      .where(
        and(
          eq(patientStandingOrders.tenantId, ctx.tenantId),
          eq(patientStandingOrders.displayId, psoDisplayId),
        ),
      )
      .limit(1)
    if (!current) throw new Error('PSO_NOT_FOUND')
    if (current.status !== 'Active' && current.status !== 'Suspended') {
      throw new Error('PSO_NOT_PAUSABLE')
    }

    const [row] = await tx
      .update(patientStandingOrders)
      .set({
        status,
        suspendedAt: status === 'Suspended' ? sql`now()` : null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(patientStandingOrders.tenantId, ctx.tenantId),
          eq(patientStandingOrders.id, current.id),
        ),
      )
      .returning({
        id: patientStandingOrders.displayId,
        status: patientStandingOrders.status,
        suspendedAt: patientStandingOrders.suspendedAt,
      })
    return row!
  })
}

/**
 * Fetch a single PSO (by display_id) with its:
 *   - consents[]  — from `consents` table via clinical_order linkage (Phase 2)
 *   - statusHistory[] — from `patient_standing_orders_status_history`
 *
 * Returns the PSO with display_id as the public id.
 */
export async function getPatientStandingOrder(tenantId: string, psoDisplayId: string) {
  const pso = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select()
      .from(patientStandingOrders)
      .where(
        and(
          eq(patientStandingOrders.tenantId, tenantId),
          eq(patientStandingOrders.displayId, psoDisplayId),
        ),
      )
      .limit(1)
    return row ?? null
  })

  if (!pso) return null

  // Fetch the clinical order bigints for the consents linkage AND the public display_ids for response.
  const coRows = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        id: clinicalOrders.id,
        displayId: clinicalOrders.displayId,
        doseNumber: clinicalOrders.doseNumber,
        serviceId: clinicalOrders.serviceId,
        currentScheduledDate: clinicalOrders.currentScheduledDate,
        status: clinicalOrders.status,
        completedAt: clinicalOrders.completedAt,
      })
      .from(clinicalOrders)
      .where(
        and(
          eq(clinicalOrders.tenantId, tenantId),
          eq(clinicalOrders.patientStandingOrderId, pso.id),
          isNull(clinicalOrders.deletedAt),
        ),
      )
      .orderBy(asc(clinicalOrders.doseNumber)),
  )

  const clinicalOrderDisplayIds = coRows.map((r) => r.displayId)

  // Phase 2: read consents from `consents` table (not legacy consent_records).
  // Consents are linked to individual clinical_orders (scope_ref_type='clinical_order').
  // `consents.scopeRefId` stores the display_id (per spec #9: polymorphic FK columns
  // keep text storing the display_id).
  const [psoConsents, statusHistory] = await Promise.all([
    clinicalOrderDisplayIds.length > 0
      ? withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
          tx
            .select()
            .from(consents)
            .where(
              and(
                eq(consents.tenantId, tenantId),
                inArray(consents.scopeRefId, clinicalOrderDisplayIds),
              ),
            )
            .orderBy(asc(consents.obtainedAt)),
        )
      : Promise.resolve([]),
    withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
      tx
        .select()
        .from(patientStandingOrdersStatusHistory)
        .where(
          and(
            eq(patientStandingOrdersStatusHistory.tenantId, tenantId),
            eq(patientStandingOrdersStatusHistory.entityId, pso.id),
          ),
        )
        .orderBy(desc(patientStandingOrdersStatusHistory.changedAt)),
    ),
  ])

  // Strip bigint id from response; surface display_id as `id`.
  const { id: _internal, displayId: psoDisplay, ...rest } = pso
  return {
    id: psoDisplay,
    ...rest,
    clinicalOrders: coRows.map((o) => ({
      id: o.displayId,
      doseNumber: o.doseNumber,
      serviceId: o.serviceId,
      currentScheduledDate: o.currentScheduledDate,
      status: o.status,
      completedAt: o.completedAt,
    })),
    consents: psoConsents,
    statusHistory,
  }
}

// ── External-dose append ──────────────────────────────────────────────────────

export type AppendExternalDoseInput = {
  tenantId: string
  /** PSO display_id. */
  psoId: string
  doseNumber: number
  priorDoseDate: string // YYYY-MM-DD
  /** service_catalog.id (raw code). */
  serviceId: string
  externalClinicianName?: string
  externalClinicName?: string
  externalNotes?: string
  /** Bigint — the creating user's PK. */
  createdById: number
}

/**
 * Insert a single clinical_orders row representing an externally-administered
 * dose. Called inside a withTenantTx so RLS context is already set.
 * The order is inserted directly with status='Completed' to avoid the
 * BEFORE-UPDATE immutability trigger.
 */
export async function appendExternalDoseTx(
  tx: Tx,
  input: AppendExternalDoseInput,
): Promise<{
  id: string
  patientStandingOrderId: string
  serviceId: string
  doseNumber: number | null
  completedAt: Date | null
  status: string
}> {
  const {
    tenantId,
    psoId: psoDisplayId,
    doseNumber,
    priorDoseDate,
    serviceId,
    externalClinicianName,
    externalClinicName,
    externalNotes,
    createdById,
  } = input

  // Resolve PSO display_id → bigint and verify ownership + status.
  const [pso] = await tx
    .select({
      id: patientStandingOrders.id,
      displayId: patientStandingOrders.displayId,
      patientId: patientStandingOrders.patientId,
      status: patientStandingOrders.status,
      templateId: patientStandingOrders.templateId,
    })
    .from(patientStandingOrders)
    .where(
      and(
        eq(patientStandingOrders.tenantId, tenantId),
        eq(patientStandingOrders.displayId, psoDisplayId),
      ),
    )
    .limit(1)

  if (!pso) throw new Error('PSO_NOT_FOUND')
  if (pso.status === 'Discontinued') throw new Error('PSO_DISCONTINUED')

  // Validate doseNumber is within the template's item count.
  const templateItemCount = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(standingOrderTemplateItems)
    .where(
      and(
        eq(standingOrderTemplateItems.tenantId, tenantId),
        eq(standingOrderTemplateItems.templateId, pso.templateId),
      ),
    )
    .then((r) => r[0]?.count ?? 0)

  if (doseNumber < 1 || doseNumber > templateItemCount) {
    throw new Error('DOSE_NUMBER_OUT_OF_RANGE')
  }

  const completedAt = new Date(`${priorDoseDate}T00:00:00.000Z`)

  const [inserted] = await tx
    .insert(clinicalOrders)
    .values({
      displayId: displayId('ORD'),
      tenantId,
      patientStandingOrderId: pso.id,
      patientId: pso.patientId,
      serviceId,
      orderType: 'Standing_Order' as const,
      status: 'Completed' as const,
      originalScheduledDate: completedAt,
      currentScheduledDate: completedAt,
      completedAt,
      doseNumber,
      administeredAtExternalClinic: true,
      externalClinicianName: externalClinicianName ?? null,
      externalClinicName: externalClinicName ?? null,
      externalNotes: externalNotes ?? null,
      createdById,
    })
    .returning({
      internalId: clinicalOrders.id,
      displayId: clinicalOrders.displayId,
      serviceId: clinicalOrders.serviceId,
      doseNumber: clinicalOrders.doseNumber,
      completedAt: clinicalOrders.completedAt,
      status: clinicalOrders.status,
    })

  if (!inserted) throw new Error('FAILED_TO_INSERT_ORDER')

  // CLIN-5: recompute downstream scheduled dates using the external dose as
  // the new anchor so future appointments shift to reflect the actual dose date.
  const sourceForRecompute: RecomputeSource = {
    id: inserted.internalId,
    displayId: inserted.displayId,
    patientStandingOrderId: pso.id,
    doseNumber: inserted.doseNumber,
    serviceId: inserted.serviceId,
    status: 'Completed',
    completedAt: inserted.completedAt,
    currentScheduledDate: inserted.completedAt,
  }
  await applyRecomputeTx(tx, {
    tenantId,
    userId: createdById,
    id: inserted.displayId,
    sourceData: sourceForRecompute,
  })

  return {
    id: inserted.displayId,
    patientStandingOrderId: pso.displayId,
    serviceId: inserted.serviceId,
    doseNumber: inserted.doseNumber,
    completedAt: inserted.completedAt,
    status: inserted.status,
  }
}

// ── Admin template mutations ───────────────────────────────────────────────────

export type UpdateTemplateInput = {
  name?: string
  description?: string | null
  requiresPhysicianAuth?: boolean
  isActive?: boolean
}

/**
 * Update a standing order template in-place (by raw code id).
 * Throws 'TEMPLATE_NOT_FOUND' or 'TEMPLATE_LOCKED' if the template is locked.
 * Must be called inside a withTenantTx transaction.
 */
export async function updateTemplateTx(
  tx: Tx,
  tenantId: string,
  id: string,
  patch: UpdateTemplateInput,
): Promise<typeof standingOrderTemplates.$inferSelect> {
  const [existing] = await tx
    .select({ id: standingOrderTemplates.id, isLocked: standingOrderTemplates.isLocked })
    .from(standingOrderTemplates)
    .where(and(eq(standingOrderTemplates.tenantId, tenantId), eq(standingOrderTemplates.id, id)))
    .limit(1)

  if (!existing) throw new Error('TEMPLATE_NOT_FOUND')
  if (existing.isLocked) throw new Error('TEMPLATE_LOCKED')

  const [updated] = await tx
    .update(standingOrderTemplates)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(standingOrderTemplates.tenantId, tenantId), eq(standingOrderTemplates.id, id)))
    .returning()

  if (!updated) throw new Error('TEMPLATE_NOT_FOUND')
  return updated
}

export type CreateTemplateVersionInput = UpdateTemplateInput

/**
 * Copy-on-write: creates a new template version from an existing one.
 * - New id derived from old code + new version number (raw catalog code)
 * - version = old.version + 1, supersedes_id = old.id, is_locked = false
 * - Old row gets superseded_by_id = new.id
 * - Clones standingOrderTemplateItems rows (each gets a new STI_ display_id)
 *
 * Must be called inside a withTenantTx transaction.
 */
export async function createTemplateVersionTx(
  tx: Tx,
  tenantId: string,
  oldId: string,
  createdById: number,
  patch: CreateTemplateVersionInput,
): Promise<typeof standingOrderTemplates.$inferSelect> {
  // VER-1: Lock the old template row FOR UPDATE so concurrent calls serialize.
  // This prevents two callers from both reading version N and both inserting V(N+1).
  const [old] = await tx
    .select()
    .from(standingOrderTemplates)
    .where(and(eq(standingOrderTemplates.tenantId, tenantId), eq(standingOrderTemplates.id, oldId)))
    .for('update')
    .limit(1)

  if (!old) throw new Error('TEMPLATE_NOT_FOUND')

  const newVersion = old.version + 1

  // Generate new ID: derive from old code + version suffix.
  // Old code might already contain a version suffix (e.g. RABIES_ESSEN_V2), so
  // strip any trailing _Vn before appending. Catalog codes use underscores.
  const baseCode = old.code.replace(/_V\d+$/, '')
  const newCode = `${baseCode}_V${newVersion}`
  // Raw catalog code is the PK (no display_id surfacing on templates).
  const newId = newCode

  // Insert new template row.
  const [newTemplate] = await tx
    .insert(standingOrderTemplates)
    .values({
      id: newId,
      tenantId,
      code: newCode,
      name: patch.name ?? old.name,
      description: patch.description !== undefined ? patch.description : old.description,
      requiresPhysicianAuth:
        patch.requiresPhysicianAuth !== undefined
          ? patch.requiresPhysicianAuth
          : old.requiresPhysicianAuth,
      isActive: patch.isActive !== undefined ? patch.isActive : old.isActive,
      version: newVersion,
      supersedesId: old.id,
      supersededById: null,
      isLocked: false,
      createdById,
    })
    .returning()

  if (!newTemplate) throw new Error('FAILED_TO_CREATE_VERSION')

  // VER-1: Point old template to the new one AND deactivate it atomically.
  // Deactivating here (same transaction) ensures only the new version is
  // isActive=true. Without this, both old and new appear active until the
  // caller manually sets isActive=false on the old row — a window where
  // nurses could start a superseded protocol.
  await tx
    .update(standingOrderTemplates)
    .set({ supersededById: newTemplate.id, isActive: false, updatedAt: sql`now()` })
    .where(and(eq(standingOrderTemplates.tenantId, tenantId), eq(standingOrderTemplates.id, oldId)))

  // Clone template items — each gets a fresh STI_ display_id; bigserial id.
  const oldItems = await tx
    .select()
    .from(standingOrderTemplateItems)
    .where(
      and(
        eq(standingOrderTemplateItems.tenantId, tenantId),
        eq(standingOrderTemplateItems.templateId, oldId),
      ),
    )

  if (oldItems.length > 0) {
    await tx.insert(standingOrderTemplateItems).values(
      oldItems.map((item) => ({
        displayId: displayId('STI'),
        tenantId,
        templateId: newTemplate.id,
        serviceId: item.serviceId,
        dayOffset: item.dayOffset,
        sequence: item.sequence,
        quantity: item.quantity,
        instructions: item.instructions,
      })),
    )
  }

  return newTemplate
}
