/**
 * day-summary API contract — schemas + endpoint manifest.
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
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'

// ── Request schemas (runtime validators for routes.ts) ──────────────────────

export const daySummaryQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
})

export const snapshotBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
})

export const todayRosterOwnerBodySchema = z.object({
  assigneeId: prefixedDisplayIdSchema('USR').optional(),
  attestationPin: z
    .string()
    .regex(/^\d{4}$/, 'PIN must be exactly 4 digits')
    .optional(),
  expectedRowVersion: z.number().int().nonnegative(),
})

// ── Response sub-schemas ──────────────────────────────────────────────────────

const byMethodRowSchema = z.object({
  method: z.string(),
  count: z.number(),
  /** numeric(12,2) — crosses the wire as a string. */
  total: z.string(),
})

const byStatusRowSchema = z.object({
  status: z.string(),
  count: z.number(),
  /** numeric(12,2) — crosses the wire as a string. */
  total: z.string(),
})

const transactionsSummarySchema = z.object({
  count: z.number(),
  /** numeric(12,2) — crosses the wire as a string. */
  totalRevenue: z.string(),
  /** numeric(12,2) — crosses the wire as a string. */
  totalUnsettled: z.string(),
  byMethod: z.array(byMethodRowSchema),
  byStatus: z.array(byStatusRowSchema),
})

const administrationRowSchema = z.object({
  orderId: z.string(),
  patientId: z.string(),
  patientName: z.string(),
  serviceName: z.string(),
  lotNumber: z.string().nullable(),
  administeredAt: z.string(),
  administeredByName: z.string().nullable(),
})

const administrationsSummarySchema = z.object({
  count: z.number(),
  rows: z.array(administrationRowSchema),
})

const byBundleRowSchema = z.object({
  bundleLabel: z.string(),
  count: z.number(),
})

const byWhoCategoryRowSchema = z.object({
  category: z.string(),
  count: z.number(),
})

const encountersSummarySchema = z.object({
  count: z.number(),
  byBundle: z.array(byBundleRowSchema),
  byWhoCategory: z.array(byWhoCategoryRowSchema),
})

const inventoryRowSchema = z.object({
  movementId: z.string(),
  lotNumber: z.string(),
  serviceName: z.string(),
  direction: z.enum(['in', 'out', 'adjust']),
  quantity: z.number(),
  reasonCode: z.string().nullable(),
  occurredAt: z.string(),
})

const inventorySummarySchema = z.object({
  movementCount: z.number(),
  rows: z.array(inventoryRowSchema),
})

const drawerRowSchema = z.object({
  sessionId: z.string(),
  state: z.enum(['Open', 'Closed']),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  /** numeric(12,2) — crosses the wire as a string. */
  openingFloat: z.string(),
  /** numeric(12,2) or null. */
  declaredTotal: z.string().nullable(),
  /** numeric(12,2) or null. */
  variance: z.string().nullable(),
  depositCount: z.number(),
  /** Sum of actual, non-voided cash_deposits tied to this drawer session. */
  depositsTotal: z.string(),
})

const drawerSummarySchema = z.object({
  sessionCount: z.number(),
  /** numeric(12,2) — crosses the wire as a string. */
  openingFloatTotal: z.string(),
  /** numeric(12,2) — crosses the wire as a string. */
  declaredTotalTotal: z.string(),
  /** numeric(12,2) — crosses the wire as a string. */
  varianceTotal: z.string(),
  depositCount: z.number(),
  /** Actual bank deposit facts; never inferred from expected/declared cash. */
  depositsTotal: z.string(),
  rows: z.array(drawerRowSchema),
})

const daySummaryResponseSchema = z.object({
  date: z.string(),
  /** branches.display_id (slug.CODE), not bigint. */
  branchId: z.string(),
  branchName: z.string(),
  generatedAt: z.string(),
  transactions: transactionsSummarySchema,
  administrations: administrationsSummarySchema,
  encounters: encountersSummarySchema,
  inventory: inventorySummarySchema,
  drawer: drawerSummarySchema,
})

const snapshotResponseSchema = z.object({
  id: z.string(),
  date: z.string(),
  /** branches.display_id (slug.CODE), not bigint. */
  branchId: z.string(),
  createdAt: z.string(),
  createdById: z.string().nullable(),
  /** JSONB — full DaySummary payload, shape not re-modeled here. */
  payload: z.unknown(),
})

const createSnapshotResponseSchema = z.object({
  id: z.string(),
  date: z.string(),
  /** branches.display_id (slug.CODE), not bigint. */
  branchId: z.string(),
  createdAt: z.string(),
  /** JSONB — full DaySummary payload, shape not re-modeled here. */
  payload: z.unknown(),
})

const looseEndsResponseSchema = z.object({
  date: z.string(),
  /** branches.display_id (slug.CODE), not bigint. */
  branchId: z.string(),
  unsettledTransactions: z.object({
    count: z.number(),
    /** numeric(12,2) — crosses the wire as a string. */
    totalOutstanding: z.string(),
    asOfDate: z.string(),
  }),
  openPriorDrawers: z.object({
    count: z.number(),
    rows: z.array(
      z.object({
        sessionId: z.string(),
        openedAt: z.string(),
        userName: z.string().nullable(),
        /** numeric(12,2) — crosses the wire as a string. */
        openingFloat: z.string(),
      }),
    ),
  }),
  undocumentedAdministrations: z.object({
    count: z.number(),
    asOfDate: z.string(),
  }),
})

const todayRosterResponseSchema = z.object({
  date: z.string(),
  /** branches.display_id (slug.CODE), not bigint. */
  branchId: z.string(),
  branchName: z.string(),
  generatedAt: z.string(),
  roster: z.array(
    z.object({
      id: z.string(),
      patientId: z.string(),
      patientName: z.string(),
      patientMrn: z.string(),
      specialty: z.string(),
      status: z.string(),
      startedAt: z.string(),
      completedAt: z.string().nullable(),
      claimedBy: z
        .object({
          id: z.string(),
          name: z.string(),
          role: z.string().nullable(),
        })
        .nullable(),
      waitingSince: z.string(),
      lastActionAt: z.string(),
      rowVersion: z.number(),
      nextOwner: z
        .object({
          role: z.string(),
          label: z.string(),
        })
        .nullable(),
      handoffState: z.enum([
        'waiting_clinical',
        'in_care',
        'on_hold',
        'awaiting_payment',
        'complete',
        'closed',
      ]),
      pendingTransactionId: z.string().nullable(),
    }),
  ),
})

// ── Manifest ─────────────────────────────────────────────────────────────────

export const daySummaryContract = defineContract('day-summary', {
  list: {
    method: 'GET',
    path: '/api/day-summary',
    query: daySummaryQuerySchema,
    response: daySummaryResponseSchema,
  },
  looseEnds: {
    method: 'GET',
    path: '/api/day-summary/loose-ends',
    query: daySummaryQuerySchema,
    response: looseEndsResponseSchema,
  },
  todayRoster: {
    method: 'GET',
    path: '/api/day-summary/today-roster',
    query: daySummaryQuerySchema,
    response: todayRosterResponseSchema,
  },
  setTodayRosterOwner: {
    method: 'POST',
    path: '/api/day-summary/today-roster/:encounterId/owner',
    params: { encounterId: prefixedDisplayIdSchema('ENC') },
    body: todayRosterOwnerBodySchema,
    response: z.object({
      ok: z.literal(true),
      encounterId: z.string(),
      claimedById: z.string(),
    }),
  },
  snapshot: {
    method: 'GET',
    path: '/api/day-summary/snapshot',
    query: daySummaryQuerySchema,
    response: snapshotResponseSchema,
  },
  createSnapshot: {
    method: 'POST',
    path: '/api/day-summary/snapshot',
    body: snapshotBodySchema,
    response: createSnapshotResponseSchema,
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ───────

export type DaySummaryListResponse = z.infer<typeof daySummaryResponseSchema>
export type DaySummaryLooseEndsResponse = z.infer<typeof looseEndsResponseSchema>
export type DaySummaryTodayRosterResponse = z.infer<typeof todayRosterResponseSchema>
export type DaySummarySetTodayRosterOwnerResponse = {
  ok: true
  encounterId: string
  claimedById: string
}
export type DaySummarySnapshotResponse = z.infer<typeof snapshotResponseSchema>
export type DaySummaryCreateSnapshotResponse = z.infer<typeof createSnapshotResponseSchema>
