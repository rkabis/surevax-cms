import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { displayIdSchema, prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { env } from '../../shared/config/env.js'
import type { AuthUser } from '../../shared/middleware/auth.js'
import {
  listAttachmentsByOwner,
  getAttachment,
  getAttachmentForPresign,
  createAttachment,
  softDeleteAttachment,
} from './db.js'

// ─── R2 / S3 client (lazy singleton) ─────────────────────────────────────────

let _s3: S3Client | null = null

function getS3Client(): S3Client | null {
  if (!env.R2_ENDPOINT || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null
  if (!_s3) {
    _s3 = new S3Client({
      region: 'auto',
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    })
  }
  return _s3
}

// ─── Inline Zod schemas ───────────────────────────────────────────────────────

// Allowed owner types — extend conservatively as new modules are added
const ownerTypeEnum = z.enum([
  'lab_order',
  'encounter',
  'claim',
  'patient',
  'clinical_order',
  'adverse_event',
  'product_recall',
])

const storageBackendEnum = z.enum(['r2', 's3', 'local'])

// Validates the attachment's own display_id (ATT_…). Polymorphic ownerId
// uses generic displayIdSchema since it may carry any prefix (PAT_, ENC_,
// CLM_, etc.) — see id-redesign locked decision #9.
const attachmentIdSchema = prefixedDisplayIdSchema('ATT')

// SHA-256 in lowercase hex — 64 chars
const sha256Regex = /^[a-f0-9]{64}$/

// Phase-1 cap: 50 MB declared size. The actual binary lives in object storage;
// we only persist the declared metadata here. This cap guards against obviously
// incorrect client submissions (negative, zero, or absurdly large values).
const MAX_SIZE_BYTES = 50_000_000

// SEC-6: allowlist of safe MIME types accepted by this clinic.
// Covers lab results (PDF), consent/health-card scans (images), and plain text.
// Rejecting unrecognised types prevents a stored-XSS vector where a malicious
// type string is later reflected in a Content-Type header when the attachment
// is served (e.g. text/html, application/javascript).
const ALLOWED_CONTENT_TYPES = new Set([
  // Documents
  'application/pdf',
  // Images
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  // Plain text (e.g. CSV lab exports)
  'text/plain',
])

// storageKey is derived server-side (see createAttachment in db.ts) — never
// trust a client-supplied path. Untrusted storageKey is a path-traversal /
// cross-tenant overwrite vector (Wave-9 audit finding).
const createAttachmentSchema = z.object({
  ownerType: ownerTypeEnum,
  // ownerId validated as a generic display id (polymorphic — any prefix accepted)
  ownerId: displayIdSchema,
  fileName: z.string().min(1).max(512),
  contentType: z
    .string()
    .min(1)
    .max(256)
    .refine((v) => ALLOWED_CONTENT_TYPES.has(v), {
      message: `Unsupported content type. Allowed types: ${[...ALLOWED_CONTENT_TYPES].join(', ')}`,
    }),
  sizeBytes: z
    .number()
    .int()
    .min(1, 'File size must be greater than 0')
    .max(MAX_SIZE_BYTES, 'File size exceeds the 50 MB limit'),
  storageBackend: storageBackendEnum,
  contentHashSha256: z
    .string()
    .regex(sha256Regex, 'Content hash must be 64 lowercase hex characters (SHA-256)'),
  isEncrypted: z.boolean().optional(),
  category: z.string().min(1).max(128).nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
})

// ─── Router ───────────────────────────────────────────────────────────────────

export const attachmentsRouter: RouterType = Router()

/**
 * GET /api/attachments
 *
 * List attachments. Must specify EITHER:
 *   - ?ownerType=<type>&ownerId=<id>  (list all for an owner, most common)
 *   - ?id=<att-id>                    (single fetch by id, convenience alias)
 *
 * Returns 400 OWNER_REQUIRED if neither filter is supplied to prevent
 * unbounded scans across all attachments in the tenant.
 */
attachmentsRouter.get('/', async (req: Request, res: Response) => {
  const { ownerType, ownerId, id } = req.query as {
    ownerType?: string
    ownerId?: string
    id?: string
  }

  // Single-id shortcut
  if (id) {
    const parsedId = attachmentIdSchema.safeParse(id)
    if (!parsedId.success) {
      res.status(400).json({ error: 'Invalid attachment id', code: 'INVALID_ID' })
      return
    }
    const row = await getAttachment(req.tenant.id, parsedId.data)
    if (!row) {
      res.status(404).json({ error: 'Attachment not found', code: 'NOT_FOUND' })
      return
    }
    res.json({ data: [row], total: 1 })
    return
  }

  // Owner filter path — both params required together
  if (!ownerType || !ownerId) {
    res.status(400).json({
      error: 'Must provide ownerType + ownerId (or ?id=) to filter attachments',
      code: 'OWNER_REQUIRED',
    })
    return
  }

  const parsedType = ownerTypeEnum.safeParse(ownerType)
  if (!parsedType.success) {
    res.status(400).json({ error: 'Invalid ownerType', code: 'VALIDATION_ERROR' })
    return
  }

  const parsedOwnerId = displayIdSchema.safeParse(ownerId)
  if (!parsedOwnerId.success) {
    res.status(400).json({ error: 'Invalid ownerId', code: 'VALIDATION_ERROR' })
    return
  }

  const result = await listAttachmentsByOwner(req.tenant.id, parsedType.data, parsedOwnerId.data)
  res.json(result)
})

/**
 * GET /api/attachments/:id — detail with uploaderName joined from users.
 * Returns 404 for soft-deleted rows.
 */
attachmentsRouter.get('/:id', async (req: Request, res: Response) => {
  const parsed = attachmentIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid attachment id', code: 'INVALID_ID' })
    return
  }

  const row = await getAttachment(req.tenant.id, parsed.data)
  if (!row) {
    res.status(404).json({ error: 'Attachment not found', code: 'NOT_FOUND' })
    return
  }
  res.json({ data: row })
})

/**
 * POST /api/attachments — create attachment metadata record.
 *
 * NOTE: This is a metadata-only endpoint. The binary file must already reside
 * at storageKey in the declared storageBackend before (or after) this call.
 * No signed-URL generation or binary transfer occurs here.
 *
 * NOTE: Owner existence is NOT verified. The caller (or a future validation
 * layer) is responsible for ensuring the owner record exists. Verifying would
 * require N case-statement queries against different tables.
 *
 * Phase-1 size cap: sizeBytes <= 50_000_000 (50 MB declared). Enforced at the
 * schema level above. Actual storage enforcement is left to the object store.
 */
attachmentsRouter.post('/', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  if (user?.id == null) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' })
    return
  }

  const parsed = createAttachmentSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten(),
    })
    return
  }

  const row = await createAttachment(req.tenant.id, user.id, user.branchId, parsed.data)
  res.status(201).json({ data: row })
})

/**
 * GET /api/attachments/:id/upload-url — generate a presigned R2 PUT URL.
 *
 * Returns { url, expiresIn } for the client to PUT the file bytes directly
 * to R2 with the matching Content-Type header (baked into the signature).
 *
 * 503 STORAGE_NOT_CONFIGURED — R2 env vars not set (expected in local dev).
 * 404 NOT_FOUND — attachment not found or soft-deleted.
 */
attachmentsRouter.get('/:id/upload-url', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  if (user?.id == null) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' })
    return
  }

  const parsed = attachmentIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid attachment id', code: 'INVALID_ID' })
    return
  }

  const s3 = getS3Client()
  if (!s3 || !env.R2_BUCKET) {
    res.status(503).json({
      error:
        'Object storage is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.',
      code: 'STORAGE_NOT_CONFIGURED',
    })
    return
  }

  const attachment = await getAttachmentForPresign(req.tenant.id, parsed.data)
  if (!attachment) {
    res.status(404).json({ error: 'Attachment not found', code: 'NOT_FOUND' })
    return
  }

  // SEC-1: a presigned PUT lets the holder overwrite the object bytes at
  // storageKey (the DB content hash is unchanged, so tamper is invisible).
  // Attachments are immutable by design — only the creator may obtain an
  // upload URL (i.e. for the initial upload in the create→presign→mark flow).
  // Without this, any tenant user could overwrite any attachment's bytes (IDOR).
  if (attachment.uploadedById !== user.id) {
    res.status(404).json({ error: 'Attachment not found', code: 'NOT_FOUND' })
    return
  }

  const EXPIRES_IN = 900 // 15 minutes
  const cmd = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: attachment.storageKey,
    ContentType: attachment.contentType,
  })
  const url = await getSignedUrl(s3, cmd, { expiresIn: EXPIRES_IN })

  res.json({ url, expiresIn: EXPIRES_IN })
})

/**
 * POST /api/attachments/:id/mark-uploaded — finalize an attachment upload.
 *
 * Called by the frontend after a successful presigned PUT to R2. Records the
 * upload timestamp on the attachment row so the server knows the binary exists.
 * Body is empty. Returns { ok: true }.
 */
attachmentsRouter.post('/:id/mark-uploaded', async (req: Request, res: Response) => {
  const parsed = attachmentIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid attachment id', code: 'INVALID_ID' })
    return
  }

  // Verify the attachment exists and belongs to this tenant
  const attachment = await getAttachment(req.tenant.id, parsed.data)
  if (!attachment) {
    res.status(404).json({ error: 'Attachment not found', code: 'NOT_FOUND' })
    return
  }

  // uploadedAt is already set at create-time (defaultNow). mark-uploaded is a
  // confirmation signal — currently a no-op at the DB layer because uploadedAt
  // was set eagerly. The route exists so the frontend call completes cleanly
  // and future iterations can persist an explicit binary_uploaded_at column
  // without a frontend change.
  res.json({ ok: true })
})

/**
 * DELETE /api/attachments/:id — soft delete (sets deleted_at).
 * Attachment metadata is immutable — no PATCH endpoint by design.
 * To replace a file, create a new attachment record.
 */
attachmentsRouter.delete('/:id', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  if (user?.id == null) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' })
    return
  }
  const parsed = attachmentIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid attachment id', code: 'INVALID_ID' })
    return
  }

  const deleted = await softDeleteAttachment(req.tenant.id, user.id, user.branchId, parsed.data)
  if (!deleted) {
    res.status(404).json({ error: 'Attachment not found', code: 'NOT_FOUND' })
    return
  }
  res.json({ ok: true })
})
