import { and, eq, desc, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { displayId } from '../../shared/utils/displayId.js'
import { partnerLaboratories, users } from '../../shared/db/schema.js'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a partner lab's display_id to its full row, scoped to tenant.
 * Returns `null` when no match — callers should 404.
 */
async function resolveLabByDisplayId(opts: { tenantId: string; displayId: string }) {
  return withTenantTx({ tenantId: opts.tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select()
      .from(partnerLaboratories)
      .where(
        and(
          eq(partnerLaboratories.tenantId, opts.tenantId),
          eq(partnerLaboratories.displayId, opts.displayId),
          isNull(partnerLaboratories.deletedAt),
        ),
      )
      .limit(1)
    return row ?? null
  })
}

function serializeLab(row: typeof partnerLaboratories.$inferSelect) {
  // Surface display_id as public `id`; never leak bigint PK or integration
  // credentials (apiConfig holds API keys/endpoints — write-only, never read back).
  const { id: _internalId, displayId: publicId, apiConfig: _apiConfig, ...rest } = row
  return {
    id: publicId,
    ...rest,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listPartnerLabs(tenantId: string) {
  const rows = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        id: partnerLaboratories.displayId,
        name: partnerLaboratories.name,
        contactName: partnerLaboratories.contactName,
        contactNumber: partnerLaboratories.contactNumber,
        email: partnerLaboratories.email,
        isActive: partnerLaboratories.isActive,
        createdAt: partnerLaboratories.createdAt,
      })
      .from(partnerLaboratories)
      .where(and(eq(partnerLaboratories.tenantId, tenantId), isNull(partnerLaboratories.deletedAt)))
      .orderBy(desc(partnerLaboratories.createdAt)),
  )

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }))
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export async function getPartnerLab(labDisplayId: string, tenantId: string) {
  const createdByUser = alias(users, 'created_by_user')
  const [row] = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    tx
      .select({
        id: partnerLaboratories.id,
        displayId: partnerLaboratories.displayId,
        tenantId: partnerLaboratories.tenantId,
        name: partnerLaboratories.name,
        contactName: partnerLaboratories.contactName,
        contactNumber: partnerLaboratories.contactNumber,
        email: partnerLaboratories.email,
        address: partnerLaboratories.address,
        isActive: partnerLaboratories.isActive,
        createdById: partnerLaboratories.createdById,
        createdAt: partnerLaboratories.createdAt,
        updatedAt: partnerLaboratories.updatedAt,
        deletedAt: partnerLaboratories.deletedAt,
        // createdBy
        createdByUserId: createdByUser.id,
        createdByDisplayId: createdByUser.displayId,
        createdByFirstName: createdByUser.firstName,
        createdByLastName: createdByUser.lastName,
      })
      .from(partnerLaboratories)
      .leftJoin(createdByUser, eq(createdByUser.id, partnerLaboratories.createdById))
      .where(
        and(
          eq(partnerLaboratories.tenantId, tenantId),
          eq(partnerLaboratories.displayId, labDisplayId),
          isNull(partnerLaboratories.deletedAt),
        ),
      )
      .limit(1),
  )
  if (!row) return null
  return {
    id: row.displayId,
    tenantId: row.tenantId,
    name: row.name,
    contactName: row.contactName,
    contactNumber: row.contactNumber,
    email: row.email,
    address: row.address,
    isActive: row.isActive,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
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
// Create
// ---------------------------------------------------------------------------

export type CreatePartnerLabInput = {
  tenantId: string
  name: string
  contactName?: string | null
  contactNumber?: string | null
  email?: string | null
  address?: string | null
  apiConfig?: Record<string, unknown> | null
  isActive?: boolean
  userId: number | null
  branchId: number | null
}

export async function createPartnerLab(input: CreatePartnerLabInput) {
  const row = await withTenantTx(
    { tenantId: input.tenantId, userId: input.userId ?? 0, branchId: input.branchId },
    async (tx) => {
      const [inserted] = await tx
        .insert(partnerLaboratories)
        .values({
          displayId: displayId('LAB'),
          tenantId: input.tenantId,
          name: input.name,
          contactName: input.contactName ?? null,
          contactNumber: input.contactNumber ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          apiConfig: input.apiConfig ? JSON.stringify(input.apiConfig) : null,
          isActive: input.isActive ?? true,
          createdById: input.userId,
        })
        .returning()
      return inserted!
    },
  )
  return serializeLab(row)
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export type UpdatePartnerLabInput = {
  tenantId: string
  labDisplayId: string
  name?: string
  contactName?: string | null
  contactNumber?: string | null
  email?: string | null
  address?: string | null
  apiConfig?: Record<string, unknown> | null
  isActive?: boolean
  userId: number | null
  branchId: number | null
}

export async function updatePartnerLab(input: UpdatePartnerLabInput) {
  const lab = await resolveLabByDisplayId({
    tenantId: input.tenantId,
    displayId: input.labDisplayId,
  })
  if (!lab) return null

  const row = await withTenantTx(
    { tenantId: input.tenantId, userId: input.userId ?? 0, branchId: input.branchId },
    async (tx) => {
      type LabFields = Partial<typeof partnerLaboratories.$inferInsert> & { updatedAt: Date }
      const updates: LabFields = { updatedAt: new Date() }

      if (input.name !== undefined) updates.name = input.name
      if ('contactName' in input) updates.contactName = input.contactName ?? null
      if ('contactNumber' in input) updates.contactNumber = input.contactNumber ?? null
      if ('email' in input) updates.email = input.email ?? null
      if ('address' in input) updates.address = input.address ?? null
      if ('apiConfig' in input)
        updates.apiConfig = input.apiConfig ? JSON.stringify(input.apiConfig) : null
      if (input.isActive !== undefined) updates.isActive = input.isActive

      const [updated] = await tx
        .update(partnerLaboratories)
        .set(updates)
        .where(
          and(
            eq(partnerLaboratories.tenantId, input.tenantId),
            eq(partnerLaboratories.id, lab.id),
            isNull(partnerLaboratories.deletedAt),
          ),
        )
        .returning()
      return updated ?? null
    },
  )
  if (!row) return null
  return serializeLab(row)
}

// ---------------------------------------------------------------------------
// Delete (soft)
// ---------------------------------------------------------------------------

export async function deletePartnerLab(opts: {
  tenantId: string
  labDisplayId: string
  userId: number | null
  branchId: number | null
}) {
  const lab = await resolveLabByDisplayId({ tenantId: opts.tenantId, displayId: opts.labDisplayId })
  if (!lab) return null

  const row = await withTenantTx(
    { tenantId: opts.tenantId, userId: opts.userId ?? 0, branchId: opts.branchId },
    async (tx) => {
      const now = new Date()
      const [deleted] = await tx
        .update(partnerLaboratories)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(partnerLaboratories.tenantId, opts.tenantId),
            eq(partnerLaboratories.id, lab.id),
            isNull(partnerLaboratories.deletedAt),
          ),
        )
        .returning()
      return deleted ?? null
    },
  )
  if (!row) return null
  return serializeLab(row)
}
