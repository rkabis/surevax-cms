import { and, eq, desc, isNull, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  payerProfiles,
  payerContracts,
  payerPriceAdjustmentExclusions,
  serviceCatalog,
  users,
} from '../../shared/db/schema.js'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { displayId } from '../../shared/utils/displayId.js'

export class PayerProfileNotFoundError extends Error {
  constructor() {
    super('Payer profile not found')
    this.name = 'PayerProfileNotFoundError'
  }
}

type PayerType = 'HMO' | 'Corporate' | 'Government' | 'Promo'

type PayerProfileRow = {
  id: string
  name: string
  payerType: PayerType
  contactName: string | null
  contactNumber: string | null
  email: string | null
  paymentTermsDays: number | null
  isActive: boolean
  createdAt: string
}

export async function listPayerProfiles(opts: {
  tenantId: string
  payerType?: PayerType
}): Promise<PayerProfileRow[]> {
  const conditions = [eq(payerProfiles.tenantId, opts.tenantId)]
  if (opts.payerType) {
    conditions.push(eq(payerProfiles.payerType, opts.payerType))
  }

  const rows = await withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: null },
    async (tx) =>
      tx
        .select({
          // Surface display_id as the public `id` field — never leak bigint.
          id: payerProfiles.displayId,
          name: payerProfiles.name,
          payerType: payerProfiles.payerType,
          contactName: payerProfiles.contactName,
          contactNumber: payerProfiles.contactNumber,
          email: payerProfiles.email,
          paymentTermsDays: payerProfiles.paymentTermsDays,
          isActive: payerProfiles.isActive,
          createdAt: payerProfiles.createdAt,
        })
        .from(payerProfiles)
        .where(and(...conditions))
        .orderBy(desc(payerProfiles.createdAt)),
  )

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }))
}

/**
 * Resolve a payer's display_id to its bigint PK + canonical row, scoped to tenant.
 * Returns `null` when no match — callers should 404.
 */
async function resolvePayerByDisplayId(opts: { tenantId: string; displayId: string }) {
  return withTenantTx({ tenantId: opts.tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select()
      .from(payerProfiles)
      .where(
        and(eq(payerProfiles.tenantId, opts.tenantId), eq(payerProfiles.displayId, opts.displayId)),
      )
      .limit(1)
    return row ?? null
  })
}

export async function getPayerProfile(opts: { tenantId: string; displayId: string }) {
  const createdByUser = alias(users, 'created_by_user')
  const [row] = await withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: null },
    async (tx) =>
      tx
        .select({
          id: payerProfiles.id,
          displayId: payerProfiles.displayId,
          tenantId: payerProfiles.tenantId,
          name: payerProfiles.name,
          payerType: payerProfiles.payerType,
          contactName: payerProfiles.contactName,
          contactNumber: payerProfiles.contactNumber,
          email: payerProfiles.email,
          address: payerProfiles.address,
          paymentTermsDays: payerProfiles.paymentTermsDays,
          notes: payerProfiles.notes,
          isActive: payerProfiles.isActive,
          priceAdjustmentPercent: payerProfiles.priceAdjustmentPercent,
          rowVersion: payerProfiles.rowVersion,
          createdById: payerProfiles.createdById,
          createdAt: payerProfiles.createdAt,
          updatedAt: payerProfiles.updatedAt,
          // createdBy
          createdByUserId: createdByUser.id,
          createdByDisplayId: createdByUser.displayId,
          createdByFirstName: createdByUser.firstName,
          createdByLastName: createdByUser.lastName,
        })
        .from(payerProfiles)
        .leftJoin(createdByUser, eq(createdByUser.id, payerProfiles.createdById))
        .where(
          and(
            eq(payerProfiles.tenantId, opts.tenantId),
            eq(payerProfiles.displayId, opts.displayId),
          ),
        )
        .limit(1),
  )
  if (!row) return null
  return {
    id: row.displayId,
    tenantId: row.tenantId,
    name: row.name,
    payerType: row.payerType,
    contactName: row.contactName,
    contactNumber: row.contactNumber,
    email: row.email,
    address: row.address,
    paymentTermsDays: row.paymentTermsDays,
    notes: row.notes,
    isActive: row.isActive,
    priceAdjustmentPercent: row.priceAdjustmentPercent,
    rowVersion: row.rowVersion,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: row.createdByUserId
      ? {
          id: row.createdByUserId,
          displayId: row.createdByDisplayId!,
          firstName: row.createdByFirstName!,
          lastName: row.createdByLastName!,
        }
      : null,
  }
}

// ---------------------------------------------------------------------------
// Update payer profile
// ---------------------------------------------------------------------------

export type UpdatePayerProfileInput = {
  tenantId: string
  displayId: string
  userId: number | null
  branchId: number | null
  name?: string
  payerType?: 'HMO' | 'Corporate' | 'Government' | 'Promo'
  contactName?: string | null
  contactNumber?: string | null
  email?: string | null
  address?: string | null
  paymentTermsDays?: number | null
  notes?: string | null
  isActive?: boolean
  priceAdjustmentPercent?: number | null
  expectedRowVersion?: number
}

export async function updatePayerProfile(input: UpdatePayerProfileInput) {
  return withTenantTx(
    {
      tenantId: input.tenantId,
      userId: input.userId ?? 0,
      branchId: input.branchId,
    },
    async (tx) => {
      type ProfileFields = Partial<typeof payerProfiles.$inferInsert>
      const fieldUpdates: ProfileFields & { updatedAt: Date } = {
        updatedAt: new Date(),
      }
      if (input.name !== undefined) fieldUpdates.name = input.name
      if (input.payerType !== undefined) fieldUpdates.payerType = input.payerType
      if ('contactName' in input) fieldUpdates.contactName = input.contactName ?? null
      if ('contactNumber' in input) fieldUpdates.contactNumber = input.contactNumber ?? null
      if ('email' in input) fieldUpdates.email = input.email ?? null
      if ('address' in input) fieldUpdates.address = input.address ?? null
      if ('paymentTermsDays' in input)
        fieldUpdates.paymentTermsDays = input.paymentTermsDays ?? null
      if ('notes' in input) fieldUpdates.notes = input.notes ?? null
      if (input.isActive !== undefined) fieldUpdates.isActive = input.isActive
      if ('priceAdjustmentPercent' in input)
        fieldUpdates.priceAdjustmentPercent =
          input.priceAdjustmentPercent == null ? null : input.priceAdjustmentPercent.toString()

      const rowVersionExpr: SQL<number> = sql`${payerProfiles.rowVersion} + 1`
      const updates = { ...fieldUpdates, rowVersion: rowVersionExpr }

      const conditions = [
        eq(payerProfiles.displayId, input.displayId),
        eq(payerProfiles.tenantId, input.tenantId),
      ]
      if (input.expectedRowVersion !== undefined) {
        conditions.push(eq(payerProfiles.rowVersion, input.expectedRowVersion))
      }

      const [updated] = await tx
        .update(payerProfiles)
        .set(updates)
        .where(and(...conditions))
        .returning()

      if (!updated) {
        // If no row returned AND we had an expectedRowVersion, it's a conflict.
        // If no expectedRowVersion, it's a not-found.
        throw new PayerProfileNotFoundError()
      }

      return {
        displayId: updated.displayId,
        name: updated.name,
        payerType: updated.payerType,
        contactName: updated.contactName,
        contactNumber: updated.contactNumber,
        email: updated.email,
        address: updated.address,
        paymentTermsDays: updated.paymentTermsDays,
        notes: updated.notes,
        isActive: updated.isActive,
        priceAdjustmentPercent: updated.priceAdjustmentPercent,
        rowVersion: updated.rowVersion,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Payer contracts
// ---------------------------------------------------------------------------

function serializeContract(row: typeof payerContracts.$inferSelect) {
  // Surface display_ids; never leak bigint PK/FK.
  const { id: _internalId, payerId: _internalPayerId, displayId: publicId, ...rest } = row
  return {
    id: publicId,
    ...rest,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  }
}

export async function listPayerContracts(opts: { tenantId: string; payerDisplayId: string }) {
  const payer = await resolvePayerByDisplayId({
    tenantId: opts.tenantId,
    displayId: opts.payerDisplayId,
  })
  if (!payer) return null

  const rows = await withTenantTx(
    { tenantId: opts.tenantId, userId: 0, branchId: null },
    async (tx) =>
      tx
        .select()
        .from(payerContracts)
        .where(
          and(
            eq(payerContracts.tenantId, opts.tenantId),
            eq(payerContracts.payerId, payer.id),
            isNull(payerContracts.deletedAt),
          ),
        )
        .orderBy(desc(payerContracts.createdAt)),
  )
  // Project payer display_id alongside each contract for client convenience.
  return rows.map((r) => ({ ...serializeContract(r), payerId: payer.displayId }))
}

export type CreatePayerContractInput = {
  tenantId: string
  payerDisplayId: string
  contractNumber: string
  effectiveFrom: string
  effectiveTo?: string | null
  paymentTermsDays?: number | null
  claimSubmissionFormat?: string | null
  requiresPriorAuth?: boolean
  feeScheduleNotes?: string | null
  contactName?: string | null
  contactNumber?: string | null
  contactEmail?: string | null
  createdById: number | null
  branchId: number | null
}

export async function createPayerContract(input: CreatePayerContractInput) {
  const payer = await resolvePayerByDisplayId({
    tenantId: input.tenantId,
    displayId: input.payerDisplayId,
  })
  if (!payer) return null

  const row = await withTenantTx(
    {
      tenantId: input.tenantId,
      userId: input.createdById ?? 0,
      branchId: input.branchId,
    },
    async (tx) => {
      const [inserted] = await tx
        .insert(payerContracts)
        .values({
          displayId: displayId('PCT'),
          tenantId: input.tenantId,
          payerId: payer.id,
          contractNumber: input.contractNumber,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
          paymentTermsDays: input.paymentTermsDays ?? null,
          claimSubmissionFormat: input.claimSubmissionFormat ?? null,
          requiresPriorAuth: input.requiresPriorAuth ?? false,
          feeScheduleNotes: input.feeScheduleNotes ?? null,
          contactName: input.contactName ?? null,
          contactNumber: input.contactNumber ?? null,
          contactEmail: input.contactEmail ?? null,
          createdById: input.createdById,
        })
        .returning()
      return inserted!
    },
  )
  return { ...serializeContract(row), payerId: payer.displayId }
}

export type UpdatePayerContractInput = {
  tenantId: string
  payerDisplayId: string
  contractDisplayId: string
  contractNumber?: string
  effectiveFrom?: string
  effectiveTo?: string | null
  paymentTermsDays?: number | null
  claimSubmissionFormat?: string | null
  requiresPriorAuth?: boolean
  feeScheduleNotes?: string | null
  contactName?: string | null
  contactNumber?: string | null
  contactEmail?: string | null
  deletedAt?: string | null
  userId: number | null
  branchId: number | null
}

export async function updatePayerContract(input: UpdatePayerContractInput) {
  const payer = await resolvePayerByDisplayId({
    tenantId: input.tenantId,
    displayId: input.payerDisplayId,
  })
  if (!payer) return null

  const row = await withTenantTx(
    {
      tenantId: input.tenantId,
      userId: input.userId ?? 0,
      branchId: input.branchId,
    },
    async (tx) => {
      // Build update payload — only include provided fields.
      type ContractFields = Omit<typeof payerContracts.$inferInsert, 'rowVersion'>
      const fieldUpdates: Partial<ContractFields> & { updatedAt: Date } = {
        updatedAt: new Date(),
      }
      if (input.contractNumber !== undefined) fieldUpdates.contractNumber = input.contractNumber
      if (input.effectiveFrom !== undefined) fieldUpdates.effectiveFrom = input.effectiveFrom
      if ('effectiveTo' in input) fieldUpdates.effectiveTo = input.effectiveTo ?? null
      if ('paymentTermsDays' in input)
        fieldUpdates.paymentTermsDays = input.paymentTermsDays ?? null
      if ('claimSubmissionFormat' in input)
        fieldUpdates.claimSubmissionFormat = input.claimSubmissionFormat ?? null
      if (input.requiresPriorAuth !== undefined)
        fieldUpdates.requiresPriorAuth = input.requiresPriorAuth
      if ('feeScheduleNotes' in input)
        fieldUpdates.feeScheduleNotes = input.feeScheduleNotes ?? null
      if ('contactName' in input) fieldUpdates.contactName = input.contactName ?? null
      if ('contactNumber' in input) fieldUpdates.contactNumber = input.contactNumber ?? null
      if ('contactEmail' in input) fieldUpdates.contactEmail = input.contactEmail ?? null
      if ('deletedAt' in input)
        fieldUpdates.deletedAt = input.deletedAt ? new Date(input.deletedAt) : null
      const rowVersionExpr: SQL<number> = sql`${payerContracts.rowVersion} + 1`
      const updates = { ...fieldUpdates, rowVersion: rowVersionExpr }

      const [updated] = await tx
        .update(payerContracts)
        .set(updates)
        .where(
          and(
            eq(payerContracts.displayId, input.contractDisplayId),
            eq(payerContracts.payerId, payer.id),
            eq(payerContracts.tenantId, input.tenantId),
          ),
        )
        .returning()
      return updated ?? null
    },
  )
  if (!row) return null
  return { ...serializeContract(row), payerId: payer.displayId }
}

// ---------------------------------------------------------------------------
// Payer price-adjustment exclusions — opt-out list for
// payerProfiles.priceAdjustmentPercent (see shared/lib/pricing.ts)
// ---------------------------------------------------------------------------

export class PriceExclusionServiceNotFoundError extends Error {
  constructor() {
    super('Service not found')
    this.name = 'PriceExclusionServiceNotFoundError'
  }
}

export async function listPayerPriceExclusions(opts: { tenantId: string; payerDisplayId: string }) {
  const payer = await resolvePayerByDisplayId({
    tenantId: opts.tenantId,
    displayId: opts.payerDisplayId,
  })
  if (!payer) return null

  return withTenantTx({ tenantId: opts.tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        serviceId: payerPriceAdjustmentExclusions.serviceId,
        serviceName: serviceCatalog.name,
      })
      .from(payerPriceAdjustmentExclusions)
      .innerJoin(serviceCatalog, eq(serviceCatalog.id, payerPriceAdjustmentExclusions.serviceId))
      .where(
        and(
          eq(payerPriceAdjustmentExclusions.tenantId, opts.tenantId),
          eq(payerPriceAdjustmentExclusions.payerId, payer.id),
        ),
      )
      .orderBy(serviceCatalog.name),
  )
}

export type AddPayerPriceExclusionInput = {
  tenantId: string
  payerDisplayId: string
  serviceId: string
  userId: number | null
  branchId: number | null
}

/** Returns null when the payer isn't found; throws PriceExclusionServiceNotFoundError when the service isn't. */
export async function addPayerPriceExclusion(input: AddPayerPriceExclusionInput) {
  const payer = await resolvePayerByDisplayId({
    tenantId: input.tenantId,
    displayId: input.payerDisplayId,
  })
  if (!payer) return null

  return withTenantTx(
    { tenantId: input.tenantId, userId: input.userId ?? 0, branchId: input.branchId },
    async (tx) => {
      const [service] = await tx
        .select({ id: serviceCatalog.id, name: serviceCatalog.name })
        .from(serviceCatalog)
        .where(
          and(eq(serviceCatalog.tenantId, input.tenantId), eq(serviceCatalog.id, input.serviceId)),
        )
        .limit(1)
      if (!service) throw new PriceExclusionServiceNotFoundError()

      await tx
        .insert(payerPriceAdjustmentExclusions)
        .values({
          tenantId: input.tenantId,
          payerId: payer.id,
          serviceId: service.id,
          createdById: input.userId,
        })
        .onConflictDoNothing()

      return { serviceId: service.id, serviceName: service.name }
    },
  )
}

export async function removePayerPriceExclusion(opts: {
  tenantId: string
  payerDisplayId: string
  serviceId: string
  userId: number | null
  branchId: number | null
}): Promise<boolean | null> {
  const payer = await resolvePayerByDisplayId({
    tenantId: opts.tenantId,
    displayId: opts.payerDisplayId,
  })
  if (!payer) return null

  return withTenantTx(
    { tenantId: opts.tenantId, userId: opts.userId ?? 0, branchId: opts.branchId },
    async (tx) => {
      const deleted = await tx
        .delete(payerPriceAdjustmentExclusions)
        .where(
          and(
            eq(payerPriceAdjustmentExclusions.tenantId, opts.tenantId),
            eq(payerPriceAdjustmentExclusions.payerId, payer.id),
            eq(payerPriceAdjustmentExclusions.serviceId, opts.serviceId),
          ),
        )
        .returning({ serviceId: payerPriceAdjustmentExclusions.serviceId })
      return deleted.length > 0
    },
  )
}
