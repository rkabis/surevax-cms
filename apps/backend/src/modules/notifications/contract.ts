/**
 * notifications API contract — schemas + endpoint manifest.
 *
 * Request schemas are the runtime validators used by routes.ts; response
 * schemas describe the ACTUAL res.json payloads and are enforced against the
 * implementation via `satisfies` at each res.json callsite.
 *
 * Side-effect-free imports only (zod + defineContract) — the generator
 * imports this file without a configured environment.
 */
import { z } from 'zod'
import { defineContract } from '../../contracts/defineContract.js'

// ── Request schemas (runtime validators for routes.ts) ──────────────────────

const notificationChannelEnum = z.enum(['SMS', 'Email', 'Push'])
const notificationStatusEnum = z.enum(['Queued', 'Sent', 'Failed', 'Cancelled'])

/**
 * notifications.id is bigserial — accept as positive integer string in path/query.
 * z.coerce.number() parses "42" → 42.
 */
export const bigintIdSchema = z.coerce.number().int().positive()

export const listQuerySchema = z.object({
  status: notificationStatusEnum.optional(),
  /** patientId is a bigint PK — accept as positive integer string. */
  patientId: bigintIdSchema.optional(),
  channel: notificationChannelEnum.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const idParamsSchema = z.object({ id: bigintIdSchema })

export const dryRunBodySchema = z.object({
  /** bigint PK of the patient. */
  patientId: bigintIdSchema,
  templateCode: z.string().min(1).max(100).optional().nullable(),
  channel: notificationChannelEnum,
  body: z.string().min(1).max(10_000).optional().nullable(),
})

// ── Response schemas (wire truth — keep in lockstep with db.ts) ─────────────

/**
 * NOTE: templateId, patientId, userId, createdById are bigint FKs crossing
 * the wire as numbers — a known display-id convention leak, captured as-is
 * because contracts model the ACTUAL shape.
 */
const notificationRowSchema = z.object({
  /** bigint PK serialized as string for JSON safety. */
  id: z.string(),
  tenantId: z.string(),
  /**
   * NOTE: bigint FK to notification_templates — crosses the wire as number.
   * Known leak of the internal id; flagged for a separate fix.
   */
  templateId: z.number().nullable(),
  /** NTP_ display_id of the resolved template, or null. */
  templateDisplayId: z.string().nullable(),
  templateCode: z.string().nullable(),
  /**
   * NOTE: bigint FK to patients — crosses the wire as number.
   * Known leak of the internal id; flagged for a separate fix.
   */
  patientId: z.number().nullable(),
  patientName: z.string().nullable(),
  /**
   * NOTE: bigint FK to users — crosses the wire as number.
   * Known leak of the internal id; flagged for a separate fix.
   */
  userId: z.number().nullable(),
  channel: z.string(),
  recipientAddress: z.string().nullable(),
  subject: z.string().nullable(),
  body: z.string(),
  status: z.string(),
  scheduledAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  readAt: z.string().nullable(),
  externalMessageId: z.string().nullable(),
  retryCount: z.number(),
  failureReason: z.string().nullable(),
  consentVerifiedAt: z.string().nullable(),
  /** JSONB — shape not modeled. */
  metadata: z.unknown(),
  rowVersion: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * NOTE: bigint FK to users — crosses the wire as number.
   * Known leak of the internal id; flagged for a separate fix.
   */
  createdById: z.number().nullable(),
  createdBy: z
    .object({
      id: z.number(),
      displayId: z.string(),
      firstName: z.string(),
      lastName: z.string(),
    })
    .nullable(),
})

// list: GET / — bare array (rows), not an envelope
const listResponseSchema = z.array(notificationRowSchema)

const detailResponseSchema = notificationRowSchema

const resendResponseSchema = z.object({
  /** bigint PK of new notification, serialized as string. */
  id: z.string(),
})

const dryRunResponseSchema = z.object({
  /** bigint PK serialized as string. */
  id: z.string(),
  tenantId: z.string(),
  /**
   * NOTE: bigint FK to patients — crosses the wire as number.
   */
  patientId: z.number(),
  /**
   * NOTE: bigint FK to notification_templates — crosses the wire as number (nullable).
   */
  templateId: z.number().nullable(),
  channel: z.string(),
  body: z.string(),
  status: z.string(),
  createdAt: z.string(),
})

// ── Manifest ─────────────────────────────────────────────────────────────────

export const notificationsContract = defineContract('notifications', {
  list: {
    method: 'GET',
    path: '/api/admin/notifications',
    query: listQuerySchema,
    response: listResponseSchema,
  },
  detail: {
    method: 'GET',
    path: '/api/admin/notifications/:id',
    params: { id: bigintIdSchema },
    response: detailResponseSchema,
  },
  resend: {
    method: 'POST',
    path: '/api/admin/notifications/:id/resend',
    params: { id: bigintIdSchema },
    response: resendResponseSchema,
  },
  dryRun: {
    method: 'POST',
    path: '/api/admin/notifications/dry-run',
    body: dryRunBodySchema,
    response: dryRunResponseSchema,
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ───────

export type NotificationsListResponse = z.infer<typeof listResponseSchema>
export type NotificationsDetailResponse = z.infer<typeof detailResponseSchema>
export type NotificationsResendResponse = z.infer<typeof resendResponseSchema>
export type NotificationsDryRunResponse = z.infer<typeof dryRunResponseSchema>
