/**
 * Seed section — product_recalls.
 *
 * Seeds one active (unresolved) product recall whose `affected_lots_pattern`
 * matches existing inventory lots (Flu vaccine batches `FLU-2026-*`).
 * Drives the recall list page, the recall create→list flow, and the
 * AdministerDialog "lot is recalled" banner logic (#30 in preview-coverage).
 */

import { displayId } from '../../utils/displayId.js'
import * as s from '../schema.js'
import { db } from './db.js'

export async function seedRecalls(opts: { tenantId: string; createdById: number }): Promise<void> {
  const { tenantId, createdById } = opts

  // ISO 0:00 today minus 2 days — clinic noticed the recall two days ago.
  const now = new Date()
  const issuedAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 9, 30)

  await db
    .insert(s.productRecalls)
    .values({
      displayId: displayId('RCL'),
      tenantId,
      // productId NULL = pattern-only scope; any product whose lot batch
      // number starts with FLU-2026- is treated as recalled. Simulates a
      // manufacturer batch-level recall covering multiple SKUs.
      productId: null,
      recallNo: 'FDA-2026-RBI-0007',
      manufacturer: 'Sanofi Pasteur',
      // NOTE: the recall matcher (product_recalls/db.ts, INV-4 + RECALL-2)
      // escapes LIKE metacharacters in the stored pattern and then anchors a
      // prefix match (`<pattern>%` / startsWith). Store the bare prefix — a
      // trailing '%' would be escaped to a literal and match no lot. This
      // prefix hits the CURRENT lot FLU-2026-012 (quantity_on_hand > 0), so
      // the recall-affecting-a-live-lot workflow is exercisable.
      affectedLotsPattern: 'FLU-2026-',
      recallReason:
        'Manufacturer-issued Class II recall — potential sub-potency for the 2026 Northern Hemisphere quadrivalent flu lots in batch FLU-2026-*. Quarantine affected inventory and notify patients who received doses within 30 days.',
      recallSeverity: 'Class2',
      issuedAt,
      patientNotificationRequired: true,
      createdById,
    })
    .onConflictDoNothing()

  console.log('  ✓ recalls (1 active — FLU-2026- prefix lots)')
}
