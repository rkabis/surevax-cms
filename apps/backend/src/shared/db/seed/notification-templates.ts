/**
 * Seed section — notification_templates.
 *
 * Seeds two notification templates so the /admin/notifications/templates
 * page is exercisable end-to-end (list + detail + dry-run send). Without
 * any rows the page renders empty and the Wave 11 verification "notification
 * template create + dry-run + send" step is blocked.
 */

import { displayId } from '../../utils/displayId.js'
import * as s from '../schema.js'
import { db } from './db.js'

export async function seedNotificationTemplates(opts: {
  tenantId: string
  createdById: number
}): Promise<void> {
  const { tenantId, createdById } = opts

  await db
    .insert(s.notificationTemplates)
    .values([
      {
        displayId: displayId('NTP'),
        tenantId,
        code: 'appointment_reminder_d-1',
        channel: 'SMS',
        language: 'en',
        subject: null,
        body: 'Hi {{patient.firstName}}, reminder of your appointment at {{branch.name}} tomorrow at {{appointment.startTime}}. Reply C to cancel.',
        isActive: true,
        createdById,
      },
      {
        displayId: displayId('NTP'),
        tenantId,
        code: 'dose_due_d0',
        channel: 'SMS',
        language: 'en',
        subject: null,
        body: 'Hi {{patient.firstName}}, your next dose ({{course.serviceName}}, dose {{course.doseNumber}}/{{course.totalDoses}}) is due today at {{branch.name}}. Walk-ins welcome 9am-6pm.',
        isActive: true,
        createdById,
      },
      {
        // RECALL-1: consumed by product_recalls fanOutRecallNotifications.
        displayId: displayId('NTP'),
        tenantId,
        code: 'recall_patient_notification',
        channel: 'SMS',
        language: 'en',
        subject: null,
        body: 'Hi {{patient.firstName}}, an important safety notice from {{branch.name}}: a product you received ({{recall.productName}}, batch {{recall.batchNumber}}) is subject to a recall ({{recall.reason}}). Please contact us as soon as possible.',
        isActive: true,
        createdById,
      },
    ])
    .onConflictDoNothing()

  console.log('  ✓ notification templates (3 seeded)')
}
