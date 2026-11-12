import { wire } from '../../contracts/wire.js'
import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import type { AuthUser } from '../../shared/middleware/auth.js'
import { displayIdSchema } from '../../shared/utils/displayId.js'
import { validate } from '../../shared/middleware/validate.js'
import { clinicCalendarDateString } from '../../shared/utils/clinicDate.js'
import {
  getPatientStandingOrder,
  getStandingOrderTemplate,
  listActiveTemplatesWithItems,
  listPatientStandingOrders,
  listStandingOrderTemplates,
  setPatientStandingOrderStatus,
} from './db.js'
import {
  appendExternalDose,
  createTemplateVersion,
  startStandingOrder,
  updateTemplate,
} from './service.js'
// Schemas live in the module contract (./contract.ts) so codegen and the
// runtime validators share one source — see docs/specs/api-contract-codegen.md.
import {
  templateIdSchema,
  psoIdSchema,
  startStandingOrderBody,
  updateTemplateBody,
  createVersionBody,
  appendExternalDoseBody,
  psoStatusBody,
  type StandingOrdersListResponse,
  type StandingOrdersDetailResponse,
  type StandingOrdersTemplatesListResponse,
  type StandingOrdersPsoListResponse,
  type StandingOrdersPsoDetailResponse,
  type StandingOrdersPsoCreateResponse,
  type StandingOrdersAdminTemplateResponse,
  type StandingOrdersAdminPsoAppendExternalDoseResponse,
  type StandingOrdersAdminPsoStatusResponse,
} from './contract.js'

export const standingOrdersRouter: RouterType = Router()
export const standingOrderTemplatesRouter: RouterType = Router()
export const patientStandingOrdersRouter: RouterType = Router()
export const adminStandingOrderTemplatesRouter: RouterType = Router()
export const adminPatientStandingOrdersRouter: RouterType = Router()

// PSO ids are PSO_ display ids — alias from contract export.
const psoDisplayIdSchema = psoIdSchema
// Generic display_id (used where the route accepts only well-formed ids).
const genericIdSchema = displayIdSchema

// ── /api/standing-orders ─────────────────────────────────────────────────────

/** GET /api/standing-orders — list standing order templates for the tenant.
 *  Optional ?specialty=Rabies|Flu|Vaccination|General: returns only active
 *  templates matching that specialty (or with no specialty set). */
standingOrdersRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const specialty = typeof req.query['specialty'] === 'string' ? req.query['specialty'] : undefined
  const data = await listStandingOrderTemplates(tenantId, specialty)
  res.json(wire({ data }) satisfies StandingOrdersListResponse)
})

/** GET /api/standing-orders/:id — single template (raw code id) with its items */
standingOrdersRouter.get('/:id', async (req: Request, res: Response) => {
  const parsed = templateIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' })
    return
  }
  const tenantId = req.tenant.id
  const template = await getStandingOrderTemplate(tenantId, parsed.data)
  if (!template) {
    res.status(404).json({ error: 'Standing order template not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire({ data: template }) satisfies StandingOrdersDetailResponse)
})

// ── /api/standing-order-templates ─────────────────────────────────────────────

/**
 * GET /api/standing-order-templates — active templates joined with their items
 * for the protocol initiation picker (no N+1).
 */
standingOrderTemplatesRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const data = await listActiveTemplatesWithItems(tenantId)
  res.json(wire({ data }) satisfies StandingOrdersTemplatesListResponse)
})

// ── /api/patient-standing-orders ──────────────────────────────────────────────

// startStandingOrderBody is imported from contract.ts — aliased for local validate() call.
const startStandingOrderSchema = startStandingOrderBody

/** GET /api/patient-standing-orders — list all PSOs for the tenant */
patientStandingOrdersRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const data = await listPatientStandingOrders(tenantId)
  res.json(wire({ data }) satisfies StandingOrdersPsoListResponse)
})

/** GET /api/patient-standing-orders/:id — PSO detail with consents + statusHistory */
patientStandingOrdersRouter.get('/:id', async (req: Request, res: Response) => {
  const parsed = psoDisplayIdSchema.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' })
    return
  }
  const tenantId = req.tenant.id
  const pso = await getPatientStandingOrder(tenantId, parsed.data)
  if (!pso) {
    res.status(404).json({ error: 'Patient standing order not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire({ data: pso }) satisfies StandingOrdersPsoDetailResponse)
})

/**
 * POST /api/patient-standing-orders — initiate a protocol from a template.
 * Generates one clinical_orders row per template item.
 */
patientStandingOrdersRouter.post(
  '/',
  validate(startStandingOrderSchema),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id

    const body = req.body as z.infer<typeof startStandingOrderSchema>

    // Authorizing provider rules:
    //   - Nurse / Branch session: required, must be supplied in the body.
    //   - Physician: defaults to the requester (their display_id).
    //   - Other roles: optional pass-through.
    let authorizingProviderId: string | null = body.authorizingProviderId ?? null
    if ((user.role === 'Nurse' || user.role === 'Branch') && !authorizingProviderId) {
      res.status(400).json({
        error: 'authorizingProviderId is required',
        code: 'INVALID_ID',
      })
      return
    }
    if (user.role === 'Physician' && !authorizingProviderId) {
      authorizingProviderId = user.displayId
    }

    // Default to the clinic's Manila calendar day; UTC defaults move this to
    // yesterday during the first eight hours of every clinic day.
    const startDateOnly = body.startDate ?? clinicCalendarDateString()
    const startDateIso = `${startDateOnly}T00:00:00.000Z`

    if (user.id === null) {
      res.status(403).json({ error: 'User context required', code: 'FORBIDDEN' })
      return
    }

    try {
      const created = await startStandingOrder({
        tenantId,
        patientId: body.patientId,
        encounterId: body.encounterId ?? null,
        templateId: body.templateId,
        authorizingProviderId,
        startDateIso,
        createdById: user.id,
        branchId: user.branchId,
      })
      res.status(201).json(wire({ data: created }) satisfies StandingOrdersPsoCreateResponse)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      if (msg === 'TEMPLATE_NOT_FOUND') {
        res.status(404).json({ error: 'Template not found', code: 'NOT_FOUND' })
        return
      }
      if (msg === 'PATIENT_NOT_FOUND') {
        res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
        return
      }
      if (msg === 'CROSS_BRANCH_WRITE_FORBIDDEN') {
        res.status(403).json({
          error:
            'Cross-branch chart reveal is read-only; switch to the patient home branch to write',
          code: 'CROSS_BRANCH_WRITE_FORBIDDEN',
        })
        return
      }
      if (msg === 'ENCOUNTER_NOT_FOUND') {
        res.status(404).json({ error: 'Encounter not found', code: 'NOT_FOUND' })
        return
      }
      if (msg === 'AUTHORIZING_PROVIDER_NOT_FOUND') {
        res.status(404).json({ error: 'Authorizing provider not found', code: 'NOT_FOUND' })
        return
      }
      if (msg === 'PHYSICIAN_AUTH_REQUIRED') {
        res.status(400).json({
          error: 'This protocol requires an authorizing physician',
          code: 'PHYSICIAN_AUTH_REQUIRED',
        })
        return
      }
      if (msg === 'TEMPLATE_INACTIVE') {
        res.status(400).json({ error: 'Template is inactive', code: 'TEMPLATE_INACTIVE' })
        return
      }
      if (msg === 'TEMPLATE_HAS_NO_ITEMS') {
        res.status(400).json({
          error: 'Template has no line items',
          code: 'TEMPLATE_HAS_NO_ITEMS',
        })
        return
      }
      throw err
    }
  },
)

// ── /api/admin/standing-order-templates ───────────────────────────────────────
// Mounted with requireRole('TenantAdmin','BranchAdmin') in app.ts.

// updateTemplateBody + createVersionBody are imported from contract.ts.
const updateTemplateSchema = updateTemplateBody
const createVersionSchema = createVersionBody

function requireUserContext(
  user: AuthUser,
  res: Response,
): { tenantId: string; userId: number; branchId: number | null } | null {
  if (user.id === null || user.tenantId === null) {
    res.status(403).json({ error: 'User context required', code: 'FORBIDDEN' })
    return null
  }
  return { tenantId: user.tenantId, userId: user.id, branchId: user.branchId }
}

/**
 * PUT /api/admin/standing-order-templates/:id
 * In-place update — rejected with 409 when the template is locked.
 */
adminStandingOrderTemplatesRouter.put(
  '/:id',
  validate(updateTemplateSchema),
  async (req: Request, res: Response) => {
    const parsed = templateIdSchema.safeParse(req.params['id'])
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' })
      return
    }
    const user = (req as Request & { user: AuthUser }).user
    const ctx = requireUserContext(user, res)
    if (!ctx) return
    try {
      const updated = await updateTemplate(
        ctx,
        parsed.data,
        req.body as z.infer<typeof updateTemplateSchema>,
      )
      res.json(wire({ data: updated }) satisfies StandingOrdersAdminTemplateResponse)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      if (msg === 'TEMPLATE_NOT_FOUND') {
        res.status(404).json({ error: 'Template not found', code: 'NOT_FOUND' })
        return
      }
      if (msg === 'TEMPLATE_LOCKED') {
        res.status(409).json({
          error: 'Template is locked — create a new version instead',
          code: 'TEMPLATE_LOCKED',
        })
        return
      }
      throw err
    }
  },
)

// ── /api/admin/patient-standing-orders ───────────────────────────────────────
// Mounted with requireRole('TenantAdmin','Physician') in app.ts.

// appendExternalDoseBody is imported from contract.ts.
const appendExternalDoseSchema = appendExternalDoseBody

/**
 * POST /api/admin/patient-standing-orders/:psoId/append-external-dose
 *
 * Records an externally-administered dose against an existing PSO so
 * subsequent dose scheduling and FEFO continues correctly.
 * Inserts a completed clinical_order with administered_at_external_clinic=true.
 */
adminPatientStandingOrdersRouter.post(
  '/:psoId/append-external-dose',
  validate(appendExternalDoseSchema),
  async (req: Request, res: Response) => {
    const parsedId = psoDisplayIdSchema.safeParse(req.params['psoId'])
    if (!parsedId.success) {
      res.status(400).json({ error: 'Invalid psoId', code: 'INVALID_ID' })
      return
    }
    const user = (req as Request & { user: AuthUser }).user
    const ctx = requireUserContext(user, res)
    if (!ctx) return
    const body = req.body as z.infer<typeof appendExternalDoseSchema>

    try {
      const inserted = await appendExternalDose(ctx, {
        psoId: parsedId.data,
        doseNumber: body.doseNumber,
        priorDoseDate: body.priorDoseDate,
        serviceId: body.serviceId,
        externalClinicianName: body.externalClinicianName,
        externalClinicName: body.externalClinicName,
        externalNotes: body.externalNotes,
      })
      res
        .status(201)
        .json(wire({ data: inserted }) satisfies StandingOrdersAdminPsoAppendExternalDoseResponse)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      if (msg === 'PSO_NOT_FOUND') {
        res.status(404).json({ error: 'Patient standing order not found', code: 'NOT_FOUND' })
        return
      }
      if (msg === 'PSO_DISCONTINUED') {
        res.status(409).json({
          error: 'Cannot append to a discontinued standing order',
          code: 'PSO_DISCONTINUED',
        })
        return
      }
      if (msg === 'DOSE_NUMBER_OUT_OF_RANGE') {
        res.status(400).json({
          error: 'doseNumber exceeds template item count',
          code: 'DOSE_NUMBER_OUT_OF_RANGE',
        })
        return
      }
      throw err
    }
  },
)

// psoStatusBody is imported from contract.ts.
const psoStatusSchema = psoStatusBody

/**
 * PATCH /api/admin/patient-standing-orders/:psoId/status
 * Pause (Suspended) / resume (Active) a patient standing order.
 * Completed/Discontinued PSOs are immutable here → 409.
 */
adminPatientStandingOrdersRouter.patch(
  '/:psoId/status',
  validate(psoStatusSchema),
  async (req: Request, res: Response) => {
    const parsedId = psoDisplayIdSchema.safeParse(req.params['psoId'])
    if (!parsedId.success) {
      res.status(400).json({ error: 'Invalid psoId', code: 'INVALID_ID' })
      return
    }
    const user = (req as Request & { user: AuthUser }).user
    const ctx = requireUserContext(user, res)
    if (!ctx) return
    const body = req.body as z.infer<typeof psoStatusSchema>

    try {
      const updated = await setPatientStandingOrderStatus(ctx, parsedId.data, body.status)
      res.json(wire({ data: updated }) satisfies StandingOrdersAdminPsoStatusResponse)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      if (msg === 'PSO_NOT_FOUND') {
        res.status(404).json({ error: 'Patient standing order not found', code: 'NOT_FOUND' })
        return
      }
      if (msg === 'PSO_NOT_PAUSABLE') {
        res.status(409).json({
          error: 'Only Active or Suspended standing orders can be paused/resumed',
          code: 'PSO_NOT_PAUSABLE',
        })
        return
      }
      throw err
    }
  },
)

/**
 * POST /api/admin/standing-order-templates/:id/versions
 * Copy-on-write — creates a new unlocked template row and clones items.
 */
adminStandingOrderTemplatesRouter.post(
  '/:id/versions',
  validate(createVersionSchema),
  async (req: Request, res: Response) => {
    const parsed = templateIdSchema.safeParse(req.params['id'])
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' })
      return
    }
    const user = (req as Request & { user: AuthUser }).user
    const ctx = requireUserContext(user, res)
    if (!ctx) return
    try {
      const newTemplate = await createTemplateVersion(
        ctx,
        parsed.data,
        req.body as z.infer<typeof createVersionSchema>,
      )
      res
        .status(201)
        .json(wire({ data: newTemplate }) satisfies StandingOrdersAdminTemplateResponse)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      if (msg === 'TEMPLATE_NOT_FOUND') {
        res.status(404).json({ error: 'Template not found', code: 'NOT_FOUND' })
        return
      }
      throw err
    }
  },
)

// Avoid unused-import errors when only some helpers are referenced.
void genericIdSchema
