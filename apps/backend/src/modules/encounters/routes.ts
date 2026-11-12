/**
 * Encounters routes — two-tier IDs (W3.a.2, 2026-05-19).
 *
 * Public URL params and bodies use `display_id` (`ENC_…`, `PAT_…`, `USR_…`).
 * Route handlers resolve display_id → bigint before calling into `db.ts`.
 */
import { wire } from '../../contracts/wire.js'
import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { users } from '../../shared/db/schema.js'
import { validate } from '../../shared/middleware/validate.js'
import {
  listEncounters,
  getEncounter,
  createEncounter,
  listVitals,
  createVital,
  listDiagnoses,
  createDiagnosis,
  resolveEncounter,
  completeEncounter,
  cancelEncounter,
} from './db.js'
import { sendLifecycleError } from '../../shared/lib/lifecycleError.js'
import type { AuthUser } from '../../shared/middleware/auth.js'
import {
  encounterIdSchema,
  listQuerySchema,
  createEncounterSchema,
  createVitalSchema,
  createDiagnosisSchema,
  encounterCompleteBodySchema,
  encounterCancelBodySchema,
} from './contract.js'
import type {
  EncountersListResponse,
  EncountersDetailResponse,
  EncountersCreateResponse,
  EncountersVitalsResponse,
  EncountersCreateVitalResponse,
  EncountersDiagnosesResponse,
  EncountersCreateDiagnosisResponse,
  EncountersCompleteResponse,
  EncountersCancelResponse,
} from './contract.js'

export const encountersRouter: RouterType = Router()

encountersRouter.get('/', async (req: Request, res: Response) => {
  const parsed = listQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid query parameters',
      code: 'BAD_REQUEST',
      issues: parsed.error.flatten(),
    })
    return
  }
  const rows = await listEncounters({
    limit: parsed.data.limit ?? 100,
    patientDisplayId: parsed.data.patientId,
    tenantId: req.tenant.id,
    branchId: req.tenant.branchId,
    sort: parsed.data.sort,
    order: parsed.data.order,
  })
  res.json(wire({ data: rows }) satisfies EncountersListResponse)
})

encountersRouter.get('/:displayId', async (req: Request, res: Response) => {
  const parsed = encounterIdSchema.safeParse(req.params['displayId'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid encounter id', code: 'INVALID_ID' })
    return
  }
  const encounter = await getEncounter(parsed.data, req.tenant.id)
  if (!encounter) {
    res.status(404).json({ error: 'Encounter not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire(encounter) satisfies EncountersDetailResponse)
})

/** POST /api/encounters — start a new encounter for a patient */
encountersRouter.post('/', validate(createEncounterSchema), async (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id

  if (user.id === null || user.branchId === null) {
    res.status(400).json({
      error: 'User has no branch assignment',
      code: 'NO_BRANCH',
    })
    return
  }

  const body = req.body as z.infer<typeof createEncounterSchema>

  try {
    const created = await createEncounter({
      tenantId,
      branchId: user.branchId,
      providerId: user.id,
      createdById: user.id,
      patientDisplayId: body.patientId,
      specialty: body.specialty,
      chiefComplaint: body.chiefComplaint,
      specialtyData: body.specialtyData,
      clinicalNotes: body.clinicalNotes,
    })

    if (!created) {
      res.status(500).json({ error: 'Failed to create encounter', code: 'CREATE_FAILED' })
      return
    }

    res.status(201).json(wire(created) satisfies EncountersCreateResponse)
  } catch (err) {
    if (sendLifecycleError(res, err)) return
    throw err
  }
})

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

/** POST /api/encounters/:displayId/complete: sign off the visit (routine, no reason needed). */
encountersRouter.post(
  '/:displayId/complete',
  validate(encounterCompleteBodySchema),
  async (req: Request, res: Response) => {
    const parsedId = encounterIdSchema.safeParse(req.params['displayId'])
    if (!parsedId.success) {
      res.status(400).json({ error: 'Invalid encounter id', code: 'INVALID_ID' })
      return
    }
    const user = (req as Request & { user: AuthUser }).user
    if (user.id === null || user.branchId === null) {
      res.status(400).json({ error: 'User has no branch assignment', code: 'NO_BRANCH' })
      return
    }
    try {
      const updated = await completeEncounter({
        tenantId: req.tenant.id,
        branchId: user.branchId,
        userId: user.id,
        encounterDisplayId: parsedId.data,
      })
      if (!updated) {
        res.status(404).json({ error: 'Encounter not found', code: 'NOT_FOUND' })
        return
      }
      res.json(wire(updated) satisfies EncountersCompleteResponse)
    } catch (err) {
      if (sendLifecycleError(res, err)) return
      throw err
    }
  },
)

/** POST /api/encounters/:displayId/cancel: cancel a visit that has no administered dose. Reason required. */
encountersRouter.post(
  '/:displayId/cancel',
  validate(encounterCancelBodySchema),
  async (req: Request, res: Response) => {
    const parsedId = encounterIdSchema.safeParse(req.params['displayId'])
    if (!parsedId.success) {
      res.status(400).json({ error: 'Invalid encounter id', code: 'INVALID_ID' })
      return
    }
    const user = (req as Request & { user: AuthUser }).user
    if (user.id === null || user.branchId === null) {
      res.status(400).json({ error: 'User has no branch assignment', code: 'NO_BRANCH' })
      return
    }
    const body = req.body as z.infer<typeof encounterCancelBodySchema>
    try {
      const updated = await cancelEncounter({
        tenantId: req.tenant.id,
        branchId: user.branchId,
        userId: user.id,
        encounterDisplayId: parsedId.data,
        reason: body.reason,
      })
      if (!updated) {
        res.status(404).json({ error: 'Encounter not found', code: 'NOT_FOUND' })
        return
      }
      res.json(wire(updated) satisfies EncountersCancelResponse)
    } catch (err) {
      if (sendLifecycleError(res, err)) return
      throw err
    }
  },
)

// ---------------------------------------------------------------------------
// Vitals sub-resource
// ---------------------------------------------------------------------------

/** GET /api/encounters/:displayId/vitals */
encountersRouter.get('/:displayId/vitals', async (req: Request, res: Response) => {
  const parsed = encounterIdSchema.safeParse(req.params['displayId'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid encounter id', code: 'INVALID_ID' })
    return
  }
  const rows = await listVitals(parsed.data, req.tenant.id)
  res.json(wire({ data: rows }) satisfies EncountersVitalsResponse)
})

/** POST /api/encounters/:displayId/vitals */
encountersRouter.post(
  '/:displayId/vitals',
  validate(createVitalSchema),
  async (req: Request, res: Response) => {
    const parsedId = encounterIdSchema.safeParse(req.params['displayId'])
    if (!parsedId.success) {
      res.status(400).json({ error: 'Invalid encounter id', code: 'INVALID_ID' })
      return
    }
    const encounterDisplayId = parsedId.data

    // Resolve to bigint encounter + patient.
    const resolved = await resolveEncounter(encounterDisplayId, req.tenant.id)
    if (!resolved) {
      res.status(404).json({ error: 'Encounter not found', code: 'NOT_FOUND' })
      return
    }

    const user = (req as Request & { user: AuthUser }).user
    if (user.id === null) {
      res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      return
    }
    const body = req.body as z.infer<typeof createVitalSchema>

    // Normalise systolic/diastolic aliases
    const systolicBp = body.systolicBp ?? body.systolic
    const diastolicBp = body.diastolicBp ?? body.diastolic

    const created = await createVital(
      {
        encounterBigint: resolved.id,
        patientBigint: resolved.patientId,
        recordedById: user.id,
        temperatureC: body.temperatureC,
        heartRateBpm: body.heartRateBpm,
        respiratoryRateBpm: body.respiratoryRateBpm,
        systolicBp,
        diastolicBp,
        spo2Percent: body.spo2Percent,
        weightKg: body.weightKg,
        heightCm: body.heightCm,
        bmi: body.bmi,
        painScore: body.painScore,
        extra: body.extra,
      },
      user.id,
      req.tenant.id,
    )

    if (!created) {
      res.status(500).json({ error: 'Failed to record vitals', code: 'CREATE_FAILED' })
      return
    }

    res.status(201).json(wire(created) satisfies EncountersCreateVitalResponse)
  },
)

// ---------------------------------------------------------------------------
// Diagnoses sub-resource
// ---------------------------------------------------------------------------

/** GET /api/encounters/:displayId/diagnoses */
encountersRouter.get('/:displayId/diagnoses', async (req: Request, res: Response) => {
  const parsed = encounterIdSchema.safeParse(req.params['displayId'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid encounter id', code: 'INVALID_ID' })
    return
  }
  const rows = await listDiagnoses(parsed.data, req.tenant.id)
  res.json(wire({ data: rows }) satisfies EncountersDiagnosesResponse)
})

/** POST /api/encounters/:displayId/diagnoses */
encountersRouter.post(
  '/:displayId/diagnoses',
  validate(createDiagnosisSchema),
  async (req: Request, res: Response) => {
    const parsedId = encounterIdSchema.safeParse(req.params['displayId'])
    if (!parsedId.success) {
      res.status(400).json({ error: 'Invalid encounter id', code: 'INVALID_ID' })
      return
    }
    const encounterDisplayId = parsedId.data

    const resolved = await resolveEncounter(encounterDisplayId, req.tenant.id)
    if (!resolved) {
      res.status(404).json({ error: 'Encounter not found', code: 'NOT_FOUND' })
      return
    }

    const user = (req as Request & { user: AuthUser }).user
    if (user.id === null) {
      res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
      return
    }
    const body = req.body as z.infer<typeof createDiagnosisSchema>

    const diagnosisType = body.diagnosisType

    // recordedById is a USR_ display_id in the body; resolve to bigint if
    // supplied, otherwise default to the current user.
    let recordedById = user.id
    if (body.recordedById) {
      const u = await withTenantTx(
        { tenantId: req.tenant.id, userId: 0, branchId: null },
        async (tx) => {
          const [row] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.displayId, body.recordedById!), eq(users.tenantId, req.tenant.id)))
            .limit(1)
          return row ?? null
        },
      )
      if (u) recordedById = u.id
    }

    const created = await createDiagnosis(
      {
        encounterBigint: resolved.id,
        patientBigint: resolved.patientId,
        icd10Code: body.icd10Code,
        description: body.description,
        isPrimary: body.isPrimary,
        diagnosisType,
        recordedById,
        notes: body.notes,
      },
      user.id,
      req.tenant.id,
    )

    if (!created) {
      res.status(500).json({ error: 'Failed to record diagnosis', code: 'CREATE_FAILED' })
      return
    }

    res.status(201).json(wire(created) satisfies EncountersCreateDiagnosisResponse)
  },
)
