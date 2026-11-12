import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { attachments, users } from '../../shared/db/schema.js'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { displayId } from '../../shared/utils/displayId.js'

// ─── Types ────────────────────────────────────────────────────────────────────

// Note: storageKey is intentionally absent from the input — it's derived
// server-side from the authenticated tenant + a fresh UUID. See
// createAttachment below.
//
// Note: ownerId is the parent's display_id (text). The polymorphic owner
// reference stays text (per id-redesign locked decision #9) so audit reports
// and admin tooling can read it without joining to the parent table.
export type CreateAttachmentInput = {
  ownerType: string
  ownerId: string
  fileName: string
  contentType: string
  sizeBytes: number
  storageBackend: string
  contentHashSha256: string
  isEncrypted?: boolean
  category?: string | null
  metadata?: Record<string, unknown> | null
}

// Strip path separators + traversal sequences; collapse to a single safe segment.
function sanitizeFilename(name: string): string {
  // Take only the basename portion (defence-in-depth against `dir/../etc`).
  const base = name.split(/[\\/]/).pop() ?? ''
  // Allowed: alnum, dot, hyphen, underscore. Anything else → underscore.
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.{2,}/g, '.')
  return safe.length > 0 ? safe.slice(0, 200) : 'file'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRow(r: {
  displayId: string
  tenantId: string
  ownerType: string
  ownerId: string
  fileName: string
  contentType: string
  sizeBytes: number
  storageBackend: string
  storageKey: string
  contentHashSha256: string
  isEncrypted: boolean
  category: string | null
  metadata: unknown
  uploadedByDisplayId: string | null
  uploadedAt: Date
  deletedAt: Date | null
  uploaderFirstName: string | null
  uploaderLastName: string | null
}) {
  const uploaderName =
    r.uploaderFirstName && r.uploaderLastName
      ? `${r.uploaderLastName}, ${r.uploaderFirstName}`
      : null
  return {
    // Surface display_id as the public `id` — never leak bigint.
    id: r.displayId,
    tenantId: r.tenantId,
    ownerType: r.ownerType,
    ownerId: r.ownerId,
    fileName: r.fileName,
    contentType: r.contentType,
    sizeBytes: r.sizeBytes,
    storageBackend: r.storageBackend,
    storageKey: r.storageKey,
    contentHashSha256: r.contentHashSha256,
    isEncrypted: r.isEncrypted,
    category: r.category ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    uploadedById: r.uploadedByDisplayId ?? null,
    uploadedAt: r.uploadedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
    uploaderName,
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * List attachments by owner (ownerType + ownerId required) for a tenant.
 * Returns flat rows with uploaderName + uploader display_id joined from users.
 */
export async function listAttachmentsByOwner(tenantId: string, ownerType: string, ownerId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const uploaders = tx
      .select({
        id: users.id,
        displayId: users.displayId,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .as('uploaders')

    const rows = await tx
      .select({
        displayId: attachments.displayId,
        tenantId: attachments.tenantId,
        ownerType: attachments.ownerType,
        ownerId: attachments.ownerId,
        fileName: attachments.fileName,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
        storageBackend: attachments.storageBackend,
        storageKey: attachments.storageKey,
        contentHashSha256: attachments.contentHashSha256,
        isEncrypted: attachments.isEncrypted,
        category: attachments.category,
        metadata: attachments.metadata,
        uploadedByDisplayId: uploaders.displayId,
        uploadedAt: attachments.uploadedAt,
        deletedAt: attachments.deletedAt,
        uploaderFirstName: uploaders.firstName,
        uploaderLastName: uploaders.lastName,
      })
      .from(attachments)
      .leftJoin(uploaders, eq(attachments.uploadedById, uploaders.id))
      .where(
        and(
          eq(attachments.tenantId, tenantId),
          eq(attachments.ownerType, ownerType),
          eq(attachments.ownerId, ownerId),
          isNull(attachments.deletedAt),
        ),
      )

    return { data: rows.map(formatRow), total: rows.length }
  })
}

/**
 * Fetch a single attachment by display_id. Returns null if not found or soft-deleted.
 */
export async function getAttachment(tenantId: string, attDisplayId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const uploaders = tx
      .select({
        id: users.id,
        displayId: users.displayId,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .as('uploaders')

    const [row] = await tx
      .select({
        displayId: attachments.displayId,
        tenantId: attachments.tenantId,
        ownerType: attachments.ownerType,
        ownerId: attachments.ownerId,
        fileName: attachments.fileName,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
        storageBackend: attachments.storageBackend,
        storageKey: attachments.storageKey,
        contentHashSha256: attachments.contentHashSha256,
        isEncrypted: attachments.isEncrypted,
        category: attachments.category,
        metadata: attachments.metadata,
        uploadedByDisplayId: uploaders.displayId,
        uploadedAt: attachments.uploadedAt,
        deletedAt: attachments.deletedAt,
        uploaderFirstName: uploaders.firstName,
        uploaderLastName: uploaders.lastName,
      })
      .from(attachments)
      .leftJoin(uploaders, eq(attachments.uploadedById, uploaders.id))
      .where(
        and(
          eq(attachments.tenantId, tenantId),
          eq(attachments.displayId, attDisplayId),
          isNull(attachments.deletedAt),
        ),
      )
      .limit(1)

    if (!row) return null
    return formatRow(row)
  })
}

/**
 * Create a new attachment metadata record.
 * Owner existence is NOT verified here — consumers must ensure the owner exists.
 * The actual binary is assumed to already reside at storageKey in storageBackend.
 *
 * Returns the freshly-inserted row as serialised by formatRow (with display_id
 * surfaced as `id`).
 */
export async function createAttachment(
  tenantId: string,
  userId: number,
  branchId: number | null,
  input: CreateAttachmentInput,
) {
  const newDisplayId = displayId('ATT')
  const now = new Date()
  // Derive storageKey server-side. Tenant-prefixed path prevents cross-tenant
  // overwrite; UUID prevents key collisions; sanitized filename strips path
  // separators + traversal sequences. Client-supplied storageKey is rejected
  // at the route layer.
  const storageKey = `uploads/${tenantId}/${randomUUID()}/${sanitizeFilename(input.fileName)}`

  await withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    await tx.insert(attachments).values({
      displayId: newDisplayId,
      tenantId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      storageBackend: input.storageBackend,
      storageKey,
      contentHashSha256: input.contentHashSha256,
      isEncrypted: input.isEncrypted ?? true,
      category: input.category ?? null,
      // JSONB columns require JSON.stringify — raw objects fail with ERR_INVALID_ARG_TYPE
      metadata: input.metadata != null ? (JSON.stringify(input.metadata) as unknown as null) : null,
      uploadedById: userId,
      uploadedAt: now,
      deletedAt: null,
    })
  })

  // Re-fetch via detail path (outside the write tx — read-only, new tx sets RLS)
  return getAttachment(tenantId, newDisplayId)
}

/**
 * Fetch the minimal fields needed to generate a presigned PUT URL.
 * Returns null if not found, soft-deleted, or tenant mismatch.
 */
export async function getAttachmentForPresign(
  tenantId: string,
  attDisplayId: string,
): Promise<{
  displayId: string
  storageKey: string
  contentType: string
  uploadedById: number | null
} | null> {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({
        displayId: attachments.displayId,
        storageKey: attachments.storageKey,
        contentType: attachments.contentType,
        uploadedById: attachments.uploadedById,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.tenantId, tenantId),
          eq(attachments.displayId, attDisplayId),
          isNull(attachments.deletedAt),
        ),
      )
      .limit(1)

    return row ?? null
  })
}

/**
 * Soft-delete an attachment (sets deleted_at = now()).
 * Returns true if found and deleted, false if not found or already deleted.
 */
export async function softDeleteAttachment(
  tenantId: string,
  userId: number,
  branchId: number | null,
  attDisplayId: string,
) {
  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [existing] = await tx
      .select({ id: attachments.id, deletedAt: attachments.deletedAt })
      .from(attachments)
      .where(and(eq(attachments.tenantId, tenantId), eq(attachments.displayId, attDisplayId)))
      .limit(1)

    if (!existing || existing.deletedAt !== null) return false

    await tx
      .update(attachments)
      .set({ deletedAt: new Date() })
      .where(and(eq(attachments.tenantId, tenantId), eq(attachments.id, existing.id)))

    return true
  })
}
