/**
 * Seed section — staff time logs.
 *
 * Two-tier IDs (W3.c.4, 2026-05-19):
 *   - `staff_time_logs.id` is bigserial — Postgres assigns. The seed sets
 *     `display_id` to a fresh `TLG_<8 base32>` via `displayId('TLG')`.
 *   - `user_id` / `branch_id` are bigint internals threaded from the caller.
 *
 * The previous shape (`AR-2026-…` approval requests, TXN/CO cross-references)
 * has been dropped — those entities haven't been threaded through to this
 * seed in W3, and approval-request rewiring is scoped to a separate wave.
 */

import * as s from '../schema.js'
import { db } from './db.js'
import { daysAgo, seqSuffix } from './helpers.js'

export type ShiftsSeedUsers = {
  admin: number
  nurse: number
  cashier: number
  physician: number
  /** Optional secondary nurse — soft-skipped if absent. */
  nurse2?: number | undefined
}

export type SeedShiftsArgs = {
  tenantId: string
  branchId: number
  users: ShiftsSeedUsers
}

type ShiftSpec = {
  /** Short alias matched against the `users` map; rows for absent aliases are dropped. */
  key: 'admin' | 'physician' | 'nurse' | 'nurse2' | 'cashier'
  daysBack: number
  inHour: number
  inMinute: number
  /** Omit both `outHour` and `outMinute` for an active (no clock-out) shift. */
  outHour?: number
  outMinute?: number
}

function totalHours(inH: number, inM: number, outH: number, outM: number): string {
  const minutes = outH * 60 + outM - (inH * 60 + inM)
  return (minutes / 60).toFixed(2)
}

export async function seedShifts({ tenantId, branchId, users }: SeedShiftsArgs): Promise<void> {
  // Full week (Mon–Fri last week + Mon–Fri this week up to today).
  const shiftRows: ShiftSpec[] = [
    // Today — active (no clock out)
    { key: 'admin', daysBack: 0, inHour: 7, inMinute: 55 },
    { key: 'physician', daysBack: 0, inHour: 7, inMinute: 45 },
    { key: 'nurse', daysBack: 0, inHour: 7, inMinute: 30 },
    { key: 'cashier', daysBack: 0, inHour: 8, inMinute: 15 },
    // Yesterday
    { key: 'nurse2', daysBack: 1, inHour: 7, inMinute: 50, outHour: 16, outMinute: 5 },
    { key: 'physician', daysBack: 1, inHour: 8, inMinute: 0, outHour: 17, outMinute: 10 },
    { key: 'nurse', daysBack: 1, inHour: 7, inMinute: 25, outHour: 16, outMinute: 30 },
    { key: 'cashier', daysBack: 1, inHour: 8, inMinute: 0, outHour: 16, outMinute: 0 },
    // 2 days ago
    { key: 'admin', daysBack: 2, inHour: 8, inMinute: 0, outHour: 17, outMinute: 0 },
    { key: 'physician', daysBack: 2, inHour: 7, inMinute: 50, outHour: 17, outMinute: 0 },
    { key: 'nurse', daysBack: 2, inHour: 7, inMinute: 30, outHour: 16, outMinute: 30 },
    { key: 'nurse2', daysBack: 2, inHour: 8, inMinute: 0, outHour: 16, outMinute: 0 },
    { key: 'cashier', daysBack: 2, inHour: 8, inMinute: 5, outHour: 16, outMinute: 5 },
    // 3 days ago
    { key: 'admin', daysBack: 3, inHour: 8, inMinute: 0, outHour: 17, outMinute: 0 },
    { key: 'physician', daysBack: 3, inHour: 8, inMinute: 0, outHour: 17, outMinute: 0 },
    { key: 'nurse', daysBack: 3, inHour: 7, inMinute: 30, outHour: 16, outMinute: 0 },
    { key: 'cashier', daysBack: 3, inHour: 8, inMinute: 0, outHour: 16, outMinute: 0 },
    // 4 days ago
    { key: 'admin', daysBack: 4, inHour: 8, inMinute: 0, outHour: 17, outMinute: 0 },
    { key: 'physician', daysBack: 4, inHour: 7, inMinute: 55, outHour: 16, outMinute: 50 },
    { key: 'nurse2', daysBack: 4, inHour: 7, inMinute: 45, outHour: 16, outMinute: 0 },
    { key: 'cashier', daysBack: 4, inHour: 8, inMinute: 10, outHour: 16, outMinute: 10 },
    // 5 days ago
    { key: 'nurse', daysBack: 5, inHour: 7, inMinute: 30, outHour: 16, outMinute: 0 },
    { key: 'physician', daysBack: 5, inHour: 8, inMinute: 0, outHour: 12, outMinute: 0 },
    // 7 days ago
    { key: 'nurse2', daysBack: 7, inHour: 7, inMinute: 45, outHour: 16, outMinute: 5 },
  ]

  let kept = 0
  let skipped = 0
  for (const [shIdx, spec] of shiftRows.entries()) {
    const userBigint = users[spec.key]
    if (userBigint === undefined) {
      skipped++
      continue
    }
    const clockInAt = daysAgo(spec.daysBack, spec.inHour, spec.inMinute)
    const clockOutAt =
      spec.outHour !== undefined && spec.outMinute !== undefined
        ? daysAgo(spec.daysBack, spec.outHour, spec.outMinute)
        : null
    const total =
      spec.outHour !== undefined && spec.outMinute !== undefined
        ? totalHours(spec.inHour, spec.inMinute, spec.outHour, spec.outMinute)
        : null

    await db
      .insert(s.staffTimeLogs)
      .values({
        // Index-derived, NOT a random `displayId()` — see transactions.ts.
        displayId: `TLG_${seqSuffix(shIdx, 8)}`,
        tenantId,
        userId: userBigint,
        branchId,
        clockInAt,
        clockOutAt,
        totalHours: total,
        createdById: userBigint,
      })
      .onConflictDoNothing()
    kept++
  }

  console.log(
    `  ✓ staff time logs (${kept} inserted${skipped > 0 ? `, ${skipped} skipped — user not seeded` : ''})`,
  )

  // Open cash drawer for today (branch-day shared drawer). Without a real
  // cash_drawer_sessions row the dashboard/cashier "drawer open" indicator
  // (driven by shifts.drawerState) and GET /api/cash-drawer/current disagree —
  // the indicator falsely read "OPEN" while /current 404'd. Seeding one open
  // drawer keeps both honest and lets the Day-0 collect-payment flow link cash
  // to a session for end-of-day reconciliation.
  const drawerOwner = users.cashier ?? users.admin
  await db
    .insert(s.cashDrawerSessions)
    .values({
      displayId: `CSH_${seqSuffix(0, 8)}`,
      tenantId,
      userId: drawerOwner,
      branchId,
      state: 'Open',
      openingFloat: '2000.00',
      openedAt: daysAgo(0, 8, 15),
      createdById: drawerOwner,
    })
    .onConflictDoNothing()
  console.log('  ✓ cash drawer session (1 open · today)')
}
