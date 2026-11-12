/**
 * Bite Incidents module — HTTP layer.
 *
 * Two-tier IDs (W3.c.3, 2026-05-19): all ids in params/body/responses are
 * display_id strings (BIT_, AOF_, PAT_, PSO_).
 */
import { wire } from '../../contracts/wire.js'
import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { requireRole } from '../../shared/middleware/requireRole.js'
import { isApiError } from '../../shared/lib/apiError.js'
import * as db from './db.js'
import { recordOutcomeAndMayCancelDay28 } from './service.js'
// Schemas live in the module contract (./contract.ts) so codegen and the
// runtime validators share one source — see docs/specs/api-contract-codegen.md.
import {
  bitIdSchema,
  aofIdSchema,
  createBody,
  patchBody,
  recordOutcomeBody,
  listQuerySchema,
  type BiteIncidentsListResponse,
  type BiteIncidentsDetailResponse,
  type BiteIncidentsCreateResponse,
  type BiteIncidentsUpdateResponse,
  type BiteIncidentsRecordOutcomeResponse,
} from './contract.js'

export const biteIncidentsRouter: RouterType = Router()

type AuthUser = {
  id: number | null
  displayId: string
  email: string
  role: string
  tenantId: string
  branchId: number | null
}

// ── GET /api/bite-incidents ───────────────────────────────────────────────────

biteIncidentsRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'INVALID_INPUT',
      details: parsed.error.flatten().fieldErrors,
    })
    return
  }
  const rows = await db.listBiteIncidents({ tenantId, ...parsed.data })
  res.json(wire(rows) satisfies BiteIncidentsListResponse)
})

// ── GET /api/bite-incidents/:id ───────────────────────────────────────────────

biteIncidentsRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const idParsed = bitIdSchema.safeParse(req.params['id'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid bite incident id', code: 'INVALID_ID' })
    return
  }
  const row = await db.getBiteIncident(tenantId, idParsed.data)
  if (!row) {
    res.status(404).json({ error: 'Bite incident not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire(row) satisfies BiteIncidentsDetailResponse)
})

// ── POST /api/bite-incidents ──────────────────────────────────────────────────

biteIncidentsRouter.post(
  '/',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const user = (req as Request & { user: AuthUser }).user
    if (user.id == null) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'INVALID_INPUT',
        details: parsed.error.flatten().fieldErrors,
      })
      return
    }
    try {
      const row = await db.createBiteIncident(tenantId, user.id, user.branchId, parsed.data)
      if (!row) {
        res
          .status(500)
          .json({ error: 'Bite incident creation returned no row', code: 'INTERNAL_ERROR' })
        return
      }
      res.status(201).json(wire(row) satisfies BiteIncidentsCreateResponse)
    } catch (err) {
      // db.ts throws Object.assign(new Error(...), { statusCode, code }), the
      // same shape the shared isApiError() duck-type check already covers, so
      // reuse it instead of re-casting inline. Same status codes as before.
      if (isApiError(err)) {
        res.status(err.statusCode).json({ error: err.message, code: err.code })
        return
      }
      throw err
    }
  },
)

// ── PATCH /api/bite-incidents/:id ─────────────────────────────────────────────

biteIncidentsRouter.patch(
  '/:id',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const user = (req as Request & { user: AuthUser }).user
    if (user.id == null) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }
    const idParsed = bitIdSchema.safeParse(req.params['id'])
    if (!idParsed.success) {
      res.status(400).json({ error: 'Invalid bite incident id', code: 'INVALID_ID' })
      return
    }
    const parsed = patchBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'INVALID_INPUT',
        details: parsed.error.flatten().fieldErrors,
      })
      return
    }
    const row = await db.updateBiteIncident(
      tenantId,
      user.id,
      user.branchId,
      idParsed.data,
      parsed.data,
    )
    if (!row) {
      res.status(404).json({ error: 'Bite incident not found', code: 'NOT_FOUND' })
      return
    }
    res.json(wire(row) satisfies BiteIncidentsUpdateResponse)
  },
)

// ── POST /api/bite-incidents/:id/followups/:followupId/record-outcome ─────────

biteIncidentsRouter.post(
  '/:id/followups/:followupId/record-outcome',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const user = (req as Request & { user: AuthUser }).user
    if (user.id == null) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }

    const idParsed = bitIdSchema.safeParse(req.params['id'])
    if (!idParsed.success) {
      res.status(400).json({ error: 'Invalid bite incident id', code: 'INVALID_ID' })
      return
    }
    const followupIdParsed = aofIdSchema.safeParse(req.params['followupId'])
    if (!followupIdParsed.success) {
      res.status(400).json({ error: 'Invalid followup id', code: 'INVALID_ID' })
      return
    }
    const parsed = recordOutcomeBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'INVALID_INPUT',
        details: parsed.error.flatten().fieldErrors,
      })
      return
    }

    const result = await recordOutcomeAndMayCancelDay28(
      tenantId,
      user.id,
      user.branchId,
      idParsed.data,
      followupIdParsed.data,
      parsed.data,
    )

    if (!result) {
      res.status(404).json({
        error: 'Bite incident or followup not found',
        code: 'NOT_FOUND',
      })
      return
    }

    res.json(wire(result) satisfies BiteIncidentsRecordOutcomeResponse)
  },
)
