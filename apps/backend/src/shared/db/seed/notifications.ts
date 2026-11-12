/**
 * Seed section — notification rows (the outbound SMS/Email log + reminder
 * queue). Distinct from notification_templates (the message blueprints, seeded
 * separately).
 *
 * Status + channel coverage:
 *   - Queued reminder scheduled for tomorrow (appointment / dose reminders)
 *   - Sent + delivered (read and unread)
 *   - Failed with a retry count + failure reason
 *
 * Recipient addresses match the seeded patients' contact details. `template_id`
 * and `entity_id` are left null (both nullable) — the notification body is
 * self-contained, which is enough for the log/bell UI.
 */

import { eq, sql } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import { daysAgo, daysFromNow, today } from './helpers.js'
import {
  PAT_DELACRUZ_DISPLAY_ID,
  PAT_TORRES_DISPLAY_ID,
  PAT_LIM_DISPLAY_ID,
  PAT_REYES_DISPLAY_ID,
  PAT_VILLANUEVA_DISPLAY_ID,
  PAT_LUNA_DISPLAY_ID,
  PAT_NAVARRO_DISPLAY_ID,
} from './constants.js'

type Channel = 'SMS' | 'Email' | 'Push'
type Status = 'Queued' | 'Sent' | 'Failed' | 'Cancelled'

type NotificationSeed = {
  patientDisplayId: string
  channel: Channel
  recipientAddress: string
  subject?: string
  body: string
  status: Status
  entityType?: string
  scheduledAt?: Date
  sentAt?: Date
  deliveredAt?: Date
  readAt?: Date
  retryCount?: number
  failureReason?: string
}

const NOTIFICATION_ROWS: NotificationSeed[] = [
  {
    patientDisplayId: PAT_REYES_DISPLAY_ID,
    channel: 'SMS',
    recipientAddress: '0922-678-9012',
    body: 'SureVax: Reminder — your Rabies PEP Day-3 dose is tomorrow at 9:00 AM, Holy Spirit branch. Reply C to confirm.',
    status: 'Queued',
    entityType: 'appointment',
    scheduledAt: daysFromNow(1, 8, 0),
  },
  {
    patientDisplayId: PAT_LUNA_DISPLAY_ID,
    channel: 'SMS',
    recipientAddress: '0932-678-9005',
    body: 'SureVax: Your next Rabies PEP dose is due this week. Please visit the clinic to stay on schedule.',
    status: 'Sent',
    entityType: 'clinical_order',
    sentAt: today(7, 0),
    deliveredAt: today(7, 1),
  },
  {
    patientDisplayId: PAT_VILLANUEVA_DISPLAY_ID,
    channel: 'SMS',
    recipientAddress: '0920-456-7890',
    body: 'SureVax: 14-day animal observation is due today. Please report the biting animal’s condition to the clinic.',
    status: 'Sent',
    entityType: 'animal_followup',
    sentAt: today(8, 0),
    deliveredAt: today(8, 1),
  },
  {
    patientDisplayId: PAT_LIM_DISPLAY_ID,
    channel: 'Email',
    recipientAddress: 'grace.lim@company.com',
    subject: 'Your SureVax visit summary',
    body: 'Thank you for visiting SureVax. Your flu vaccination is recorded. Your official receipt is attached.',
    status: 'Sent',
    entityType: 'transaction',
    sentAt: today(12, 0),
    deliveredAt: today(12, 1),
    readAt: today(12, 30),
  },
  {
    patientDisplayId: PAT_TORRES_DISPLAY_ID,
    channel: 'SMS',
    recipientAddress: '0918-234-5678',
    body: 'SureVax: Reminder — your Rabies PEP Day-3 dose is due soon.',
    status: 'Failed',
    entityType: 'clinical_order',
    sentAt: daysAgo(0, 9, 0),
    retryCount: 2,
    failureReason: 'Carrier rejected message — invalid handset / out of coverage.',
  },
  {
    patientDisplayId: PAT_NAVARRO_DISPLAY_ID,
    channel: 'Email',
    recipientAddress: 'maricel.navarro@email.com',
    subject: 'Post-vaccination follow-up',
    body: 'Following your reported reaction, please monitor for any worsening symptoms and contact us immediately if they recur.',
    status: 'Sent',
    entityType: 'adverse_event',
    sentAt: daysAgo(1, 14, 30),
    deliveredAt: daysAgo(1, 14, 31),
  },
  {
    patientDisplayId: PAT_DELACRUZ_DISPLAY_ID,
    channel: 'SMS',
    recipientAddress: '0917-123-4567',
    body: 'SureVax: You are registered for Rabies PEP. Your full dose schedule: Day 0, 3, 7, 14, 28. We’ll remind you before each.',
    status: 'Sent',
    entityType: 'patient',
    sentAt: today(9, 30),
    deliveredAt: today(9, 31),
    readAt: today(9, 45),
  },
]

export async function seedNotifications(args: {
  tenantId: string
  patients: Map<string, number>
  createdById: number
}): Promise<void> {
  const { tenantId, patients, createdById } = args

  // `notifications` is a bigserial-only table: no display_id, and no natural
  // unique key for `onConflictDoNothing` to catch. Without this guard a second
  // `pnpm db:seed` appended a whole fresh copy of the fixture set every time
  // (7 -> 14 -> 21). Every other section is idempotent via a deterministic
  // display_id; this one has to check for itself.
  const [already] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.notifications)
    .where(eq(s.notifications.tenantId, tenantId))
  if ((already?.n ?? 0) > 0) {
    console.log(`  ↷ notifications (already seeded: ${already?.n})`)
    return
  }

  let inserted = 0
  for (const n of NOTIFICATION_ROWS) {
    const patientId = patients.get(n.patientDisplayId)
    if (patientId === undefined) {
      throw new Error(`seedNotifications: missing patient ${n.patientDisplayId}`)
    }

    const row = await db
      .insert(s.notifications)
      .values({
        tenantId,
        templateId: null,
        patientId,
        userId: null,
        channel: n.channel,
        recipientAddress: n.recipientAddress,
        subject: n.subject ?? null,
        body: n.body,
        status: n.status,
        entityType: n.entityType ?? null,
        entityId: null,
        scheduledAt: n.scheduledAt ?? null,
        sentAt: n.sentAt ?? null,
        deliveredAt: n.deliveredAt ?? null,
        readAt: n.readAt ?? null,
        retryCount: n.retryCount ?? 0,
        failureReason: n.failureReason ?? null,
        createdById,
      })
      .onConflictDoNothing()
      .returning({ id: s.notifications.id })

    if (row[0]) inserted++
  }

  console.log(`  ✓ notifications (${inserted})`)
}
