import { wire } from '../../contracts/wire.js'
import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { z } from 'zod'
import { requireRole } from '../../shared/middleware/requireRole.js'
import {
  listPatients,
  getPatient,
  getPatientTags,
  createPatient,
  updatePatient,
  addPatientTag,
  listEmergencyContacts,
  createEmergencyContact,
  softDeleteEmergencyContact,
  listExternalImmunizations,
  createExternalImmunization,
  verifyExternalImmunization,
  listConsents,
  listPatientAllergies,
  createPatientAllergy,
  updatePatientAllergy,
  softDeletePatientAllergy,
  listPatientConditions,
  createPatientCondition,
  updatePatientCondition,
  softDeletePatientCondition,
  getPepProgress,
  resolvePatientId,
  resolvePatientBranchContext,
  isCrossBranchPatient,
  getPatientDemographicProjection,
  breakGlassPatientChart,
} from './db.js'
import { getRequestContext } from '../../shared/middleware/requestContext.js'
import { getPatientCredit } from '../transactions/db.js'
import { sendLifecycleError } from '../../shared/lib/lifecycleError.js'
import {
  patDisplayIdSchema,
  patientsListQuery,
  createPatientBody,
  updatePatientBody,
  addTagBody,
  createEmergencyContactBody,
  createExternalImmunizationBody,
  verifyExternalImmunizationBody,
  createAllergyBody,
  updateAllergyBody,
  createConditionBody,
  updateConditionBody,
  breakGlassBody,
  type PatientsListResponse,
  type PatientsCreateResponse,
  type PatientsDetailResponse,
  type PatientsUpdateResponse,
  type PatientsCreditResponse,
  type PatientsPepProgressResponse,
  type PatientsTagsResponse,
  type PatientsAddTagResponse,
  type PatientsEmergencyContactsResponse,
  type PatientsCreateEmergencyContactResponse,
  type PatientsExternalImmunizationsResponse,
  type PatientsCreateExternalImmunizationResponse,
  type PatientsVerifyExternalImmunizationResponse,
  type PatientsAllergiesResponse,
  type PatientsCreateAllergyResponse,
  type PatientsUpdateAllergyResponse,
  type PatientsConditionsResponse,
  type PatientsCreateConditionResponse,
  type PatientsUpdateConditionResponse,
  type PatientsConsentsResponse,
  type PatientsDemographicResponse,
  type PatientsBreakGlassResponse,
} from './contract.js'
import type { AuthUser } from '../../shared/middleware/auth.js'
import { resolveClinicalReviewer } from '../../shared/utils/clinicianAttestation.js'

export const patientsRouter: RouterType = Router()

// Child table rows use bigserial PKs (no display_id on child tables).
// Route params like :allergyId, :conditionId, :contactId are numeric.
const numericIdSchema = z.coerce.number().int().positive()

// Allow-list of sortable column keys lives in the contract's listQuery enum.
// NEVER pass req.query.sort directly to Drizzle sql.identifier() — always map
// through this type (validated by patientsListQuery at the route layer).
type PatientSortCol = NonNullable<z.infer<typeof patientsListQuery>['sort']>

async function resolveWritablePatient(
  req: Request,
  res: Response,
  patientDisplayId: string,
): Promise<{ id: number; homeBranchId: number | null } | null> {
  const patientCtx = await resolvePatientBranchContext(patientDisplayId, req.tenant.id)
  if (!patientCtx) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return null
  }
  if (isCrossBranchPatient(patientCtx.homeBranchId, req.tenant.branchId)) {
    res.status(403).json({
      error: 'Cross-branch chart reveal is read-only; switch to the patient home branch to write',
      code: 'CROSS_BRANCH_WRITE_FORBIDDEN',
    })
    return null
  }
  return patientCtx
}

patientsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = patientsListQuery.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_PARAMS', details: parsed.error.flatten() })
    return
  }
  const { q, cursor, limit, sort, order } = parsed.data
  const sortCol: PatientSortCol = sort ?? 'created_at'
  const sortOrder = order ?? (sortCol === 'last_name' ? 'asc' : 'desc')
  // Cursor pagination only works reliably with the default sort (created_at, id).
  // When a non-default sort is requested, disable cursor so we return top-N by
  // the new order. Full cursor + arbitrary sort is deferred to Phase 2.
  const effectiveCursor = sortCol === 'created_at' ? cursor || undefined : undefined
  const result = await listPatients({
    q: q || undefined,
    cursor: effectiveCursor,
    limit,
    tenantId: req.tenant.id,
    sort: sortCol,
    order: sortOrder,
    // Caller's own branch, used only to mask detail fields for a patient
    // homed at a DIFFERENT branch (Cross-Branch PHI RFC, R3). Never affects
    // which rows are returned; the search itself stays tenant-wide.
    callerBranchId: req.tenant.branchId,
  })
  res.set('X-Total-Count', String(result.totalCount))
  // Only propagate next-cursor when pagination is active (default sort)
  if (result.nextCursor && !sort) res.set('X-Next-Cursor', result.nextCursor)
  res.json(wire(result) satisfies PatientsListResponse)
})

patientsRouter.get('/:displayId', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'INVALID_ID' })
    return
  }
  // Caller's own branch, a patient homed at a different branch gets detail
  // fields masked below (Cross-Branch PHI RFC, R3). See patients/db.ts.
  const patient = await getPatient(idParsed.data, req.tenant.id, req.tenant.branchId)
  if (!patient) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire(patient) satisfies PatientsDetailResponse)
})

/**
 * GET /api/patients/:displayId/credit — the patient's spendable prepaid credit
 * (sum of un-consumed deposits) plus the per-deposit breakdown. Used by the
 * cashier UI to offer "apply patient credit" / show an available balance.
 */
patientsRouter.get('/:displayId/credit', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'INVALID_ID' })
    return
  }
  try {
    const credit = await getPatientCredit({
      tenantId: req.tenant.id,
      // SELECT-only — userId is just the audit-GUC sentinel (no write).
      userId: req.tenant.userId ?? 0,
      branchId: req.tenant.branchId,
      patientDisplayId: idParsed.data,
    })
    res.json(wire(credit) satisfies PatientsCreditResponse)
  } catch (err) {
    if (sendLifecycleError(res, err)) return
    throw err
  }
})

patientsRouter.patch('/:displayId', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'INVALID_ID' })
    return
  }
  const bodyParsed = updatePatientBody.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: bodyParsed.error.flatten(),
    })
    return
  }
  const patientCtx = await resolveWritablePatient(req, res, idParsed.data)
  if (!patientCtx) return
  const {
    dateOfBirth,
    email,
    allergies: _allergies,
    conditions: _conditions,
    ...rest
  } = bodyParsed.data
  const updated = await updatePatient(
    idParsed.data,
    req.tenant.id,
    req.tenant.userId,
    {
      ...rest,
      dateOfBirth: dateOfBirth ?? undefined,
      email: email || undefined,
    },
    req.tenant.branchId,
  )
  if (!updated) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire(updated) satisfies PatientsUpdateResponse)
})

patientsRouter.get('/:displayId/pep-progress', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'INVALID_ID' })
    return
  }
  // Resolve display_id → bigint
  const internalId = await resolvePatientId(idParsed.data, req.tenant.id)
  if (internalId === null) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  const progress = await getPepProgress(internalId, {
    tenantId: req.tenant.id,
    userId: req.tenant.userId,
    branchId: req.tenant.branchId,
  })
  res.json(wire(progress) satisfies PatientsPepProgressResponse)
})

patientsRouter.get('/:displayId/tags', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'VALIDATION_ERROR' })
    return
  }
  const internalId = await resolvePatientId(idParsed.data, req.tenant.id)
  if (internalId === null) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  const tags = await getPatientTags(internalId, req.tenant.id)
  res.json(wire(tags) satisfies PatientsTagsResponse)
})

patientsRouter.post('/:displayId/tags', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'VALIDATION_ERROR' })
    return
  }
  const bodyParsed = addTagBody.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: bodyParsed.error.flatten(),
    })
    return
  }

  const patientCtx = await resolveWritablePatient(req, res, idParsed.data)
  if (!patientCtx) return

  const created = await addPatientTag({
    patientId: patientCtx.id,
    tag: bodyParsed.data.tag,
    tenantId: req.tenant.id,
    userId: req.tenant.userId,
    branchId: req.tenant.branchId,
  })

  res.status(201).json(wire(created) satisfies PatientsAddTagResponse)
})

patientsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = createPatientBody.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten(),
    })
    return
  }

  const { dateOfBirth, email, consentObtained, consentBy, ...rest } = parsed.data
  const patient = await createPatient({
    ...rest,
    dateOfBirth: dateOfBirth ?? undefined,
    email: email || undefined,
    tenantId: req.tenant.id,
    branchId: req.tenant.branchId,
    createdById: req.tenant.userId,
    consentObtained,
    consentBy,
  })

  res.status(201).json(wire(patient) satisfies PatientsCreateResponse)
})

// ---------------------------------------------------------------------------
// Emergency Contacts
// ---------------------------------------------------------------------------

patientsRouter.get('/:displayId/emergency-contacts', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'VALIDATION_ERROR' })
    return
  }
  const internalId = await resolvePatientId(idParsed.data, req.tenant.id)
  if (internalId === null) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  const contacts = await listEmergencyContacts(internalId, req.tenant.id)
  res.json(wire(contacts) satisfies PatientsEmergencyContactsResponse)
})

patientsRouter.post('/:displayId/emergency-contacts', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'VALIDATION_ERROR' })
    return
  }
  const bodyParsed = createEmergencyContactBody.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: bodyParsed.error.flatten(),
    })
    return
  }

  const patientCtx = await resolveWritablePatient(req, res, idParsed.data)
  if (!patientCtx) return

  const { name, relation, phone, email, isPrimary } = bodyParsed.data
  const contact = await createEmergencyContact({
    patientId: patientCtx.id,
    name,
    relationship: relation,
    phoneNumber: phone,
    email: email || undefined,
    isPrimary: isPrimary ?? false,
    tenantId: req.tenant.id,
    userId: req.tenant.userId,
    branchId: req.tenant.branchId,
  })

  res.status(201).json(wire(contact) satisfies PatientsCreateEmergencyContactResponse)
})

patientsRouter.delete(
  '/:displayId/emergency-contacts/:contactId',
  async (req: Request, res: Response) => {
    const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
    const contactIdParsed = numericIdSchema.safeParse(req.params['contactId'])
    if (!idParsed.success || !contactIdParsed.success) {
      res.status(400).json({ error: 'Invalid id', code: 'VALIDATION_ERROR' })
      return
    }
    const patientCtx = await resolveWritablePatient(req, res, idParsed.data)
    if (!patientCtx) return
    const deleted = await softDeleteEmergencyContact(
      patientCtx.id,
      contactIdParsed.data,
      req.tenant.id,
      req.tenant.userId,
      req.tenant.branchId,
    )
    if (!deleted) {
      res.status(404).json({ error: 'Emergency contact not found', code: 'NOT_FOUND' })
      return
    }
    res.status(204).end()
  },
)

// ---------------------------------------------------------------------------
// External Immunizations
// ---------------------------------------------------------------------------

patientsRouter.get('/:displayId/external-immunizations', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'VALIDATION_ERROR' })
    return
  }
  const internalId = await resolvePatientId(idParsed.data, req.tenant.id)
  if (internalId === null) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  const immunizations = await listExternalImmunizations(internalId, req.tenant.id)
  res.json(wire(immunizations) satisfies PatientsExternalImmunizationsResponse)
})

patientsRouter.post('/:displayId/external-immunizations', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'VALIDATION_ERROR' })
    return
  }
  const bodyParsed = createExternalImmunizationBody.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: bodyParsed.error.flatten(),
    })
    return
  }

  const patientCtx = await resolveWritablePatient(req, res, idParsed.data)
  if (!patientCtx) return

  const immunization = await createExternalImmunization({
    patientId: patientCtx.id,
    ...bodyParsed.data,
    tenantId: req.tenant.id,
    userId: req.tenant.userId,
    branchId: req.tenant.branchId,
  })

  res.status(201).json(wire(immunization) satisfies PatientsCreateExternalImmunizationResponse)
})

patientsRouter.patch(
  '/:displayId/external-immunizations/:immunizationId/verify',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  async (req: Request, res: Response) => {
    const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
    const immunizationIdParsed = numericIdSchema.safeParse(req.params['immunizationId'])
    const bodyParsed = verifyExternalImmunizationBody.safeParse(req.body)
    if (!idParsed.success || !immunizationIdParsed.success || !bodyParsed.success) {
      res.status(400).json({ error: 'Invalid verification request', code: 'VALIDATION_ERROR' })
      return
    }

    const patientCtx = await resolveWritablePatient(req, res, idParsed.data)
    if (!patientCtx) return
    const user = (req as Request & { user: AuthUser }).user
    if (user.id == null) {
      res.status(401).json({ error: 'Authenticated user required', code: 'UNAUTHENTICATED' })
      return
    }

    try {
      const reviewerUserId = await resolveClinicalReviewer({
        tenantId: req.tenant.id,
        branchId: req.tenant.branchId,
        caller: {
          id: user.id,
          role: user.role,
          displayId: user.displayId,
        },
        reviewedById: bodyParsed.data.reviewedById,
        attestationPin: bodyParsed.data.attestationPin,
      })
      const result = await verifyExternalImmunization({
        patientId: patientCtx.id,
        immunizationId: immunizationIdParsed.data,
        tenantId: req.tenant.id,
        branchId: req.tenant.branchId,
        sessionUserId: user.id,
        reviewerUserId,
      })
      if (!result.ok) {
        if (result.code === 'ALREADY_VERIFIED') {
          res.status(409).json({
            error: 'This external immunization was already verified',
            code: result.code,
          })
        } else {
          res.status(404).json({
            error: 'External immunization not found',
            code: result.code,
          })
        }
        return
      }
      res.json(wire(result.immunization) satisfies PatientsVerifyExternalImmunizationResponse)
    } catch (err) {
      if (sendLifecycleError(res, err)) return
      throw err
    }
  },
)

// ---------------------------------------------------------------------------
// Patient Allergies
// ---------------------------------------------------------------------------

patientsRouter.get('/:displayId/allergies', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'VALIDATION_ERROR' })
    return
  }
  const patientCtx = await resolvePatientBranchContext(idParsed.data, req.tenant.id)
  if (!patientCtx) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  // Cross-Branch PHI RFC Tier-2 masking, extended to allergies (owner
  // decision, nurse-testing-readiness follow-up); see isCrossBranchPatient
  // and maskAllergyRow doc comments in db.ts.
  const isCrossBranch = isCrossBranchPatient(patientCtx.homeBranchId, req.tenant.branchId)
  const rows = await listPatientAllergies(patientCtx.id, req.tenant.id, isCrossBranch)
  res.json(wire(rows) satisfies PatientsAllergiesResponse)
})

patientsRouter.post('/:displayId/allergies', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'VALIDATION_ERROR' })
    return
  }
  const bodyParsed = createAllergyBody.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: bodyParsed.error.flatten(),
    })
    return
  }

  const patientCtx = await resolvePatientBranchContext(idParsed.data, req.tenant.id)
  if (!patientCtx) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  // Write-guard: `patient_allergies` carries no branch_id column, so nothing
  // at the DB layer stops a cross-branch write the way branch_isolation's
  // WITH CHECK stops one on encounters/transactions. The frontend hides the
  // Add/Edit affordance for a cross-branch patient, but that is a UX
  // decision, not a security boundary: this 403 is the actual boundary.
  // Break-glass does not lift it: the reveal is read-only by design.
  if (isCrossBranchPatient(patientCtx.homeBranchId, req.tenant.branchId)) {
    res.status(403).json({
      error: 'Cannot add an allergy for a patient homed at another branch',
      code: 'CROSS_BRANCH_WRITE_FORBIDDEN',
    })
    return
  }

  const created = await createPatientAllergy({
    patientId: patientCtx.id,
    ...bodyParsed.data,
    tenantId: req.tenant.id,
    userId: req.tenant.userId,
    branchId: req.tenant.branchId,
  })
  res.status(201).json(wire(created) satisfies PatientsCreateAllergyResponse)
})

patientsRouter.patch('/:displayId/allergies/:allergyId', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  const allergyIdParsed = numericIdSchema.safeParse(req.params['allergyId'])
  if (!idParsed.success || !allergyIdParsed.success) {
    res.status(400).json({ error: 'Invalid id', code: 'VALIDATION_ERROR' })
    return
  }
  const bodyParsed = updateAllergyBody.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: bodyParsed.error.flatten(),
    })
    return
  }

  const patientCtx = await resolvePatientBranchContext(idParsed.data, req.tenant.id)
  if (!patientCtx) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  // Write-guard: see the POST handler above for why this is app-layer, not RLS.
  if (isCrossBranchPatient(patientCtx.homeBranchId, req.tenant.branchId)) {
    res.status(403).json({
      error: 'Cannot edit an allergy for a patient homed at another branch',
      code: 'CROSS_BRANCH_WRITE_FORBIDDEN',
    })
    return
  }

  const updated = await updatePatientAllergy({
    patientId: patientCtx.id,
    allergyId: allergyIdParsed.data,
    ...bodyParsed.data,
    tenantId: req.tenant.id,
    userId: req.tenant.userId,
    branchId: req.tenant.branchId,
  })
  if (!updated) {
    res.status(404).json({ error: 'Allergy not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire(updated) satisfies PatientsUpdateAllergyResponse)
})

patientsRouter.delete('/:displayId/allergies/:allergyId', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  const allergyIdParsed = numericIdSchema.safeParse(req.params['allergyId'])
  if (!idParsed.success || !allergyIdParsed.success) {
    res.status(400).json({ error: 'Invalid id', code: 'VALIDATION_ERROR' })
    return
  }
  const patientCtx = await resolvePatientBranchContext(idParsed.data, req.tenant.id)
  if (!patientCtx) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  // Write-guard: see the POST handler above for why this is app-layer, not RLS.
  if (isCrossBranchPatient(patientCtx.homeBranchId, req.tenant.branchId)) {
    res.status(403).json({
      error: 'Cannot delete an allergy for a patient homed at another branch',
      code: 'CROSS_BRANCH_WRITE_FORBIDDEN',
    })
    return
  }
  const deleted = await softDeletePatientAllergy(
    patientCtx.id,
    allergyIdParsed.data,
    req.tenant.id,
    req.tenant.userId,
    req.tenant.branchId,
  )
  if (!deleted) {
    res.status(404).json({ error: 'Allergy not found', code: 'NOT_FOUND' })
    return
  }
  res.status(204).end()
})

// ---------------------------------------------------------------------------
// Patient Conditions
// ---------------------------------------------------------------------------

patientsRouter.get('/:displayId/conditions', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'VALIDATION_ERROR' })
    return
  }
  const patientCtx = await resolvePatientBranchContext(idParsed.data, req.tenant.id)
  if (!patientCtx) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  // Cross-Branch PHI RFC Tier-2 masking, extended to conditions (owner
  // decision, nurse-testing-readiness follow-up); see isCrossBranchPatient
  // and maskConditionRow doc comments in db.ts.
  const isCrossBranch = isCrossBranchPatient(patientCtx.homeBranchId, req.tenant.branchId)
  const rows = await listPatientConditions(patientCtx.id, req.tenant.id, isCrossBranch)
  res.json(wire(rows) satisfies PatientsConditionsResponse)
})

patientsRouter.post('/:displayId/conditions', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'VALIDATION_ERROR' })
    return
  }
  const bodyParsed = createConditionBody.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: bodyParsed.error.flatten(),
    })
    return
  }

  const patientCtx = await resolvePatientBranchContext(idParsed.data, req.tenant.id)
  if (!patientCtx) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  // Write-guard: `patient_conditions` carries no branch_id column either,
  // see the identical comment on the allergies POST handler above.
  if (isCrossBranchPatient(patientCtx.homeBranchId, req.tenant.branchId)) {
    res.status(403).json({
      error: 'Cannot add a condition for a patient homed at another branch',
      code: 'CROSS_BRANCH_WRITE_FORBIDDEN',
    })
    return
  }

  const created = await createPatientCondition({
    patientId: patientCtx.id,
    ...bodyParsed.data,
    tenantId: req.tenant.id,
    userId: req.tenant.userId,
    branchId: req.tenant.branchId,
  })
  res.status(201).json(wire(created) satisfies PatientsCreateConditionResponse)
})

patientsRouter.patch('/:displayId/conditions/:conditionId', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  const conditionIdParsed = numericIdSchema.safeParse(req.params['conditionId'])
  if (!idParsed.success || !conditionIdParsed.success) {
    res.status(400).json({ error: 'Invalid id', code: 'VALIDATION_ERROR' })
    return
  }
  const bodyParsed = updateConditionBody.safeParse(req.body)
  if (!bodyParsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: bodyParsed.error.flatten(),
    })
    return
  }

  const patientCtx = await resolvePatientBranchContext(idParsed.data, req.tenant.id)
  if (!patientCtx) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  // Write-guard: see the allergies POST handler above for why this is
  // app-layer, not RLS.
  if (isCrossBranchPatient(patientCtx.homeBranchId, req.tenant.branchId)) {
    res.status(403).json({
      error: 'Cannot edit a condition for a patient homed at another branch',
      code: 'CROSS_BRANCH_WRITE_FORBIDDEN',
    })
    return
  }

  const updated = await updatePatientCondition({
    patientId: patientCtx.id,
    conditionId: conditionIdParsed.data,
    ...bodyParsed.data,
    tenantId: req.tenant.id,
    userId: req.tenant.userId,
    branchId: req.tenant.branchId,
  })
  if (!updated) {
    res.status(404).json({ error: 'Condition not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire(updated) satisfies PatientsUpdateConditionResponse)
})

patientsRouter.delete(
  '/:displayId/conditions/:conditionId',
  async (req: Request, res: Response) => {
    const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
    const conditionIdParsed = numericIdSchema.safeParse(req.params['conditionId'])
    if (!idParsed.success || !conditionIdParsed.success) {
      res.status(400).json({ error: 'Invalid id', code: 'VALIDATION_ERROR' })
      return
    }
    const patientCtx = await resolvePatientBranchContext(idParsed.data, req.tenant.id)
    if (!patientCtx) {
      res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
      return
    }
    // Write-guard: see the allergies POST handler above for why this is
    // app-layer, not RLS.
    if (isCrossBranchPatient(patientCtx.homeBranchId, req.tenant.branchId)) {
      res.status(403).json({
        error: 'Cannot delete a condition for a patient homed at another branch',
        code: 'CROSS_BRANCH_WRITE_FORBIDDEN',
      })
      return
    }
    const deleted = await softDeletePatientCondition(
      patientCtx.id,
      conditionIdParsed.data,
      req.tenant.id,
      req.tenant.userId,
      req.tenant.branchId,
    )
    if (!deleted) {
      res.status(404).json({ error: 'Condition not found', code: 'NOT_FOUND' })
      return
    }
    res.status(204).end()
  },
)

// ---------------------------------------------------------------------------
// Consents (reads from new `consents` table — schema v2 Phase 2)
// ---------------------------------------------------------------------------

patientsRouter.get('/:displayId/consents', async (req: Request, res: Response) => {
  const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'VALIDATION_ERROR' })
    return
  }
  const internalId = await resolvePatientId(idParsed.data, req.tenant.id)
  if (internalId === null) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return
  }
  const rows = await listConsents(internalId, req.tenant.id)
  res.json(wire(rows) satisfies PatientsConsentsResponse)
})

// ---------------------------------------------------------------------------
// Tier-1 demographic projection — Cross-Branch PHI RFC Step 2
// GET /api/patients/:displayId/demographic
//
// Returns the safe cross-branch demographic projection from
// patients_demographic_v: demographics + allergies + active conditions +
// DPA consent status. The view inherits tenant_id RLS from the `patients`
// table, so cross-tenant leakage is impossible.
//
// Role guard: widened (nurse-testing-readiness R3) to every clinical role,
// matching the allow-list on /api/lab-orders and /api/dose-calc in app.ts.
// `Branch` is the ONLY login a real clinic uses (a single service account
// per physical location), so gating this to TenantAdmin | BranchAdmin left
// the Tier-1 safety signals (activeRecalls, recentCriticalLabResults) and
// the cross-branch banner permanently unreachable for every real clinic
// session: the 403 silently disabled PatientDetail's recall/critical-lab
// banners (see PatientDetail.tsx). Cashier stays out, matching the
// lab-orders/dose-calc convention.
// ---------------------------------------------------------------------------

patientsRouter.get(
  '/:displayId/demographic',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  async (req: Request, res: Response) => {
    const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
    if (!idParsed.success) {
      res.status(400).json({ error: 'Invalid patient id', code: 'INVALID_ID' })
      return
    }
    const projection = await getPatientDemographicProjection(idParsed.data, req.tenant.id)
    if (!projection) {
      res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
      return
    }
    res.json(wire(projection) satisfies PatientsDemographicResponse)
  },
)

// ---------------------------------------------------------------------------
// Break-the-glass cross-branch reveal — Cross-Branch PHI RFC Step 4c
// POST /api/patients/:displayId/break-glass
//
// Tier-3 access: reveals the patient's full chart at a DIFFERENT branch with a
// mandatory reason + audit emission. The reason is captured, an audit_logs row
// (action=CROSS_BRANCH_ACCESS) fires on EVERY call, and a persistent
// cross_branch_access_grants row (CBA_…) is created on the FIRST access per
// (tenant, target_branch, patient) tuple (D1, ON CONFLICT DO NOTHING).
//
// withTenantTx({ crossBranchRead }) sets app.cross_branch_read='true' so the
// branch_isolation RLS USING clause reveals the target branch's rows. The
// reveal is READ-ONLY: the RLS WITH CHECK never honors cross_branch_read
// (RFC §4.3 / Step 7a). Returns the grant CBA_ id for the frontend sticky toast.
//
// Role guard: widened (nurse-testing-readiness R3) to match the /demographic
// endpoint above: every clinical role including `Branch`, the single login a
// real clinic uses. Break-glass itself stays behind the mandatory typed-reason
// gate (BreakGlassReveal.tsx) and every access is still audited
// (CROSS_BRANCH_ACCESS row + the persistent cross_branch_access_grants row).
// ---------------------------------------------------------------------------

patientsRouter.post(
  '/:displayId/break-glass',
  requireRole('TenantAdmin', 'BranchAdmin', 'Physician', 'Nurse', 'Branch'),
  async (req: Request, res: Response) => {
    const idParsed = patDisplayIdSchema.safeParse(req.params['displayId'])
    if (!idParsed.success) {
      res.status(400).json({ error: 'Invalid patient id', code: 'INVALID_ID' })
      return
    }
    const bodyParsed = breakGlassBody.safeParse(req.body)
    if (!bodyParsed.success) {
      res.status(400).json({ error: 'Invalid break-glass request', code: 'VALIDATION_ERROR' })
      return
    }
    // Break-glass requires a real authenticated tenant user to attribute the
    // grant + audit row to. Platform admins (userId null) cannot break glass —
    // they bypass branch_isolation via withPlatformTx for operational reads.
    const actingUserId = req.tenant.userId
    if (actingUserId === null) {
      res.status(403).json({ error: 'Authenticated user required', code: 'USER_REQUIRED' })
      return
    }

    const result = await breakGlassPatientChart({
      patientDisplayId: idParsed.data,
      targetBranchDisplayId: bodyParsed.data.targetBranchId,
      reasonCategory: bodyParsed.data.reasonCategory,
      reasonDetail: bodyParsed.data.reasonDetail,
      tenantId: req.tenant.id,
      userId: actingUserId,
      sourceBranchId: req.tenant.branchId,
      correlationId: getRequestContext()?.correlationId,
    })

    if (!result.ok) {
      const status = 404
      const error = result.code === 'BRANCH_NOT_FOUND' ? 'Branch not found' : 'Patient not found'
      res.status(status).json({ error, code: result.code })
      return
    }

    res.json(wire(result.chart) satisfies PatientsBreakGlassResponse)
  },
)
