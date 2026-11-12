import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import { getService } from '../service_catalog/db.js'
import { calculateDose, DoseCalcError, resolveDoseRule } from '../../shared/utils/doseCalc.js'
import type { AuthUser } from '../../shared/middleware/auth.js'

/**
 * CLIN-1 — weight-based immunoglobulin / antiserum dose preview.
 *
 * Pure calculation; no DB write. Reads the service from the catalog only to
 * (a) confirm it is a dose-calculation service and (b) pull the product
 * concentration when the catalog carries one. Mounted behind a clinical-role
 * guard in app.ts.
 */

const doseCalcSchema = z.object({
  // Accept the service catalog code (ERIG_INF | HRIG_INF | HTIG | ATS).
  serviceCode: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[A-Za-z0-9_]+$/, 'serviceCode must be alphanumeric with underscores'),
  // numeric weight in kg — guarded further by the calculator (>0, <=500).
  weightKg: z.number().finite().optional().nullable(),
})

export const doseCalcRouter: RouterType = Router()

function ctx(req: Request) {
  const user = (req as Request & { user: AuthUser }).user
  return {
    tenantId: req.tenant.id,
    userId: user?.id ?? null,
    branchId: user?.branchId ?? null,
  }
}

/** POST /api/dose-calc — preview the calculated immunoglobulin dose for a service. */
doseCalcRouter.post('/', async (req: Request, res: Response) => {
  const parsed = doseCalcSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues })
    return
  }
  const { serviceCode, weightKg } = parsed.data

  // Only the four flagged services have a dosing rule. The frontend sends the
  // catalog id (SVC_ERIG_INF); resolveDoseRule accepts both that and the raw
  // clinical code (ERIG_INF). Reject early with a clear code when neither hits.
  if (!resolveDoseRule(serviceCode)) {
    res.status(400).json({
      error: `Service "${serviceCode}" does not support weight-based dose calculation.`,
      code: 'NOT_DOSE_CALCULATED',
    })
    return
  }

  // Read the catalog row to source the product concentration if present.
  // serviceCode IS the catalog id (raw code) for these rows.
  let productConcentrationIuPerMl: number | null = null
  try {
    const service = await getService(ctx(req), serviceCode)
    if (service && service.requiresDoseCalculation !== true) {
      res.status(400).json({
        error: `Service "${serviceCode}" is not flagged for dose calculation.`,
        code: 'NOT_DOSE_CALCULATED',
      })
      return
    }
    // The catalog does not currently store IU/mL concentration; the calculator
    // falls back to the per-product default in DOSE_RULES. This hook lets a
    // future concentration column override it without a route change.
  } catch {
    // Catalog lookup is best-effort context; the calculation is the source of
    // truth and works from the configured DOSE_RULES table regardless.
    productConcentrationIuPerMl = null
  }

  try {
    const result = calculateDose({
      serviceCode,
      weightKg: weightKg ?? null,
      productConcentrationIuPerMl,
    })
    res.json(result)
  } catch (err) {
    if (err instanceof DoseCalcError) {
      res.status(400).json({ error: err.message, code: err.code })
      return
    }
    throw err
  }
})
