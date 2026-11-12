import { wire } from '../../contracts/wire.js'
import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { validate } from '../../shared/middleware/validate.js'
import type { AuthUser } from '../../shared/middleware/auth.js'
import * as db from './db.js'
// Schemas live in the module contract (./contract.ts) so codegen and the
// runtime validators share one source — see docs/specs/api-contract-codegen.md.
import {
  aptDisplayIdParam,
  listQuerySchema,
  createBody,
  patchBody,
  cancelBody,
  availabilityQuerySchema,
  type AppointmentsListResponse,
  type AppointmentsAvailabilityResponse,
  type AppointmentsDetailResponse,
  type AppointmentsCreateResponse,
  type AppointmentsUpdateResponse,
  type AppointmentsCancelResponse,
  type AppointmentsRemoveResponse,
} from './contract.js'

export const appointmentsRouter: RouterType = Router()

// ── Helper: parse query params inline ────────────────────────────────────────
import { z } from 'zod'

function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  req: Request,
  res: Response,
): z.infer<T> | null {
  const result = schema.safeParse(req.query)
  if (!result.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'INVALID_INPUT',
      details: result.error.flatten().fieldErrors,
    })
    return null
  }
  return result.data as z.infer<T>
}

// ── Helper: catch Postgres exclusion_violation (23P01) ───────────────────────

function isProviderDoubleBook(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    return e['code'] === '23P01' || String(e['constraint'] ?? '').includes('double_book')
  }
  return false
}

// ── Helper: catch FK resolution errors ───────────────────────────────────────

function isFkResolutionError(err: unknown): string | null {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    const code = e['code']
    if (code === 'PATIENT_NOT_FOUND') return 'Patient not found'
    if (code === 'BRANCH_NOT_FOUND') return 'Branch not found'
    if (code === 'PROVIDER_NOT_FOUND') return 'Provider not found'
  }
  return null
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/appointments/availability — must be registered BEFORE /:displayId */
appointmentsRouter.get('/availability', async (req: Request, res: Response) => {
  const q = parseQuery(availabilityQuerySchema, req, res)
  if (!q) return

  const tenantId = req.tenant.id

  const slots = await db.getAvailability(tenantId, {
    providerDisplayId: q.providerId,
    from: new Date(q.from),
    to: new Date(q.to),
    durationMinutes: q.durationMinutes ?? 30,
  })

  res.json(wire({ slots }) satisfies AppointmentsAvailabilityResponse)
})

/** GET /api/appointments */
appointmentsRouter.get('/', async (req: Request, res: Response) => {
  const q = parseQuery(listQuerySchema, req, res)
  if (!q) return

  const tenantId = req.tenant.id

  const rows = await db.listAppointments(tenantId, {
    patientId: q.patientId,
    providerId: q.providerId,
    branchId: q.branchId,
    status: q.status,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
    limit: q.limit,
  })

  res.json(wire(rows) satisfies AppointmentsListResponse)
})

/** GET /api/appointments/:displayId */
appointmentsRouter.get('/:displayId', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const parsed = aptDisplayIdParam.safeParse(req.params['displayId'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid appointment id', code: 'INVALID_ID' })
    return
  }

  const row = await db.getAppointment(tenantId, parsed.data)
  if (!row) {
    res.status(404).json({ error: 'Appointment not found', code: 'NOT_FOUND' })
    return
  }

  res.json(wire({ data: row }) satisfies AppointmentsDetailResponse)
})

/** POST /api/appointments */
appointmentsRouter.post('/', validate(createBody, 'body'), async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id

  if (!user.id) {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' })
    return
  }

  try {
    const row = await db.createAppointment(tenantId, user.id, user.branchId, {
      ...req.body,
      createdById: user.id,
    })
    if (!row) {
      res
        .status(500)
        .json({ error: 'Appointment creation returned no row', code: 'INTERNAL_ERROR' })
      return
    }
    res.status(201).json(wire({ data: row }) satisfies AppointmentsCreateResponse)
  } catch (err) {
    if (isProviderDoubleBook(err)) {
      res.status(409).json({
        error: 'PROVIDER_DOUBLE_BOOK',
        message: 'Provider already booked in that time range',
      })
      return
    }
    const fkMsg = isFkResolutionError(err)
    if (fkMsg) {
      res.status(422).json({ error: fkMsg, code: 'UNRESOLVABLE_FK' })
      return
    }
    throw err
  }
})

/** PATCH /api/appointments/:displayId */
appointmentsRouter.patch(
  '/:displayId',
  validate(patchBody, 'body'),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id

    if (!user.id) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' })
      return
    }

    const parsed = aptDisplayIdParam.safeParse(req.params['displayId'])
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid appointment id', code: 'INVALID_ID' })
      return
    }

    // API-6: the patchBody refine only fires when BOTH time fields are supplied
    // in the same request. When only one bound is patched, the refine short-
    // circuits and end-before-start can be persisted. Fix: fetch the existing
    // row, merge the submitted time(s) over the stored ones, then re-validate
    // the resulting (start, end) ordering before executing the update.
    const body = req.body as {
      scheduledStartAt?: string
      scheduledEndAt?: string
    }
    const hasTimePatch = body.scheduledStartAt !== undefined || body.scheduledEndAt !== undefined
    if (hasTimePatch) {
      const existing = await db.getAppointment(tenantId, parsed.data)
      if (!existing) {
        res.status(404).json({ error: 'Appointment not found', code: 'NOT_FOUND' })
        return
      }
      const mergedStart = new Date(body.scheduledStartAt ?? existing.scheduledStartAt)
      const mergedEnd = new Date(body.scheduledEndAt ?? existing.scheduledEndAt)
      if (mergedEnd <= mergedStart) {
        res.status(400).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: { scheduledEndAt: ['End time must be after start time'] },
        })
        return
      }
    }

    try {
      const row = await db.updateAppointment(
        tenantId,
        user.id,
        user.branchId,
        parsed.data,
        req.body,
      )
      if (!row) {
        res.status(404).json({ error: 'Appointment not found', code: 'NOT_FOUND' })
        return
      }
      res.json(wire({ data: row }) satisfies AppointmentsUpdateResponse)
    } catch (err) {
      if (isProviderDoubleBook(err)) {
        res.status(409).json({
          error: 'PROVIDER_DOUBLE_BOOK',
          message: 'Provider already booked in that time range',
        })
        return
      }
      const fkMsg = isFkResolutionError(err)
      if (fkMsg) {
        res.status(422).json({ error: fkMsg, code: 'UNRESOLVABLE_FK' })
        return
      }
      throw err
    }
  },
)

/** POST /api/appointments/:displayId/cancel */
appointmentsRouter.post(
  '/:displayId/cancel',
  validate(cancelBody, 'body'),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id

    if (!user.id) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' })
      return
    }

    const parsed = aptDisplayIdParam.safeParse(req.params['displayId'])
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid appointment id', code: 'INVALID_ID' })
      return
    }

    const { reason } = req.body as { reason: string }

    const result = await db.cancelAppointment(tenantId, user.id, user.branchId, parsed.data, reason)

    if (!result.found) {
      res.status(404).json({ error: 'Appointment not found', code: 'NOT_FOUND' })
      return
    }
    if (result.invalidState) {
      res.status(409).json({
        error: 'INVALID_STATE',
        message: `Cannot cancel an appointment with status '${result.status}'`,
      })
      return
    }

    const row = await db.getAppointment(tenantId, parsed.data)
    if (!row) {
      res.status(404).json({ error: 'Appointment not found', code: 'NOT_FOUND' })
      return
    }
    res.json(wire({ data: row }) satisfies AppointmentsCancelResponse)
  },
)

/** DELETE /api/appointments/:displayId */
appointmentsRouter.delete('/:displayId', async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id

  if (!user.id) {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' })
    return
  }

  const parsed = aptDisplayIdParam.safeParse(req.params['displayId'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid appointment id', code: 'INVALID_ID' })
    return
  }

  const result = await db.softDeleteAppointment(tenantId, user.id, user.branchId, parsed.data)
  if (!result) {
    res.status(404).json({ error: 'Appointment not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire({ ok: true }) satisfies AppointmentsRemoveResponse)
})
