/**
 * Notifications DB layer.
 *
 * notifications.id is bigserial-only (no display_id per spec).
 * IDs are surfaced as strings in the API (String(bigint)).
 *
 * All queries run inside withTenantTx() so the audit trigger
 * (0002_audit_redaction.sql) doesn't raise on missing tenant GUC.
 */

import { sql } from 'drizzle-orm'
import { withTenantTx } from '../../shared/db/withTenantTx.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface NotificationRow {
  /** bigint PK serialized as string for JSON safety. */
  id: string
  tenantId: string
  /** bigint FK to notification_templates, surfaced as number or null. */
  templateId: number | null
  /** NTP_ display_id of the resolved template, or null. */
  templateDisplayId: string | null
  templateCode: string | null
  /** bigint FK to patients. */
  patientId: number | null
  patientName: string | null
  /** bigint FK to users. */
  userId: number | null
  channel: string
  recipientAddress: string | null
  subject: string | null
  body: string
  status: string
  scheduledAt: string | null
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  externalMessageId: string | null
  retryCount: number
  failureReason: string | null
  consentVerifiedAt: string | null
  metadata: unknown
  rowVersion: number
  createdAt: string
  updatedAt: string
  /** bigint FK to users. */
  createdById: number | null
  createdBy: { id: number; displayId: string; firstName: string; lastName: string } | null
}

function mapRow(raw: Record<string, unknown>): NotificationRow {
  const createdByIdVal = raw['createdById'] != null ? Number(raw['createdById']) : null
  const createdByDisplayIdVal = (raw['createdByDisplayId'] as string | null) ?? null
  const createdByFirstNameVal = (raw['createdByFirstName'] as string | null) ?? null
  const createdByLastNameVal = (raw['createdByLastName'] as string | null) ?? null
  return {
    id: String(raw['id']),
    tenantId: raw['tenantId'] as string,
    templateId: raw['templateId'] != null ? Number(raw['templateId']) : null,
    templateDisplayId: (raw['templateDisplayId'] as string | null) ?? null,
    templateCode: (raw['templateCode'] as string | null) ?? null,
    patientId: raw['patientId'] != null ? Number(raw['patientId']) : null,
    patientName: (raw['patientName'] as string | null) ?? null,
    userId: raw['userId'] != null ? Number(raw['userId']) : null,
    channel: raw['channel'] as string,
    recipientAddress: (raw['recipientAddress'] as string | null) ?? null,
    subject: (raw['subject'] as string | null) ?? null,
    body: raw['body'] as string,
    status: raw['status'] as string,
    scheduledAt: raw['scheduledAt'] ? String(raw['scheduledAt']) : null,
    sentAt: raw['sentAt'] ? String(raw['sentAt']) : null,
    deliveredAt: raw['deliveredAt'] ? String(raw['deliveredAt']) : null,
    readAt: raw['readAt'] ? String(raw['readAt']) : null,
    externalMessageId: (raw['externalMessageId'] as string | null) ?? null,
    retryCount: raw['retryCount'] as number,
    failureReason: (raw['failureReason'] as string | null) ?? null,
    consentVerifiedAt: raw['consentVerifiedAt'] ? String(raw['consentVerifiedAt']) : null,
    metadata: raw['metadata'] ?? null,
    rowVersion: raw['rowVersion'] as number,
    createdAt: String(raw['createdAt']),
    updatedAt: String(raw['updatedAt']),
    createdById: createdByIdVal,
    createdBy:
      createdByIdVal != null && createdByDisplayIdVal != null
        ? {
            id: createdByIdVal,
            displayId: createdByDisplayIdVal,
            firstName: createdByFirstNameVal ?? '',
            lastName: createdByLastNameVal ?? '',
          }
        : null,
  }
}

// Drizzle's `sql.append(...)` MUTATES the source — calling it on a
// module-scoped constant accumulates clauses across requests (first request
// works, second one appends WHERE-on-top-of-WHERE and Postgres errors with
// 42601 "syntax error at or near WHERE"). The fix is a builder function
// that returns a fresh `sql` object every call.
function notificationSelect() {
  return sql`
  SELECT
    n.id,
    n.tenant_id          AS "tenantId",
    n.template_id        AS "templateId",
    nt.display_id        AS "templateDisplayId",
    nt.code              AS "templateCode",
    n.patient_id         AS "patientId",
    CASE
      WHEN p.id IS NOT NULL
        THEN p.first_name || ' ' || p.last_name
      ELSE NULL
    END                  AS "patientName",
    n.user_id            AS "userId",
    n.channel,
    n.recipient_address  AS "recipientAddress",
    n.subject,
    n.body,
    n.status,
    n.scheduled_at       AS "scheduledAt",
    n.sent_at            AS "sentAt",
    n.delivered_at       AS "deliveredAt",
    n.read_at            AS "readAt",
    n.external_message_id AS "externalMessageId",
    n.retry_count        AS "retryCount",
    n.failure_reason     AS "failureReason",
    n.consent_verified_at AS "consentVerifiedAt",
    n.metadata,
    n.row_version        AS "rowVersion",
    n.created_at         AS "createdAt",
    n.updated_at         AS "updatedAt",
    n.created_by_id      AS "createdById",
    cbu.display_id       AS "createdByDisplayId",
    cbu.first_name       AS "createdByFirstName",
    cbu.last_name        AS "createdByLastName"
  FROM notifications n
  LEFT JOIN notification_templates nt ON nt.id = n.template_id
  LEFT JOIN patients p ON p.id = n.patient_id
  LEFT JOIN users cbu ON cbu.id = n.created_by_id
`
}

// ─── listNotifications ────────────────────────────────────────────────────────

/**
 * Cursor encoding: base64("<created_at_iso>|<id>")
 * id is the bigint PK serialized as a decimal string.
 * Ordering: (created_at DESC, id DESC) for stability.
 */
export function encodeCursorNotif(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString('base64')
}

export function decodeCursorNotif(cursor: string): { ts: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8')
    const pipe = raw.lastIndexOf('|')
    if (pipe === -1) return null
    return { ts: raw.slice(0, pipe), id: raw.slice(pipe + 1) }
  } catch {
    return null
  }
}

export interface ListNotificationsOpts {
  tenantId: string
  userId: number | null
  status?: string
  patientId?: number
  channel?: string
  limit?: number
  cursor?: string
}

export interface ListNotificationsResult {
  rows: NotificationRow[]
  nextCursor: string | null
  totalCount: number
}

export async function listNotifications(
  opts: ListNotificationsOpts,
): Promise<ListNotificationsResult> {
  const { tenantId, userId, status, patientId, channel, cursor } = opts
  const limit = Math.min(opts.limit ?? 50, 200)

  return withTenantTx({ tenantId, userId: userId ?? 0, branchId: null }, async (tx) => {
    const statusFilter = status ? sql`AND n.status = ${status}` : sql``
    const patientFilter = patientId != null ? sql`AND n.patient_id = ${patientId}` : sql``
    const channelFilter = channel ? sql`AND n.channel = ${channel}` : sql``

    // Cursor filter (not included in count query)
    let cursorFilter = sql``
    if (cursor) {
      const decoded = decodeCursorNotif(cursor)
      if (decoded) {
        cursorFilter = sql`AND (n.created_at, n.id) < (${decoded.ts}::timestamptz, ${decoded.id}::bigint)`
      }
    }

    // Each fragment leads with whitespace because drizzle's sql.append
    // concatenates without inserting any separator. Without the leading
    // space, `WHERE n.tenant_id = $1` runs straight into `ORDER BY ...`
    // and Postgres parses it as `$1ORDER` — error 42601 "trailing junk
    // after parameter". The empty `sql\`\`` filters are safe because
    // they contribute zero characters either way.
    const [pageResult, countResult] = await Promise.all([
      tx.execute<Record<string, unknown>>(
        notificationSelect()
          .append(sql` WHERE n.tenant_id = ${tenantId}`)
          .append(statusFilter)
          .append(patientFilter)
          .append(channelFilter)
          .append(cursorFilter)
          .append(sql` ORDER BY n.created_at DESC, n.id DESC LIMIT ${limit + 1}`),
      ),
      tx.execute<{ total: number }>(
        sql`SELECT COUNT(*)::int AS total FROM notifications n`
          .append(sql` WHERE n.tenant_id = ${tenantId}`)
          .append(statusFilter)
          .append(patientFilter)
          .append(channelFilter),
      ),
    ])

    const allRows = Array.from(pageResult).map(mapRow)
    const hasMore = allRows.length > limit
    const rows = hasMore ? allRows.slice(0, limit) : allRows
    const last = rows[rows.length - 1]
    const nextCursor = hasMore && last ? encodeCursorNotif(last.createdAt, last.id) : null
    const totalCount = (Array.from(countResult)[0] as { total: number } | undefined)?.total ?? 0

    return { rows, nextCursor, totalCount }
  })
}

// ─── getNotification ──────────────────────────────────────────────────────────

export async function getNotification(
  tenantId: string,
  userId: number | null,
  id: number,
): Promise<NotificationRow | null> {
  return withTenantTx({ tenantId, userId: userId ?? 0, branchId: null }, async (tx) => {
    const rows = await tx.execute<Record<string, unknown>>(
      notificationSelect().append(sql`
        WHERE n.tenant_id = ${tenantId}
          AND n.id = ${id}
        LIMIT 1
      `),
    )

    const raw = Array.from(rows)[0]
    return raw ? mapRow(raw) : null
  })
}

// ─── resendNotification ───────────────────────────────────────────────────────

export interface ResendResult {
  /** New notification bigint PK as string. */
  newId: string
}

/** Returns null if original not found. newId === '__CONFLICT__' if already Queued. */
export async function resendNotification(
  tenantId: string,
  userId: number | null,
  originalId: number,
): Promise<ResendResult | null> {
  return withTenantTx({ tenantId, userId: userId ?? 0, branchId: null }, async (tx) => {
    const origRows = await tx.execute<Record<string, unknown>>(sql`
      SELECT
        id,
        status,
        patient_id        AS "patientId",
        template_id       AS "templateId",
        channel,
        recipient_address AS "recipientAddress",
        subject,
        body,
        scheduled_at      AS "scheduledAt",
        metadata
      FROM notifications
      WHERE tenant_id = ${tenantId}
        AND id = ${originalId}
      LIMIT 1
    `)

    const row = Array.from(origRows)[0]
    if (!row) return null

    // 409 signal
    if (row['status'] === 'Queued') {
      return { newId: '__CONFLICT__' }
    }

    // Let DB auto-generate the new bigserial id; capture via RETURNING.
    const insertedRows = await tx.execute<{ id: unknown }>(sql`
      INSERT INTO notifications (
        tenant_id, template_id, patient_id,
        channel, recipient_address, subject, body,
        status, scheduled_at, metadata,
        created_by_id,
        retry_count, row_version,
        created_at, updated_at
      )
      SELECT
        tenant_id,
        template_id,
        patient_id,
        channel,
        recipient_address,
        subject,
        body,
        'Queued',
        scheduled_at,
        metadata,
        ${userId},
        0, 0,
        now(), now()
      FROM notifications
      WHERE id = ${originalId}
        AND tenant_id = ${tenantId}
      RETURNING id
    `)

    const inserted = Array.from(insertedRows)[0]
    if (!inserted) return null

    return { newId: String(inserted.id) }
  })
}

// ─── dryRunNotification ───────────────────────────────────────────────────────

export interface DryRunResult {
  /** bigint PK serialized as string. */
  id: string
  tenantId: string
  /** bigint FK to patients. */
  patientId: number
  /** bigint FK to notification_templates or null. */
  templateId: number | null
  channel: string
  body: string
  status: string
  createdAt: string
}

export async function dryRunNotification(opts: {
  tenantId: string
  userId: number | null
  /** bigint PK of the patient. */
  patientId: number
  templateCode?: string | null
  channel: 'SMS' | 'Email' | 'Push'
  body?: string | null
}): Promise<DryRunResult> {
  const { tenantId, userId, patientId, templateCode, channel, body } = opts

  return withTenantTx({ tenantId, userId: userId ?? 0, branchId: null }, async (tx) => {
    // Resolve template by code if provided
    let templateId: number | null = null
    let resolvedBody = body ?? 'Dry-run notification'

    if (templateCode) {
      const tmplRows = await tx.execute<Record<string, unknown>>(sql`
        SELECT id, body
        FROM notification_templates
        WHERE tenant_id = ${tenantId}
          AND code      = ${templateCode}
          AND channel   = ${channel}
          AND is_active = true
          AND deleted_at IS NULL
        LIMIT 1
      `)
      const tmpl = Array.from(tmplRows)[0]
      if (tmpl) {
        templateId = Number(tmpl['id'])
        if (!body) resolvedBody = tmpl['body'] as string
      }
    }

    // Fetch the patient's recipient_address (required NOT NULL) from the patients table.
    // Use a placeholder address for dry-run (contact details may come from patient row).
    const insertedRows = await tx.execute<{ id: unknown; created_at: unknown }>(sql`
      INSERT INTO notifications (
        tenant_id, template_id, patient_id,
        channel, recipient_address, body, status,
        retry_count, row_version,
        created_by_id,
        created_at, updated_at
      ) VALUES (
        ${tenantId}, ${templateId}, ${patientId},
        ${channel}, '', ${resolvedBody}, 'Queued',
        0, 0,
        ${userId},
        now(), now()
      )
      RETURNING id, created_at
    `)

    const inserted = Array.from(insertedRows)[0]
    if (!inserted) throw new Error('dryRunNotification: INSERT returned no row')

    const now = inserted['created_at'] ? String(inserted['created_at']) : new Date().toISOString()

    return {
      id: String(inserted['id']),
      tenantId,
      patientId,
      templateId,
      channel,
      body: resolvedBody,
      status: 'Queued',
      createdAt: now,
    }
  })
}
