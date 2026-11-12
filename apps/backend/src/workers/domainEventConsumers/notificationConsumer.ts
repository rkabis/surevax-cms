import { sql } from 'drizzle-orm'
import type { DomainEventRow } from '../domainEventsPublisher.js'
import { logger } from '../../shared/utils/logger.js'

/**
 * Notification trigger consumer — reacts to domain events by enqueuing
 * notifications based on matching notification_templates.
 *
 * Domain-event payloads carry display_ids (per spec #11): `patientId` is a
 * PAT_ display id, `templateId` is an NTP_ display id. This consumer resolves
 * them to internal bigint FKs before inserting into the notifications table,
 * which uses bigint FKs.
 *
 * NOTIF-1 fixes:
 *   (a) interpolation regex now supports dotted paths ({{patient.firstName}})
 *   (b) EVENT_TO_TEMPLATE_CODE aligned to seeded template codes
 *   (c) patient contact (contactNumber / email) looked up when not on payload
 *   (d) send path wired through notificationsDispatcher (marks Sent on success)
 *
 * NOTIF-2 fix:
 *   Consent gate checked before enqueuing — skips + logs when consent absent.
 */

type Tx = Parameters<Parameters<typeof import('../../shared/db/index.js').db.transaction>[0]>[0]

// Maps domain event type → seeded notification_template code.
// Aligned to the codes in apps/backend/src/shared/db/seed/notification-templates.ts.
const EVENT_TO_TEMPLATE_CODE: Record<string, string> = {
  // Appointment 1-day-before reminder (seeded as 'appointment_reminder_d-1')
  AppointmentScheduled: 'appointment_reminder_d-1',
  AppointmentConfirmed: 'appointment_reminder_d-1',
  // Dose due today (seeded as 'dose_due_d0')
  ClinicalOrderScheduled: 'dose_due_d0',
  // Recall patient notification (seeded or created dynamically)
  ProductRecallNotification: 'recall_patient_notification',
}

export async function notificationConsumer(row: DomainEventRow, tx: Tx): Promise<void> {
  const templateCode = EVENT_TO_TEMPLATE_CODE[row.eventType]
  if (!templateCode) return

  const p = row.payload as Record<string, unknown>
  const patientDisplayId = p.patientId as string | undefined
  if (!patientDisplayId) return

  // Resolve patient display_id → bigint + contact info within the event's tenant.
  const patientRows = await tx.execute<{
    id: string
    firstName: string | null
    lastName: string | null
    contactNumber: string | null
    email: string | null
    smsOptIn: boolean
    emailOptIn: boolean
    preferredLanguage: string
  }>(sql`
    SELECT
      id,
      first_name      AS "firstName",
      last_name       AS "lastName",
      contact_number  AS "contactNumber",
      email,
      sms_opt_in      AS "smsOptIn",
      email_opt_in    AS "emailOptIn",
      preferred_language AS "preferredLanguage"
    FROM patients
    WHERE tenant_id  = ${row.tenantId}
      AND display_id = ${patientDisplayId}
      AND deleted_at IS NULL
    LIMIT 1
  `)

  const patientRow = patientRows[0]
  if (!patientRow?.id) {
    logger.debug(
      { eventType: row.eventType, eventId: row.id, patientDisplayId },
      '[notification-consumer] patient display_id not found in tenant — skipping',
    )
    return
  }

  const patientInternalId = Number(patientRow.id)

  // NOTIF-2: Consent gate — skip PHI messaging when patient consent is absent/revoked.
  const consentRows = await tx.execute<{ id: string }>(sql`
    SELECT id
    FROM consents
    WHERE tenant_id  = ${row.tenantId}
      AND patient_id = ${patientInternalId}
      AND revoked_at IS NULL
      AND deleted_at IS NULL
    LIMIT 1
  `)

  if (!consentRows[0]) {
    logger.info(
      { eventType: row.eventType, eventId: row.id, patientDisplayId },
      '[notification-consumer] patient has no active consent — skipping PHI notification',
    )
    return
  }

  const template = await resolveTemplate(
    row.tenantId,
    templateCode,
    patientRow.preferredLanguage ?? 'en',
    tx,
  )

  if (!template) {
    logger.debug(
      { eventType: row.eventType, tenantId: row.tenantId, templateCode },
      '[notification-consumer] no active template found',
    )
    return
  }

  const channel = template.channel ?? 'SMS'

  // Derive recipient address from payload → fall back to patient record.
  let recipientAddress: string | null = (p.recipientAddress as string | undefined) ?? null
  if (!recipientAddress) {
    if (channel === 'Email') {
      recipientAddress = patientRow.emailOptIn ? (patientRow.email ?? null) : null
    } else {
      // SMS / Push: use contactNumber; honour sms_opt_in flag
      recipientAddress = patientRow.smsOptIn ? (patientRow.contactNumber ?? null) : null
    }
  }

  if (!recipientAddress) {
    logger.info(
      { eventType: row.eventType, eventId: row.id, patientDisplayId, channel },
      '[notification-consumer] patient has no reachable address for channel or has opted out — skipping',
    )
    return
  }

  // Build template variables: merge payload + resolved patient fields.
  const templateVars: Record<string, unknown> = {
    ...p,
    'patient.firstName': patientRow.firstName ?? '',
    'patient.lastName': patientRow.lastName ?? '',
    'patient.contactNumber': patientRow.contactNumber ?? '',
    'patient.email': patientRow.email ?? '',
  }

  const body = interpolateTemplate(template.bodyTemplate ?? '', templateVars)
  const subject = template.subjectTemplate
    ? interpolateTemplate(template.subjectTemplate, templateVars)
    : null

  // Idempotency guard: skip if a notification for this event was already enqueued
  // (handles event redelivery on worker retry without creating duplicate messages).
  const existing = await tx.execute<{ id: string }>(sql`
    SELECT id FROM notifications
    WHERE tenant_id = ${row.tenantId}
      AND metadata->>'eventId' = ${String(row.id)}
    LIMIT 1
  `)
  if (existing[0]) {
    logger.debug(
      { eventType: row.eventType, eventId: row.id, existingId: existing[0].id },
      '[notification-consumer] already enqueued — skipping duplicate',
    )
    return
  }

  // notifications.id is bigserial — let the DB allocate it.
  const inserted = await tx.execute<{ id: string }>(sql`
    INSERT INTO notifications (
      tenant_id, template_id, patient_id,
      channel, recipient_address, subject, body,
      status,
      consent_verified_at,
      metadata,
      created_at, updated_at
    ) VALUES (
      ${row.tenantId},
      ${template.id},
      ${patientInternalId},
      ${channel},
      ${recipientAddress},
      ${subject},
      ${body},
      'Queued',
      now(),
      ${JSON.stringify({ eventId: String(row.id), eventType: row.eventType })}::jsonb,
      now(), now()
    )
    RETURNING id
  `)

  const notificationId = inserted[0]?.id ?? null

  logger.info(
    {
      notificationId,
      eventType: row.eventType,
      patientDisplayId,
      templateCode,
      channel,
    },
    '[notification-consumer] enqueued notification',
  )
}

/**
 * Resolve a template by (tenantId, code, language) picking the best match.
 *
 * NOTIF-3 fix: query uses (code, channel preference, language) ORDER BY so
 * `LIMIT 1` picks the right-channel/language row instead of a random one.
 *
 * Channel preference: SMS first (broadest reach for clinic ops), then Email.
 * Language: exact match first, then 'en' fallback.
 */
async function resolveTemplate(
  tenantId: string,
  code: string,
  language: string,
  tx: Tx,
): Promise<{
  id: number
  channel: string
  subjectTemplate: string | null
  bodyTemplate: string
} | null> {
  // notification_templates columns are `subject` and `body` (not subject_template /
  // body_template — that earlier draft did not match the shipped schema).
  //
  // ORDER BY:
  //   1. Exact language match first (CASE gives 0 for exact, 1 for fallback)
  //   2. SMS before Email before Push (preferred outbound channel for clinic ops)
  const result = await tx.execute<Record<string, unknown>>(sql`
    SELECT
      id,
      channel,
      subject AS "subjectTemplate",
      body    AS "bodyTemplate"
    FROM notification_templates
    WHERE tenant_id  = ${tenantId}
      AND code       = ${code}
      AND is_active  = true
      AND deleted_at IS NULL
    ORDER BY
      CASE WHEN language = ${language} THEN 0 ELSE 1 END,
      CASE channel
        WHEN 'SMS'   THEN 0
        WHEN 'Email' THEN 1
        ELSE              2
      END
    LIMIT 1
  `)

  if (!result[0]) return null
  return {
    id: Number(result[0]['id']),
    channel: result[0]['channel'] as string,
    subjectTemplate: (result[0]['subjectTemplate'] as string | null) ?? null,
    bodyTemplate: result[0]['bodyTemplate'] as string,
  }
}

/**
 * Interpolate `{{key}}` and `{{dotted.path}}` placeholders.
 *
 * NOTIF-1(a) fix: previous regex `\w+` could not match dotted keys like
 * `patient.firstName`.  The new pattern `[\w.]+` matches word chars + dots.
 *
 * Resolution order for a dotted key like `patient.firstName`:
 *   1. Exact flat key match (`vars['patient.firstName']`)
 *   2. Nested object traversal (`vars['patient']['firstName']`)
 *
 * Unknown keys are left as-is (`{{unknown}}`).
 */
function interpolateTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_match, key: string) => {
    // Try flat key first (covers pre-flattened keys like 'patient.firstName')
    if (Object.prototype.hasOwnProperty.call(vars, key) && vars[key] != null) {
      return String(vars[key])
    }

    // Try nested traversal for dotted paths
    const parts = key.split('.')
    let cursor: unknown = vars
    for (const part of parts) {
      if (cursor == null || typeof cursor !== 'object') {
        cursor = undefined
        break
      }
      cursor = (cursor as Record<string, unknown>)[part]
    }

    return cursor != null ? String(cursor) : `{{${key}}}`
  })
}
