import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { and, eq, gte, lte, desc } from 'drizzle-orm'
import { z } from 'zod'
import { withTenantTx, type Tx } from '../../shared/db/withTenantTx.js'
import {
  claims,
  claimItems,
  claimsStatusHistory,
  payerProfiles,
  patients,
  payerContracts,
  encounters,
  transactions,
  transactionItems,
} from '../../shared/db/schema.js'
import { validate } from '../../shared/middleware/validate.js'
import { displayId, prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'

export const adminClaimsRouter: RouterType = Router()

// ── ID schemas (accept display_id surface only) ───────────────────────────────

const claimDisplayIdSchema = prefixedDisplayIdSchema('CLM')
const payerDisplayIdSchema = prefixedDisplayIdSchema('PYR')
const patientDisplayIdSchema = prefixedDisplayIdSchema('PAT')
const contractDisplayIdSchema = prefixedDisplayIdSchema('PCT')
const encounterDisplayIdSchema = prefixedDisplayIdSchema('ENC')
const txnDisplayIdSchema = prefixedDisplayIdSchema('TXN')
const txiDisplayIdSchema = prefixedDisplayIdSchema('TXI')

// ── Zod schemas ───────────────────────────────────────────────────────────────

const claimItemInputSchema = z.object({
  transactionItemId: txiDisplayIdSchema.optional(),
  serviceCode: z.string().max(50).optional(),
  description: z.string().max(255).optional(),
  quantity: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .default('1'),
  chargedAmount: z.string().regex(/^\d+(\.\d+)?$/),
  billedAmount: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(), // alias for chargedAmount
  diagnosisLinkPositions: z.unknown().optional(),
})

const createClaimSchema = z.object({
  payerId: payerDisplayIdSchema,
  patientId: patientDisplayIdSchema.optional(),
  payerContractId: contractDisplayIdSchema.optional(),
  encounterId: encounterDisplayIdSchema.optional(),
  transactionId: txnDisplayIdSchema.optional(),
  externalClaimNumber: z.string().optional(),
  loaNumber: z.string().optional(),
  loaIssuedAt: z.string().datetime().optional(),
  loaExpiresAt: z.string().datetime().optional(),
  diagnosesSnapshot: z.unknown().optional(),
  totalCharged: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  totalBilled: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  items: z.array(claimItemInputSchema).default([]),
})

const VALID_STATUSES = [
  'Draft',
  'Submitted',
  'Acknowledged',
  'InReview',
  'Approved',
  'PartiallyApproved',
  'Denied',
  'Paid',
  'Appealed',
] as const

const statusTransitionSchema = z.object({
  status: z.enum(VALID_STATUSES),
  note: z.string().max(1000).optional(),
  metadata: z.unknown().optional(),
})

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Resolve PYR_ display_id → bigint. Returns null if not found / not in tenant. */
async function resolvePayerId(
  tx: Tx,
  tenantId: string,
  payerDisplayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: payerProfiles.id })
    .from(payerProfiles)
    .where(and(eq(payerProfiles.tenantId, tenantId), eq(payerProfiles.displayId, payerDisplayId)))
    .limit(1)
  return row?.id ?? null
}

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

async function resolveContractId(
  tx: Tx,
  tenantId: string,
  contractDisplayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: payerContracts.id })
    .from(payerContracts)
    .where(
      and(eq(payerContracts.tenantId, tenantId), eq(payerContracts.displayId, contractDisplayId)),
    )
    .limit(1)
  return row?.id ?? null
}

async function resolveEncounterId(
  tx: Tx,
  tenantId: string,
  encounterDisplayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.tenantId, tenantId), eq(encounters.displayId, encounterDisplayId)))
    .limit(1)
  return row?.id ?? null
}

async function resolveTransactionId(
  tx: Tx,
  tenantId: string,
  txnDisplayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.tenantId, tenantId), eq(transactions.displayId, txnDisplayId)))
    .limit(1)
  return row?.id ?? null
}

async function resolveTxItemId(
  tx: Tx,
  tenantId: string,
  txiDisplayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: transactionItems.id })
    .from(transactionItems)
    .where(
      and(eq(transactionItems.tenantId, tenantId), eq(transactionItems.displayId, txiDisplayId)),
    )
    .limit(1)
  return row?.id ?? null
}

/** Resolve CLM_ display_id → bigint. */
async function resolveClaimId(
  tx: Tx,
  tenantId: string,
  claimDisplayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: claims.id })
    .from(claims)
    .where(and(eq(claims.tenantId, tenantId), eq(claims.displayId, claimDisplayId)))
    .limit(1)
  return row?.id ?? null
}

// ── GET /api/admin/claims ──────────────────────────────────────────────────────

// Sane ceiling on the list ?limit= param: protects against an accidental
// unbounded scan while still letting worklist callers ask for a small page.
const MAX_LIST_LIMIT = 500

adminClaimsRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const { status, payerId, patientId, dateFrom, dateTo, limit } = req.query as Record<
    string,
    string | undefined
  >

  const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined
  const effectiveLimit =
    parsedLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_LIST_LIMIT)
      : undefined

  const rows = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const conditions = [eq(claims.tenantId, tenantId)]

    if (status && VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      conditions.push(eq(claims.status, status as (typeof VALID_STATUSES)[number]))
    }
    if (payerId) {
      const parsed = payerDisplayIdSchema.safeParse(payerId)
      if (parsed.success) {
        const internalPayerId = await resolvePayerId(tx, tenantId, parsed.data)
        if (internalPayerId !== null) {
          conditions.push(eq(claims.payerId, internalPayerId))
        } else {
          return []
        }
      }
    }
    if (patientId) {
      const parsed = patientDisplayIdSchema.safeParse(patientId)
      if (parsed.success) {
        const internalPatientId = await resolvePatientId(tx, tenantId, parsed.data)
        if (internalPatientId !== null) {
          conditions.push(eq(claims.patientId, internalPatientId))
        } else {
          return []
        }
      }
    }
    if (dateFrom) {
      conditions.push(gte(claims.createdAt, new Date(dateFrom)))
    }
    if (dateTo) {
      conditions.push(lte(claims.createdAt, new Date(dateTo)))
    }

    const query = tx
      .select({
        id: claims.displayId,
        claimNo: claims.claimNo,
        payerDisplayId: payerProfiles.displayId,
        payerName: payerProfiles.name,
        patientDisplayId: patients.displayId,
        status: claims.status,
        totalBilled: claims.totalBilled,
        totalApproved: claims.totalApproved,
        totalPaid: claims.totalPaid,
        submittedAt: claims.submittedAt,
        createdAt: claims.createdAt,
        updatedAt: claims.updatedAt,
      })
      .from(claims)
      .leftJoin(payerProfiles, eq(payerProfiles.id, claims.payerId))
      .leftJoin(patients, eq(patients.id, claims.patientId))
      .where(and(...conditions))
      .orderBy(desc(claims.createdAt))

    return effectiveLimit !== undefined ? query.limit(effectiveLimit) : query
  })

  res.json(
    rows.map((r) => ({
      id: r.id,
      claimNo: r.claimNo,
      // Back-compat: keep `claimNumber` alias so existing frontend keeps working.
      claimNumber: r.claimNo,
      payerId: r.payerDisplayId,
      payer: r.payerDisplayId ? { id: r.payerDisplayId, name: r.payerName } : null,
      patientId: r.patientDisplayId,
      status: r.status,
      totalBilled: r.totalBilled,
      totalApproved: r.totalApproved,
      totalPaid: r.totalPaid,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      createdAt: r.createdAt?.toISOString() ?? null,
      updatedAt: r.updatedAt?.toISOString() ?? null,
    })),
  )
})

// ── POST /api/admin/claims ─────────────────────────────────────────────────────

adminClaimsRouter.post('/', validate(createClaimSchema), async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const userId = req.tenant.userId
  const branchId = req.tenant.branchId
  if (userId === null) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
    return
  }
  const body = req.body as z.infer<typeof createClaimSchema>

  if (!body.patientId) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'INVALID_INPUT',
      details: { patientId: ['patientId is required (NOT NULL FK to patients)'] },
    })
    return
  }

  // All resolution and inserts run in one withTenantTx so the RLS GUC is set.
  const result = await withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [
      internalPayerId,
      internalPatientId,
      internalContractId,
      internalEncounterId,
      internalTransactionId,
    ] = await Promise.all([
      resolvePayerId(tx, tenantId, body.payerId),
      resolvePatientId(tx, tenantId, body.patientId!),
      body.payerContractId
        ? resolveContractId(tx, tenantId, body.payerContractId)
        : Promise.resolve(null),
      body.encounterId ? resolveEncounterId(tx, tenantId, body.encounterId) : Promise.resolve(null),
      body.transactionId
        ? resolveTransactionId(tx, tenantId, body.transactionId)
        : Promise.resolve(null),
    ])

    if (internalPayerId === null)
      return {
        ok: false as const,
        error: 'Unknown payerId',
        code: 'INVALID_PAYER',
        httpStatus: 400,
      }
    if (internalPatientId === null)
      return {
        ok: false as const,
        error: 'Unknown patientId',
        code: 'INVALID_PATIENT',
        httpStatus: 400,
      }
    if (body.payerContractId && internalContractId === null)
      return {
        ok: false as const,
        error: 'Unknown payerContractId',
        code: 'INVALID_CONTRACT',
        httpStatus: 400,
      }
    if (body.encounterId && internalEncounterId === null)
      return {
        ok: false as const,
        error: 'Unknown encounterId',
        code: 'INVALID_ENCOUNTER',
        httpStatus: 400,
      }
    if (body.transactionId && internalTransactionId === null)
      return {
        ok: false as const,
        error: 'Unknown transactionId',
        code: 'INVALID_TRANSACTION',
        httpStatus: 400,
      }

    // Pre-resolve transaction-item display_ids → bigint for items.
    // Items without a transactionItemId would fail the FK; silently skip those rows.
    const resolvedItems = await Promise.all(
      body.items.map(async (item) => {
        if (!item.transactionItemId) return null
        const txiId = await resolveTxItemId(tx, tenantId, item.transactionItemId)
        if (txiId === null) return null
        return { input: item, transactionItemId: txiId }
      }),
    )

    const claimDisplayId = displayId('CLM')
    // Default claim_no to the display id for auto-generation (BIR format TBD).
    const claimNo = claimDisplayId
    const totalBilled = body.totalBilled ?? body.totalCharged ?? '0.00'

    const [newClaim] = await tx
      .insert(claims)
      .values({
        displayId: claimDisplayId,
        tenantId,
        payerId: internalPayerId,
        payerContractId: internalContractId,
        patientId: internalPatientId,
        encounterId: internalEncounterId,
        transactionId: internalTransactionId,
        claimNo,
        externalClaimNumber: body.externalClaimNumber ?? null,
        status: 'Draft',
        loaNumber: body.loaNumber ?? null,
        loaIssuedAt: body.loaIssuedAt ? new Date(body.loaIssuedAt) : null,
        loaExpiresAt: body.loaExpiresAt ? new Date(body.loaExpiresAt) : null,
        diagnosesSnapshot: body.diagnosesSnapshot ? JSON.stringify(body.diagnosesSnapshot) : null,
        totalBilled,
        createdById: userId,
      })
      .returning({ id: claims.id })

    const claimIdInternal = newClaim!.id

    for (const item of resolvedItems) {
      if (!item) continue
      const billedAmt = item.input.billedAmount ?? item.input.chargedAmount
      await tx.insert(claimItems).values({
        displayId: displayId('CLI'),
        tenantId,
        claimId: claimIdInternal,
        transactionItemId: item.transactionItemId,
        serviceCode: item.input.serviceCode ?? null,
        diagnosisLinkPositions: item.input.diagnosisLinkPositions
          ? JSON.stringify(item.input.diagnosisLinkPositions)
          : null,
        quantity: item.input.quantity,
        billedAmount: billedAmt,
        createdById: userId,
      })
    }

    return { ok: true as const, id: claimDisplayId, claimNo, status: 'Draft' as const }
  })

  if (!result.ok) {
    res.status(result.httpStatus).json({ error: result.error, code: result.code })
    return
  }
  res.status(201).json({
    id: result.id,
    claimNo: result.claimNo,
    status: result.status,
    // Back-compat alias.
    claimNumber: result.claimNo,
  })
})

// ── GET /api/admin/claims/:id ──────────────────────────────────────────────────

adminClaimsRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const parseId = claimDisplayIdSchema.safeParse(req.params['id'])
  if (!parseId.success) {
    res.status(400).json({ error: 'Invalid claim id', code: 'BAD_REQUEST' })
    return
  }
  const claimDisplayIdValue = parseId.data

  const detail = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [header] = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.tenantId, tenantId), eq(claims.displayId, claimDisplayIdValue)))
      .limit(1)

    if (!header) return null

    const internalId = header.id

    const [items, statusHistory, payerRow, patientRow] = await Promise.all([
      tx
        .select({
          id: claimItems.displayId,
          transactionItemDisplayId: transactionItems.displayId,
          serviceCode: claimItems.serviceCode,
          diagnosisLinkPositions: claimItems.diagnosisLinkPositions,
          quantity: claimItems.quantity,
          billedAmount: claimItems.billedAmount,
          approvedAmount: claimItems.approvedAmount,
          deniedAmount: claimItems.deniedAmount,
          denialCode: claimItems.denialCode,
          createdAt: claimItems.createdAt,
        })
        .from(claimItems)
        .leftJoin(transactionItems, eq(transactionItems.id, claimItems.transactionItemId))
        .where(and(eq(claimItems.claimId, internalId), eq(claimItems.tenantId, tenantId))),
      tx
        .select()
        .from(claimsStatusHistory)
        .where(
          and(
            eq(claimsStatusHistory.entityId, internalId),
            eq(claimsStatusHistory.tenantId, tenantId),
          ),
        )
        .orderBy(desc(claimsStatusHistory.changedAt)),
      header.payerId
        ? tx
            .select({ displayId: payerProfiles.displayId, name: payerProfiles.name })
            .from(payerProfiles)
            .where(eq(payerProfiles.id, header.payerId))
            .limit(1)
        : Promise.resolve([] as { displayId: string; name: string }[]),
      header.patientId
        ? tx
            .select({ displayId: patients.displayId })
            .from(patients)
            .where(eq(patients.id, header.patientId))
            .limit(1)
        : Promise.resolve([] as { displayId: string }[]),
    ])

    // Resolve optional FKs to display_id strings for the response surface.
    const [contractRow, encounterRow, transactionRow] = await Promise.all([
      header.payerContractId
        ? tx
            .select({ displayId: payerContracts.displayId })
            .from(payerContracts)
            .where(eq(payerContracts.id, header.payerContractId))
            .limit(1)
        : Promise.resolve([] as { displayId: string }[]),
      header.encounterId
        ? tx
            .select({ displayId: encounters.displayId })
            .from(encounters)
            .where(eq(encounters.id, header.encounterId))
            .limit(1)
        : Promise.resolve([] as { displayId: string }[]),
      header.transactionId
        ? tx
            .select({ displayId: transactions.displayId })
            .from(transactions)
            .where(eq(transactions.id, header.transactionId))
            .limit(1)
        : Promise.resolve([] as { displayId: string }[]),
    ])

    return {
      id: header.displayId,
      tenantId: header.tenantId,
      claimNo: header.claimNo,
      // Back-compat alias.
      claimNumber: header.claimNo,
      externalClaimNumber: header.externalClaimNumber,
      payerId: payerRow[0]?.displayId ?? null,
      payer: payerRow[0] ? { id: payerRow[0].displayId, name: payerRow[0].name } : null,
      payerContractId: contractRow[0]?.displayId ?? null,
      patientId: patientRow[0]?.displayId ?? null,
      encounterId: encounterRow[0]?.displayId ?? null,
      transactionId: transactionRow[0]?.displayId ?? null,
      status: header.status,
      loaNumber: header.loaNumber,
      loaIssuedAt: header.loaIssuedAt?.toISOString() ?? null,
      loaExpiresAt: header.loaExpiresAt?.toISOString() ?? null,
      diagnosesSnapshot: header.diagnosesSnapshot,
      totalBilled: header.totalBilled,
      totalApproved: header.totalApproved,
      totalDenied: header.totalDenied,
      totalPaid: header.totalPaid,
      patientResponsibility: header.patientResponsibility,
      submittedAt: header.submittedAt?.toISOString() ?? null,
      acknowledgedAt: header.acknowledgedAt?.toISOString() ?? null,
      decisionAt: header.decisionAt?.toISOString() ?? null,
      paidAt: header.paidAt?.toISOString() ?? null,
      denialCode: header.denialCode,
      denialReason: header.denialReason,
      appealNotes: header.appealNotes,
      rowVersion: header.rowVersion,
      createdById: header.createdById,
      createdAt: header.createdAt?.toISOString() ?? null,
      updatedAt: header.updatedAt?.toISOString() ?? null,
      items: items.map((i) => ({
        id: i.id,
        transactionItemId: i.transactionItemDisplayId,
        serviceCode: i.serviceCode,
        diagnosisLinkPositions: i.diagnosisLinkPositions,
        quantity: i.quantity,
        billedAmount: i.billedAmount,
        approvedAmount: i.approvedAmount,
        deniedAmount: i.deniedAmount,
        denialCode: i.denialCode,
        createdAt: i.createdAt?.toISOString() ?? null,
      })),
      statusHistory: statusHistory.map((h) => ({
        // History rows are bigserial-only; surface the bigint as a string.
        id: String(h.id),
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        reason: h.reason,
        changedAt: h.changedAt?.toISOString() ?? null,
        changedById: h.changedById,
        metadata: h.metadata,
      })),
    }
  })

  if (!detail) {
    res.status(404).json({ error: 'Claim not found', code: 'NOT_FOUND' })
    return
  }
  res.json(detail)
})

// ── PUT /api/admin/claims/:id/status ──────────────────────────────────────────

adminClaimsRouter.put(
  '/:id/status',
  validate(statusTransitionSchema),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    const branchId = req.tenant.branchId
    if (userId === null) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }
    const parseId = claimDisplayIdSchema.safeParse(req.params['id'])
    if (!parseId.success) {
      res.status(400).json({ error: 'Invalid claim id', code: 'BAD_REQUEST' })
      return
    }
    const claimDisplayIdValue = parseId.data
    const body = req.body as z.infer<typeof statusTransitionSchema>

    const updated = await withTenantTx({ tenantId, userId, branchId }, async (tx) => {
      const internalId = await resolveClaimId(tx, tenantId, claimDisplayIdValue)
      if (internalId === null) return null

      const [existing] = await tx
        .select({ id: claims.id, status: claims.status })
        .from(claims)
        .where(and(eq(claims.id, internalId), eq(claims.tenantId, tenantId)))
        .limit(1)

      if (!existing) return null

      const now = new Date()
      const statusUpdate: Record<string, unknown> = {
        status: body.status,
        updatedAt: now,
      }
      // Set timestamp columns that track specific status milestones
      if (body.status === 'Submitted') statusUpdate['submittedAt'] = now
      if (body.status === 'Acknowledged') statusUpdate['acknowledgedAt'] = now
      if (
        body.status === 'Approved' ||
        body.status === 'Denied' ||
        body.status === 'PartiallyApproved'
      ) {
        statusUpdate['decisionAt'] = now
      }
      if (body.status === 'Paid') statusUpdate['paidAt'] = now

      await tx
        .update(claims)
        .set(statusUpdate)
        .where(and(eq(claims.id, internalId), eq(claims.tenantId, tenantId)))

      await tx.insert(claimsStatusHistory).values({
        tenantId,
        entityId: internalId,
        fromStatus: existing.status,
        toStatus: body.status,
        reason: body.note ?? null,
        changedById: userId,
        metadata: body.metadata ? JSON.stringify(body.metadata) : null,
      })

      return existing
    })

    if (!updated) {
      res.status(404).json({ error: 'Claim not found', code: 'NOT_FOUND' })
      return
    }
    res.json({ ok: true, id: claimDisplayIdValue, status: body.status })
  },
)
