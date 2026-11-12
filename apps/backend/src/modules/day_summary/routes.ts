/**
 * day_summary/routes.ts — GET /api/day-summary
 *
 * Returns an end-of-day reconciliation snapshot for the authenticated user's
 * branch on a given calendar day.
 *
 * Branch scoping: resolved from req.user.branchId (the authenticated session's
 * primary branch — bigint). Do NOT accept branchId from the query string.
 *
 * Date semantics: 'date' query param is an Asia/Manila clinic calendar day
 * (YYYY-MM-DD), independent of the process and PostgreSQL server timezones.
 */

import { Router, type Request, type Response, type Router as ExpressRouter } from 'express'
import type { AuthUser } from '../../shared/middleware/auth.js'
import {
  createDaySnapshot,
  getDaySnapshot,
  getDaySummary,
  getLooseEnds,
  getTodayRosterSnapshot,
  setTodayEncounterOwner,
} from './service.js'
import { clinicCalendarDateString } from '../../shared/utils/clinicDate.js'
// Schemas live in the module contract (./contract.ts) so codegen and the
// runtime validators share one source — see docs/specs/api-contract-codegen.md.
import {
  daySummaryQuerySchema,
  snapshotBodySchema,
  type DaySummaryListResponse,
  type DaySummaryLooseEndsResponse,
  type DaySummarySnapshotResponse,
  type DaySummaryCreateSnapshotResponse,
  type DaySummaryTodayRosterResponse,
  type DaySummarySetTodayRosterOwnerResponse,
  todayRosterOwnerBodySchema,
} from './contract.js'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { resolveClinicalOwner } from '../../shared/utils/clinicianAttestation.js'
import { sendLifecycleError } from '../../shared/lib/lifecycleError.js'

export const daySummaryRouter: ExpressRouter = Router()

daySummaryRouter.get('/', async (req: Request, res: Response) => {
  const parsed = daySummaryQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid query' })
    return
  }

  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id
  const branchId = user.branchId

  if (user.id === null) {
    res.status(403).json({ error: 'Platform admins have no branch context', code: 'FORBIDDEN' })
    return
  }
  if (branchId === null) {
    res.status(400).json({ error: 'No branch associated with this session' })
    return
  }

  const date = parsed.data.date ?? clinicCalendarDateString()

  const summary = await getDaySummary({
    tenantId,
    userId: user.id,
    branchId,
    date,
  })

  res.json(summary satisfies DaySummaryListResponse)
})

/** GET /api/day-summary/today-roster — complete live roster for one branch clinic day. */
daySummaryRouter.get('/today-roster', async (req: Request, res: Response) => {
  const parsed = daySummaryQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid query' })
    return
  }

  const user = (req as Request & { user: AuthUser }).user
  if (user.id === null) {
    res.status(403).json({ error: 'Platform admins have no branch context', code: 'FORBIDDEN' })
    return
  }
  if (user.branchId === null) {
    res.status(400).json({ error: 'No branch associated with this session' })
    return
  }

  const snapshot = await getTodayRosterSnapshot({
    tenantId: req.tenant.id,
    userId: user.id,
    branchId: user.branchId,
    date: parsed.data.date ?? clinicCalendarDateString(),
  })

  res.json(snapshot satisfies DaySummaryTodayRosterResponse)
})

/** POST /api/day-summary/today-roster/:encounterId/owner — PIN-attested claim/handoff. */
daySummaryRouter.post('/today-roster/:encounterId/owner', async (req: Request, res: Response) => {
  const parsedId = prefixedDisplayIdSchema('ENC').safeParse(req.params['encounterId'])
  const parsedBody = todayRosterOwnerBodySchema.safeParse(req.body)
  if (!parsedId.success || !parsedBody.success) {
    res.status(400).json({ error: 'Invalid ownership handoff', code: 'VALIDATION_ERROR' })
    return
  }

  const user = (req as Request & { user: AuthUser }).user
  if (user.id === null || user.branchId === null) {
    res.status(400).json({ error: 'A branch user is required', code: 'BRANCH_REQUIRED' })
    return
  }

  try {
    // PIN verification writes lockout counters, so resolve it before opening
    // the encounter update transaction.
    const ownerUserId = await resolveClinicalOwner({
      tenantId: req.tenant.id,
      branchId: user.branchId,
      caller: { id: user.id, role: user.role, displayId: user.displayId },
      assigneeId: parsedBody.data.assigneeId,
      attestationPin: parsedBody.data.attestationPin,
    })
    const updated = await setTodayEncounterOwner({
      tenantId: req.tenant.id,
      userId: user.id,
      branchId: user.branchId,
      encounterDisplayId: parsedId.data,
      ownerUserId,
      expectedRowVersion: parsedBody.data.expectedRowVersion,
    })
    if (!updated) {
      res.status(409).json({
        error: 'This encounter changed or is no longer active. Refresh before assigning it.',
        code: 'STALE_ENCOUNTER',
      })
      return
    }

    res.json({
      ok: true,
      encounterId: parsedId.data,
      claimedById: parsedBody.data.assigneeId ?? user.displayId,
    } satisfies DaySummarySetTodayRosterOwnerResponse)
  } catch (err) {
    if (sendLifecycleError(res, err)) return
    throw err
  }
})

/**
 * GET /api/day-summary/loose-ends?date=YYYY-MM-DD
 *
 * Aggregates yesterday's unresolved business for the authenticated Branch session:
 *   - unsettledTransactions: Pending/Paid txns with amount_outstanding > 0 created on or before yesterday
 *   - openPriorDrawers: cash drawer sessions still Open but opened before today
 *   - undocumentedAdministrations: Completed clinical orders before today with no documented_by_id
 *
 * Date defaults to today if omitted.
 */
daySummaryRouter.get('/loose-ends', async (req: Request, res: Response) => {
  const parsed = daySummaryQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid query' })
    return
  }

  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id
  const branchId = user.branchId

  if (user.id === null) {
    res.status(403).json({ error: 'Platform admins have no branch context', code: 'FORBIDDEN' })
    return
  }
  if (branchId === null) {
    res.status(400).json({ error: 'No branch associated with this session' })
    return
  }

  const date = parsed.data.date ?? clinicCalendarDateString()

  const result = await getLooseEnds({
    tenantId,
    userId: user.id,
    branchId,
    date,
  })

  res.json(result satisfies DaySummaryLooseEndsResponse)
})

/**
 * POST /api/day-summary/snapshot — capture and persist the day's aggregate.
 * Re-snapshotting (same tenant + branch + date) overwrites the prior payload.
 */
daySummaryRouter.post('/snapshot', async (req: Request, res: Response) => {
  const parsed = snapshotBodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Invalid body' })
    return
  }
  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id
  const branchId = user.branchId
  if (user.id === null) {
    res.status(403).json({ error: 'Platform admins have no branch context', code: 'FORBIDDEN' })
    return
  }
  if (branchId === null) {
    res.status(400).json({ error: 'No branch associated with this session' })
    return
  }
  const result = await createDaySnapshot({
    tenantId,
    userId: user.id,
    branchId,
    date: parsed.data.date,
  })
  res.status(201).json(result satisfies DaySummaryCreateSnapshotResponse)
})

/**
 * GET /api/day-summary/snapshot?date=YYYY-MM-DD — fetch a previously
 * captured snapshot. 404 if none exists for this branch+date.
 */
daySummaryRouter.get('/snapshot', async (req: Request, res: Response) => {
  const parsed = daySummaryQuerySchema.safeParse(req.query)
  if (!parsed.success || !parsed.data.date) {
    res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' })
    return
  }
  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id
  const branchId = user.branchId
  if (user.id === null) {
    res.status(403).json({ error: 'Platform admins have no branch context', code: 'FORBIDDEN' })
    return
  }
  if (branchId === null) {
    res.status(400).json({ error: 'No branch associated with this session' })
    return
  }
  const snapshot = await getDaySnapshot({
    tenantId,
    userId: user.id,
    branchId,
    date: parsed.data.date,
  })
  if (!snapshot) {
    res.status(404).json({ error: 'Snapshot not found', code: 'NOT_FOUND' })
    return
  }
  res.json(snapshot satisfies DaySummarySnapshotResponse)
})
