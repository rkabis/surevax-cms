import { and, desc, eq, isNull, isNotNull, ilike, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import {
  productRecalls,
  products,
  inventoryLots,
  branches,
  users,
  notificationTemplates,
} from '../../shared/db/schema.js'
import { displayId } from '../../shared/utils/displayId.js'
import { logger } from '../../shared/utils/logger.js'

// Post-0011: recalls are scoped by physical product (Abhayrab, Speeda, …)
// rather than a single service variant. A recall with NULL productId matches
// any product when the affected_lots_pattern hits.

export type CreateRecallInput = {
  tenantId: string
  userId: number
  /** display_id of the product (PRD_<8 base32>) — resolved to bigint internally */
  productDisplayId?: string | null
  manufacturer?: string | null
  affectedLotsPattern?: string | null
  recallReason: string
  recallSeverity: string
  issuedAt: Date
  patientNotificationRequired?: boolean
}

export type UpdateRecallInput = {
  recallReason?: string
  recallSeverity?: string
  manufacturer?: string | null
  affectedLotsPattern?: string | null
  resolvedAt?: Date | null
  patientNotificationRequired?: boolean
}

export type ListRecallsOptions = {
  tenantId: string
  /** display_id of the product to filter by (resolved to bigint internally) */
  productDisplayId?: string
  severity?: string
  active?: boolean
  limit?: number
}

// ---------------------------------------------------------------------------
// Public row shape — internal bigint id is never returned to callers.
// display_id is surfaced as the public `id` field.
// ---------------------------------------------------------------------------

type RecallPublic = {
  id: string // display_id (RCL_<8 base32>)
  tenantId: string
  productId: string | null
  productName: string | null
  manufacturer: string | null
  affectedLotsPattern: string | null
  recallReason: string
  recallSeverity: string
  issuedAt: string
  resolvedAt: string | null
  patientNotificationRequired: boolean
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: { displayId: string; firstName: string; lastName: string } | null
}

function mapRecall(r: {
  displayId: string
  tenantId: string
  productInternalId: number | null
  productDisplayId: string | null
  manufacturer: string | null
  affectedLotsPattern: string | null
  recallReason: string
  recallSeverity: string
  issuedAt: Date
  resolvedAt: Date | null
  patientNotificationRequired: boolean
  rowVersion: number
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
  productName: string | null
  createdByDisplayId?: string | null
  createdByFirstName?: string | null
  createdByLastName?: string | null
}): RecallPublic {
  return {
    id: r.displayId,
    tenantId: r.tenantId,
    productId: r.productDisplayId ?? null,
    productName: r.productName ?? null,
    manufacturer: r.manufacturer ?? null,
    affectedLotsPattern: r.affectedLotsPattern ?? null,
    recallReason: r.recallReason,
    recallSeverity: r.recallSeverity,
    issuedAt: r.issuedAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    patientNotificationRequired: r.patientNotificationRequired,
    rowVersion: r.rowVersion,
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy:
      r.createdByDisplayId != null
        ? {
            displayId: r.createdByDisplayId,
            firstName: r.createdByFirstName ?? '',
            lastName: r.createdByLastName ?? '',
          }
        : null,
  }
}

// createdByUser alias for getRecall detail query (list query uses RECALL_SELECT without the join)
const createdByUserAlias = alias(users, 'created_by_user')

// Shared Drizzle select projection for recall + product join (list only — no createdBy)
const RECALL_SELECT = {
  displayId: productRecalls.displayId,
  tenantId: productRecalls.tenantId,
  productInternalId: productRecalls.productId,
  productDisplayId: products.displayId,
  manufacturer: productRecalls.manufacturer,
  affectedLotsPattern: productRecalls.affectedLotsPattern,
  recallReason: productRecalls.recallReason,
  recallSeverity: productRecalls.recallSeverity,
  issuedAt: productRecalls.issuedAt,
  resolvedAt: productRecalls.resolvedAt,
  patientNotificationRequired: productRecalls.patientNotificationRequired,
  rowVersion: productRecalls.rowVersion,
  deletedAt: productRecalls.deletedAt,
  createdAt: productRecalls.createdAt,
  updatedAt: productRecalls.updatedAt,
  productName: products.name,
} as const

// Extended projection for detail endpoint (includes createdBy join)
const RECALL_DETAIL_SELECT = {
  ...RECALL_SELECT,
  createdByDisplayId: createdByUserAlias.displayId,
  createdByFirstName: createdByUserAlias.firstName,
  createdByLastName: createdByUserAlias.lastName,
} as const

export async function listRecalls(opts: ListRecallsOptions) {
  const { tenantId, productDisplayId, severity, active, limit = 50 } = opts
  const cap = Math.min(limit, 200)

  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const conditions = [eq(productRecalls.tenantId, tenantId), isNull(productRecalls.deletedAt)]

    if (productDisplayId) {
      // Resolve product display_id → bigint
      const [prd] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.displayId, productDisplayId)))
        .limit(1)
      if (prd) {
        conditions.push(eq(productRecalls.productId, prd.id))
      } else {
        return [] // Unknown product — no matches
      }
    }
    if (severity) conditions.push(eq(productRecalls.recallSeverity, severity))
    if (active === true) conditions.push(isNull(productRecalls.resolvedAt))
    if (active === false) conditions.push(isNotNull(productRecalls.resolvedAt))

    const rows = await tx
      .select(RECALL_SELECT)
      .from(productRecalls)
      .leftJoin(products, eq(productRecalls.productId, products.id))
      .where(and(...conditions))
      .orderBy(desc(productRecalls.issuedAt))
      .limit(cap)

    return rows.map(mapRecall)
  })
}

export async function getRecall(tenantId: string, recallDisplayId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select(RECALL_DETAIL_SELECT)
      .from(productRecalls)
      .leftJoin(products, eq(productRecalls.productId, products.id))
      .leftJoin(createdByUserAlias, eq(createdByUserAlias.id, productRecalls.createdById))
      .where(
        and(
          eq(productRecalls.tenantId, tenantId),
          eq(productRecalls.displayId, recallDisplayId),
          isNull(productRecalls.deletedAt),
        ),
      )
      .limit(1)

    if (!row) return null

    // Affected lots — batch_number ILIKE '%pattern%', optionally restricted to
    // matching product_id.
    let affectedLots: {
      id: string // lot display_id
      batchNumber: string
      expiryDate: string
      branchId: string
    }[] = []

    if (row.affectedLotsPattern) {
      // INV-4: escape LIKE metacharacters in the user-supplied pattern so that
      // a batch number containing '%', '_', or '\' is matched literally.
      const escapedPattern = row.affectedLotsPattern
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
      // RECALL-2: use an anchored pattern (ILIKE 'pattern%' prefix match) so that
      // the SQL query doesn't match unrelated lots. Lot batch numbers for a given
      // recall follow a manufacturer prefix convention — matching the leading prefix
      // is sufficient and avoids false positives from substring matches.
      // When productId is NULL (wildcard recall), also scope to tenant only —
      // branch scope is not applied here because a product recall is tenant-wide
      // (a recalled batch affects all branches that hold that lot).
      const pattern = `${escapedPattern}%`
      const lotConditions = [
        eq(inventoryLots.tenantId, tenantId),
        ilike(inventoryLots.batchNumber, pattern),
      ]

      if (row.productInternalId) {
        lotConditions.push(eq(inventoryLots.productId, row.productInternalId))
      }

      const lots = await tx
        .select({
          id: inventoryLots.displayId, // surface display_id as public id
          batchNumber: inventoryLots.batchNumber,
          expiryDate: inventoryLots.expiryDate,
          branchId: branches.displayId,
        })
        .from(inventoryLots)
        .innerJoin(
          branches,
          and(eq(branches.tenantId, tenantId), eq(branches.id, inventoryLots.branchId)),
        )
        .where(and(...lotConditions))
        .limit(200)

      affectedLots = lots.map((l) => ({
        id: l.id,
        batchNumber: l.batchNumber,
        expiryDate: l.expiryDate,
        branchId: l.branchId,
      }))
    }

    return { ...mapRecall(row), affectedLots }
  })
}

export async function createRecall(input: CreateRecallInput) {
  const { tenantId, userId } = input
  const newDisplayId = displayId('RCL')

  await withTenantTx({ tenantId, userId, branchId: null }, async (tx) => {
    // Resolve product display_id → bigint if provided
    let resolvedProductId: number | null = null
    if (input.productDisplayId) {
      const [prd] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.displayId, input.productDisplayId)))
        .limit(1)
      if (!prd) {
        throw Object.assign(new Error('Product not found'), { statusCode: 404, code: 'NOT_FOUND' })
      }
      resolvedProductId = prd.id
    }

    await tx.insert(productRecalls).values({
      displayId: newDisplayId,
      tenantId,
      productId: resolvedProductId,
      manufacturer: input.manufacturer ?? null,
      affectedLotsPattern: input.affectedLotsPattern ?? null,
      recallReason: input.recallReason,
      recallSeverity: input.recallSeverity,
      issuedAt: input.issuedAt,
      patientNotificationRequired: input.patientNotificationRequired ?? true,
      createdById: userId,
    })
  })

  return newDisplayId
}

export async function updateRecall(
  tenantId: string,
  userId: number,
  recallDisplayId: string,
  input: UpdateRecallInput,
) {
  return withTenantTx({ tenantId, userId, branchId: null }, async (tx) => {
    const [existing] = await tx
      .select({ id: productRecalls.id, rowVersion: productRecalls.rowVersion })
      .from(productRecalls)
      .where(
        and(
          eq(productRecalls.tenantId, tenantId),
          eq(productRecalls.displayId, recallDisplayId),
          isNull(productRecalls.deletedAt),
        ),
      )
      .limit(1)

    if (!existing) return false

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
      rowVersion: sql`${productRecalls.rowVersion} + 1`,
    }

    if (input.recallReason !== undefined) updates.recallReason = input.recallReason
    if (input.recallSeverity !== undefined) updates.recallSeverity = input.recallSeverity
    if ('manufacturer' in input) updates.manufacturer = input.manufacturer ?? null
    if ('affectedLotsPattern' in input)
      updates.affectedLotsPattern = input.affectedLotsPattern ?? null
    if ('resolvedAt' in input) updates.resolvedAt = input.resolvedAt ?? null
    if (input.patientNotificationRequired !== undefined)
      updates.patientNotificationRequired = input.patientNotificationRequired

    await tx
      .update(productRecalls)
      .set(updates)
      .where(and(eq(productRecalls.tenantId, tenantId), eq(productRecalls.id, existing.id)))

    return true
  })
}

export async function softDeleteRecall(tenantId: string, userId: number, recallDisplayId: string) {
  return withTenantTx({ tenantId, userId, branchId: null }, async (tx) => {
    const [existing] = await tx
      .select({ id: productRecalls.id })
      .from(productRecalls)
      .where(
        and(
          eq(productRecalls.tenantId, tenantId),
          eq(productRecalls.displayId, recallDisplayId),
          isNull(productRecalls.deletedAt),
        ),
      )
      .limit(1)

    if (!existing) return false

    await tx
      .update(productRecalls)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(productRecalls.tenantId, tenantId), eq(productRecalls.id, existing.id)))

    return true
  })
}

/**
 * For a given inventory lot (by display_id), return all active (unresolved, not deleted) recalls
 * whose pattern matches the lot's batch_number AND whose productId matches
 * the lot's product_id (or is NULL = applies to all products).
 */
export async function getRecallMatchesForLot(
  tenantId: string,
  lotDisplayId: string,
): Promise<{
  lot: { id: string; batchNumber: string; productId: number } | null
  matches: { id: string; recallReason: string; recallSeverity: string; issuedAt: string }[]
}> {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [lot] = await tx
      .select({
        id: inventoryLots.displayId, // surface display_id as public id
        batchNumber: inventoryLots.batchNumber,
        productId: inventoryLots.productId,
      })
      .from(inventoryLots)
      .where(and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.displayId, lotDisplayId)))
      .limit(1)

    if (!lot) return { lot: null, matches: [] }

    const activeRecalls = await tx
      .select({
        id: productRecalls.displayId, // surface display_id as public id
        recallReason: productRecalls.recallReason,
        recallSeverity: productRecalls.recallSeverity,
        issuedAt: productRecalls.issuedAt,
        affectedLotsPattern: productRecalls.affectedLotsPattern,
        productId: productRecalls.productId,
      })
      .from(productRecalls)
      .where(
        and(
          eq(productRecalls.tenantId, tenantId),
          isNull(productRecalls.resolvedAt),
          isNull(productRecalls.deletedAt),
          or(isNull(productRecalls.productId), eq(productRecalls.productId, lot.productId)),
        ),
      )

    const batchLower = lot.batchNumber.toLowerCase()
    const matches = activeRecalls
      .filter((r) => {
        // A product-scoped recall without a batch prefix covers every lot for
        // that product. A recall with neither product nor prefix is not a lot
        // match.
        if (!r.affectedLotsPattern) return r.productId === lot.productId
        // INV-4: JS match must agree with the SQL ILIKE prefix match.
        // SQL uses 'pattern%' (anchored at start, after escaping metacharacters).
        // JS mirrors that by checking startsWith() on the lowercased batch number.
        return batchLower.startsWith(r.affectedLotsPattern.toLowerCase())
      })
      .map((r) => ({
        id: r.id,
        recallReason: r.recallReason,
        recallSeverity: r.recallSeverity,
        issuedAt: r.issuedAt.toISOString(),
      }))

    return { lot, matches }
  })
}

// ---------------------------------------------------------------------------
// RECALL-1 — patient notification fan-out
// ---------------------------------------------------------------------------

/**
 * fanOutRecallNotifications
 *
 * For a given product recall, finds all patients who received a dose from an
 * affected lot (via clinical_orders.lot_id) and enqueues a notification row
 * per affected patient when `patient_notification_required` is true.
 *
 * Idempotent: a notification row is only created when no existing notification
 * for the same (tenant, recallId, patientId) pair exists in the metadata, so
 * re-running on the same recall is safe.
 *
 * Consent gate: patients whose consent has been revoked are skipped (PHI
 * messaging requires active consent per DPA §19).
 *
 * Contact channel: SMS if the patient has sms_opt_in + contactNumber; then
 * Email if emailOptIn + email; otherwise the patient is skipped.
 *
 * Template: looks for code = 'recall_patient_notification' for the tenant.
 * If no such template exists, all patients are skipped with a warning.
 *
 * @returns The number of newly enqueued notifications.
 */
export async function fanOutRecallNotifications(
  tenantId: string,
  recallDisplayId: string,
): Promise<number> {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    // 1. Load the recall.
    const [recall] = await tx
      .select({
        id: productRecalls.id,
        displayId: productRecalls.displayId,
        productId: productRecalls.productId,
        affectedLotsPattern: productRecalls.affectedLotsPattern,
        patientNotificationRequired: productRecalls.patientNotificationRequired,
        recallReason: productRecalls.recallReason,
        recallSeverity: productRecalls.recallSeverity,
      })
      .from(productRecalls)
      .where(
        and(
          eq(productRecalls.tenantId, tenantId),
          eq(productRecalls.displayId, recallDisplayId),
          isNull(productRecalls.deletedAt),
        ),
      )
      .limit(1)

    if (!recall) {
      logger.warn({ tenantId, recallDisplayId }, '[recall-fanout] recall not found — skipping')
      return 0
    }

    if (!recall.patientNotificationRequired) {
      logger.info(
        { tenantId, recallDisplayId },
        '[recall-fanout] patientNotificationRequired=false — skipping fan-out',
      )
      return 0
    }

    // 2. Resolve affected lot IDs for this recall.
    //    Mirrors the ILIKE prefix logic from getRecall.
    let affectedLotIds: number[] = []

    if (recall.affectedLotsPattern) {
      const escapedPattern = recall.affectedLotsPattern
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
      const pattern = `${escapedPattern}%`

      const lotConditions = [
        eq(inventoryLots.tenantId, tenantId),
        ilike(inventoryLots.batchNumber, pattern),
      ]
      if (recall.productId) {
        lotConditions.push(eq(inventoryLots.productId, recall.productId))
      }

      const lots = await tx
        .select({ id: inventoryLots.id })
        .from(inventoryLots)
        .where(and(...lotConditions))
        .limit(1000)

      affectedLotIds = lots.map((l) => l.id)
    } else if (recall.productId) {
      // No pattern but a product: all lots for that product are affected.
      const lots = await tx
        .select({ id: inventoryLots.id })
        .from(inventoryLots)
        .where(
          and(eq(inventoryLots.tenantId, tenantId), eq(inventoryLots.productId, recall.productId)),
        )
        .limit(1000)
      affectedLotIds = lots.map((l) => l.id)
    }

    if (affectedLotIds.length === 0) {
      logger.info(
        { tenantId, recallDisplayId },
        '[recall-fanout] no affected lots found — skipping fan-out',
      )
      return 0
    }

    // 3. Resolve notification template for recalls.
    const [template] = await tx
      .select({
        id: notificationTemplates.id,
        channel: notificationTemplates.channel,
        subject: notificationTemplates.subject,
        body: notificationTemplates.body,
      })
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.tenantId, tenantId),
          eq(notificationTemplates.code, 'recall_patient_notification'),
          eq(notificationTemplates.isActive, true),
          isNull(notificationTemplates.deletedAt),
        ),
      )
      .orderBy(notificationTemplates.id)
      .limit(1)

    if (!template) {
      logger.warn(
        { tenantId, recallDisplayId },
        '[recall-fanout] no active recall_patient_notification template found — skipping fan-out',
      )
      return 0
    }

    // 4. Find distinct patients who received a dose from an affected lot.
    //    Scope to Completed clinical_orders only (actual administrations).
    //    Use raw SQL for the IN clause over a potentially large lot set.
    const lotIdList = affectedLotIds.join(',')
    const affectedPatientRows = await tx.execute<{
      patientId: string
      firstName: string | null
      lastName: string | null
      contactNumber: string | null
      email: string | null
      smsOptIn: boolean
      emailOptIn: boolean
    }>(sql`
      SELECT DISTINCT
        p.id             AS "patientId",
        p.first_name     AS "firstName",
        p.last_name      AS "lastName",
        p.contact_number AS "contactNumber",
        p.email,
        p.sms_opt_in     AS "smsOptIn",
        p.email_opt_in   AS "emailOptIn"
      FROM clinical_orders co
      JOIN patients p
        ON p.id = co.patient_id
       AND p.tenant_id = ${tenantId}
       AND p.deleted_at IS NULL
      WHERE co.tenant_id = ${tenantId}
        AND co.status    = 'Completed'
        AND co.deleted_at IS NULL
        AND co.lot_id    IN (${sql.raw(lotIdList)})
    `)

    if (affectedPatientRows.length === 0) {
      logger.info(
        { tenantId, recallDisplayId, affectedLots: affectedLotIds.length },
        '[recall-fanout] no patients found for affected lots',
      )
      return 0
    }

    // 5. For each affected patient: check consent + opt-in, check idempotency,
    //    then insert a Queued notification row.
    let enqueued = 0
    const recallIdStr = String(recall.id)

    for (const patient of affectedPatientRows) {
      const patientId = Number(patient.patientId)
      const channel = template.channel ?? 'SMS'

      // Consent gate: skip patients whose consent has been revoked.
      const consentRows = await tx.execute<{ id: string }>(sql`
        SELECT id FROM consents
        WHERE tenant_id  = ${tenantId}
          AND patient_id = ${patientId}
          AND revoked_at IS NULL
          AND deleted_at IS NULL
        LIMIT 1
      `)

      if (!consentRows[0]) {
        logger.debug(
          { tenantId, recallDisplayId, patientId },
          '[recall-fanout] patient has no active consent — skipping',
        )
        continue
      }

      // Contact address + opt-in check.
      const recipientAddress: string | null =
        channel === 'Email'
          ? patient.emailOptIn
            ? (patient.email ?? null)
            : null
          : patient.smsOptIn
            ? (patient.contactNumber ?? null)
            : null

      if (!recipientAddress) {
        logger.debug(
          { tenantId, recallDisplayId, patientId, channel },
          '[recall-fanout] patient has no reachable address or has opted out — skipping',
        )
        continue
      }

      // Idempotency guard: skip if already notified for this recall.
      const existingRows = await tx.execute<{ id: string }>(sql`
        SELECT id FROM notifications
        WHERE tenant_id = ${tenantId}
          AND patient_id = ${patientId}
          AND metadata->>'recallId' = ${recallIdStr}
        LIMIT 1
      `)

      if (existingRows[0]) {
        logger.debug(
          { tenantId, recallDisplayId, patientId, existingId: existingRows[0].id },
          '[recall-fanout] already notified — skipping duplicate',
        )
        continue
      }

      // Build message body.
      const firstName = patient.firstName ?? ''
      const body = (template.body ?? '').replace(
        /\{\{([\w.]+)\}\}/g,
        (_match: string, key: string) => {
          const flat: Record<string, string> = {
            'patient.firstName': firstName,
            'patient.lastName': patient.lastName ?? '',
            'recall.reason': recall.recallReason,
            'recall.severity': recall.recallSeverity,
            'recall.id': recall.displayId,
          }
          return flat[key] ?? `{{${key}}}`
        },
      )

      const subject = template.subject
        ? template.subject.replace(/\{\{([\w.]+)\}\}/g, (_match: string, key: string) => {
            const flat: Record<string, string> = {
              'recall.severity': recall.recallSeverity,
            }
            return flat[key] ?? `{{${key}}}`
          })
        : null

      await tx.execute(sql`
        INSERT INTO notifications (
          tenant_id, template_id, patient_id,
          channel, recipient_address, subject, body,
          status,
          consent_verified_at,
          metadata,
          created_at, updated_at
        ) VALUES (
          ${tenantId},
          ${template.id},
          ${patientId},
          ${channel},
          ${recipientAddress},
          ${subject},
          ${body},
          'Queued',
          now(),
          ${JSON.stringify({
            recallId: recallIdStr,
            recallDisplayId: recall.displayId,
            source: 'recall_fanout',
          })}::jsonb,
          now(), now()
        )
      `)

      enqueued++
    }

    logger.info(
      { tenantId, recallDisplayId, enqueued, candidates: affectedPatientRows.length },
      '[recall-fanout] fan-out complete',
    )

    return enqueued
  })
}
