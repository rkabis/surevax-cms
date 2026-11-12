/**
 * Seed section — approval_requests.
 *
 * Seeds one pending approval so the /admin/approvals page is exercisable
 * end-to-end (approve/reject flow + detail rail). Without this row the
 * page is permanently empty and #28 in the preview-coverage doc is blocked.
 */

import { displayId } from '../../utils/displayId.js'
import * as s from '../schema.js'
import { db } from './db.js'

export async function seedApprovals(opts: {
  tenantId: string
  branchId: number
  requestedById: number
}): Promise<void> {
  const { tenantId, branchId, requestedById } = opts

  await db
    .insert(s.approvalRequests)
    .values({
      displayId: displayId('APR'),
      tenantId,
      branchId,
      requestType: 'discount_override',
      description: 'Manual 15% loyalty discount on TXN_…  for repeat patient',
      details: 'Patient requested goodwill discount on follow-up consult. Within branch policy.',
      status: 'Pending',
      requestedById,
      requiredApprovers: 1,
      approverRole: 'TenantAdmin',
    })
    .onConflictDoNothing()

  console.log('  ✓ approvals (1 pending)')
}
