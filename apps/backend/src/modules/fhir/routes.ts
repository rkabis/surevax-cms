import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import {
  getFhirPatient,
  listFhirPatients,
  getFhirEncounter,
  listFhirEncounters,
  getFhirImmunization,
  listFhirImmunizations,
} from './db.js'

// ---------------------------------------------------------------------------
// FHIR R4 read-only endpoints
// ---------------------------------------------------------------------------
// All endpoints return application/fhir+json per FHIR R4 content type spec.
// Tenant isolation: tenant GUC is set inside every db.ts function via
// db.transaction(). Auth + tenant middleware run before this router.
//
// Role restriction: TenantAdmin, BranchAdmin, Physician, Nurse.
// (Clinical data; Cashier excluded — no clinical need for FHIR projection.)
//
// ID format: FHIR ids match SureVax two-tier display IDs:
//   Patient/PAT_XXXXXXXX, Encounter/ENC_XXXXXXXX, Immunization/ORD_XXXXXXXX.
// The underlying views project `display_id AS id` so the WHERE on id = $1 matches
// the public display id text directly (no bigint round-trip needed in the API).

export const fhirRouter: RouterType = Router()

// Inline Zod schemas (no @surevax/shared value imports at backend runtime).
const patientIdParamSchema = z.object({ id: prefixedDisplayIdSchema('PAT') })
const encounterIdParamSchema = z.object({ id: prefixedDisplayIdSchema('ENC') })
const immunizationIdParamSchema = z.object({ id: prefixedDisplayIdSchema('ORD') })

const bundleQuerySchema = z.object({
  _count: z
    .string()
    .optional()
    .transform((v) => Math.min(Math.max(parseInt(v ?? '20', 10) || 20, 1), 100)),
  page: z
    .string()
    .optional()
    .transform((v) => Math.max(parseInt(v ?? '1', 10) || 1, 1)),
})

type AuthUser = {
  id: number
  email: string
  role: string
  tenantId: string
  branchId: number | null
}

function fhirJson(res: Response, body: unknown, status = 200): void {
  res.status(status).setHeader('Content-Type', 'application/fhir+json').json(body)
}

function operationOutcome(diagnostics: string, code: string, status: number, res: Response): void {
  fhirJson(
    res,
    { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code, diagnostics }] },
    status,
  )
}

function buildBundle(total: number, resources: Record<string, unknown>[]): Record<string, unknown> {
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total,
    entry: resources.map((r) => ({ resource: r })),
  }
}

// ── Patient ──────────────────────────────────────────────────────────────────

fhirRouter.get('/Patient/:id', async (req: Request, res: Response) => {
  const parsed = patientIdParamSchema.safeParse(req.params)
  if (!parsed.success) {
    operationOutcome('Invalid id', 'invalid', 400, res)
    return
  }
  const user = (req as Request & { user: AuthUser }).user
  const resource = await getFhirPatient(req.tenant.id, user.id, user.branchId, parsed.data.id)
  if (!resource) {
    operationOutcome(`Patient/${parsed.data.id} not found`, 'not-found', 404, res)
    return
  }
  fhirJson(res, resource)
})

fhirRouter.get('/Patient', async (req: Request, res: Response) => {
  const parsed = bundleQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    operationOutcome('Invalid query parameters', 'invalid', 400, res)
    return
  }
  const user = (req as Request & { user: AuthUser }).user
  const { _count, page } = parsed.data
  const { total, resources } = await listFhirPatients(
    req.tenant.id,
    user.id,
    user.branchId,
    _count,
    page,
  )
  fhirJson(res, buildBundle(total, resources))
})

// ── Encounter ────────────────────────────────────────────────────────────────

fhirRouter.get('/Encounter/:id', async (req: Request, res: Response) => {
  const parsed = encounterIdParamSchema.safeParse(req.params)
  if (!parsed.success) {
    operationOutcome('Invalid id', 'invalid', 400, res)
    return
  }
  const user = (req as Request & { user: AuthUser }).user
  const resource = await getFhirEncounter(req.tenant.id, user.id, user.branchId, parsed.data.id)
  if (!resource) {
    operationOutcome(`Encounter/${parsed.data.id} not found`, 'not-found', 404, res)
    return
  }
  fhirJson(res, resource)
})

fhirRouter.get('/Encounter', async (req: Request, res: Response) => {
  const parsed = bundleQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    operationOutcome('Invalid query parameters', 'invalid', 400, res)
    return
  }
  const user = (req as Request & { user: AuthUser }).user
  const { _count, page } = parsed.data
  const { total, resources } = await listFhirEncounters(
    req.tenant.id,
    user.id,
    user.branchId,
    _count,
    page,
  )
  fhirJson(res, buildBundle(total, resources))
})

// ── Immunization ─────────────────────────────────────────────────────────────

fhirRouter.get('/Immunization/:id', async (req: Request, res: Response) => {
  const parsed = immunizationIdParamSchema.safeParse(req.params)
  if (!parsed.success) {
    operationOutcome('Invalid id', 'invalid', 400, res)
    return
  }
  const user = (req as Request & { user: AuthUser }).user
  const resource = await getFhirImmunization(req.tenant.id, user.id, user.branchId, parsed.data.id)
  if (!resource) {
    operationOutcome(`Immunization/${parsed.data.id} not found`, 'not-found', 404, res)
    return
  }
  fhirJson(res, resource)
})

fhirRouter.get('/Immunization', async (req: Request, res: Response) => {
  const parsed = bundleQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    operationOutcome('Invalid query parameters', 'invalid', 400, res)
    return
  }
  const user = (req as Request & { user: AuthUser }).user
  const { _count, page } = parsed.data
  const { total, resources } = await listFhirImmunizations(
    req.tenant.id,
    user.id,
    user.branchId,
    _count,
    page,
  )
  fhirJson(res, buildBundle(total, resources))
})
