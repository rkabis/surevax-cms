/**
 * dashboard API contract — schemas + endpoint manifest.
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

// ── Response schemas (wire truth — keep in lockstep with db.ts) ──────────────

const trend7dSchema = z.object({
  /** 7-day daily arrival counts, oldest → newest, today inclusive. */
  arrivals: z.array(z.number()),
  /** numeric(12,2) strings — parse explicitly (parseFloat) before charting. */
  revenue: z.array(z.string()),
  /** 7-day daily unsettled-transaction counts, oldest → newest, today inclusive. */
  unsettled: z.array(z.number()),
})

const dashboardStatsSchema = z.object({
  patientsToday: z.number(),
  encountersToday: z.number(),
  scheduledOrdersDueToday: z.number(),
  pendingPayments: z.number(),
  walkInCount: z.number(),
  bookedCount: z.number(),
  /** numeric(12,2) — unsettled AR total, crosses the wire as a string. */
  unsettledTotal: z.string(),
  /** numeric(12,2) — cash collected today, crosses the wire as a string. */
  cashCollectedToday: z.string(),
  /** numeric(12,2) — non-cash collected today, crosses the wire as a string. */
  nonCashCollectedToday: z.string(),
  trend7d: trend7dSchema,
})

const dashboardEncounterSchema = z.object({
  id: z.string(),
  patientDisplayId: z.string(),
  patientName: z.string(),
  specialty: z.string().nullable(),
  status: z.string(),
  attendingClinicianName: z.string().nullable(),
  /** Human-readable time string from toLocaleTimeString. */
  time: z.string(),
  completedAt: z.string().nullable(),
})

const dashboardScheduledOrderSchema = z.object({
  id: z.string(),
  patientName: z.string(),
  service: z.string(),
  doseNumber: z.number(),
  /** Human-readable label: 'Today', 'Tomorrow', or 'Upcoming'. */
  scheduledDate: z.string(),
})

const dashboardLowStockLotSchema = z.object({
  id: z.string(),
  name: z.string(),
  batchNumber: z.string(),
  quantityOnHand: z.number(),
  /** date column (YYYY-MM-DD) or null. */
  expiryDate: z.string().nullable(),
})

const dashboardResponseSchema = z.object({
  stats: dashboardStatsSchema,
  scheduledOrderStats: z.object({
    dueCount: z.number(),
    overdueCount: z.number(),
    backfillCount: z.number(),
    upcomingCount: z.number(),
  }),
  recentEncounters: z.array(dashboardEncounterSchema),
  scheduledOrdersDue: z.array(dashboardScheduledOrderSchema),
  lowStock: z.array(dashboardLowStockLotSchema),
})

const nudgeSchema = z.object({
  id: z.string(),
  kind: z.enum(['overdue_order', 'pending_transaction', 'low_stock']),
  label: z.string(),
  sub: z.string(),
  severity: z.enum(['overdue', 'due', 'info']),
  dueAt: z.string().nullable(),
  link: z.string(),
})

// ── Manifest ─────────────────────────────────────────────────────────────────

export const dashboardContract = defineContract('dashboard', {
  list: {
    method: 'GET',
    path: '/api/dashboard',
    response: dashboardResponseSchema,
  },
  nudges: {
    method: 'GET',
    path: '/api/dashboard/nudges',
    response: z.array(nudgeSchema),
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ───────

export type DashboardListResponse = z.infer<typeof dashboardResponseSchema>
export type DashboardNudgesResponse = z.infer<typeof nudgeSchema>[]
