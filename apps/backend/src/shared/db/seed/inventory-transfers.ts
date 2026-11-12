/**
 * Seed section — inventory transfers (inter-branch stock movement).
 *
 * Covers the full transfer lifecycle from the HST hub to the satellite
 * branches:
 *   - PendingReceipt → shows on the destination branch's "incoming" list
 *   - Received       → closed, with receivedAt / receivedById
 *   - Cancelled      → reversed before receipt
 *
 * Source lots are resolved by batch number from the HST inventory seeded
 * earlier. Transfers that can't find their source lot are soft-skipped (keeps
 * the seed resilient if the inventory wave changed). The seed writes the
 * transfer record only — it does NOT mutate lot balances (illustrative
 * quantities), so the negative-inventory CHECK and lot-balance trigger stay
 * untouched.
 *
 * Two-tier IDs: `inventory_transfers.id` bigserial; `display_id` = `TRF_…`.
 */

import { and, eq } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import { daysAgo, today, seqSuffix } from './helpers.js'

type TransferStatus = 'PendingReceipt' | 'Received' | 'Cancelled'

type TransferSeed = {
  destBranchCode: keyof BranchMap
  /** Source lot batch number (must exist in the HST inventory seed). */
  batchNumber: string
  quantity: string
  status: TransferStatus
  shippedAt: Date
  receivedAt?: Date
  cancelledAt?: Date
  notes?: string
}

type BranchMap = {
  tim: number
  tag: number
  abf: number
  psg: number
}

const TRANSFER_ROWS: TransferSeed[] = [
  {
    destBranchCode: 'tim',
    batchNumber: 'VRB-2026-003',
    quantity: '10',
    status: 'PendingReceipt',
    shippedAt: daysAgo(1, 14, 0),
    notes: 'Restock Timog branch — ARV running low.',
  },
  {
    destBranchCode: 'psg',
    batchNumber: 'ERI-2026-009',
    quantity: '3',
    status: 'PendingReceipt',
    shippedAt: today(8, 30),
    notes: 'ERIG for incoming Cat-III case at Pasig.',
  },
  {
    destBranchCode: 'tag',
    batchNumber: 'FLU-2026-012',
    quantity: '5',
    status: 'Received',
    shippedAt: daysAgo(4, 9, 0),
    receivedAt: daysAgo(3, 10, 30),
    notes: 'Flu stock for Taguig vaccination drive.',
  },
  {
    destBranchCode: 'abf',
    batchNumber: 'TT-2026-007',
    quantity: '8',
    status: 'Cancelled',
    shippedAt: daysAgo(2, 13, 0),
    cancelledAt: daysAgo(2, 15, 0),
    notes: 'Cancelled — Baclaran reported sufficient TT stock on hand.',
  },
]

export async function seedInventoryTransfers(args: {
  tenantId: string
  sourceBranchId: number
  destinationBranches: BranchMap
  shippedById: number
  receivedById: number
}): Promise<void> {
  const { tenantId, sourceBranchId, destinationBranches, shippedById, receivedById } = args

  let inserted = 0
  let skipped = 0
  let transferSeq = 0

  for (const [tIdx, t] of TRANSFER_ROWS.entries()) {
    const [lot] = await db
      .select({ id: s.inventoryLots.id })
      .from(s.inventoryLots)
      .where(
        and(
          eq(s.inventoryLots.tenantId, tenantId),
          eq(s.inventoryLots.branchId, sourceBranchId),
          eq(s.inventoryLots.batchNumber, t.batchNumber),
        ),
      )
      .limit(1)

    if (!lot) {
      skipped++
      continue
    }

    transferSeq++
    const row = await db
      .insert(s.inventoryTransfers)
      .values({
        // Index-derived, NOT a random `displayId()` — see transactions.ts.
        displayId: `TRF_${seqSuffix(tIdx, 8)}`,
        transferRef: `TRF-${String(transferSeq).padStart(4, '0')}`,
        tenantId,
        sourceBranchId,
        destinationBranchId: destinationBranches[t.destBranchCode],
        lotId: lot.id,
        destinationLotId: null,
        quantity: t.quantity,
        status: t.status,
        shippedAt: t.shippedAt,
        receivedAt: t.receivedAt ?? null,
        cancelledAt: t.cancelledAt ?? null,
        shippedById,
        receivedById: t.status === 'Received' ? receivedById : null,
        cancelledById: t.status === 'Cancelled' ? shippedById : null,
        notes: t.notes ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: s.inventoryTransfers.id })

    if (row[0]) inserted++
  }

  const suffix = skipped > 0 ? ` — ${skipped} skipped (source lot not found)` : ''
  console.log(`  ✓ inventory transfers (${inserted})${suffix}`)
}
