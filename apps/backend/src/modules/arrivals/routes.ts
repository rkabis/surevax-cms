import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { eq, and, inArray } from 'drizzle-orm'
import { displayId, catalogCodeSchema } from '../../shared/utils/displayId.js'
import {
  consents,
  encounters,
  patients,
  patientStandingOrders,
  serviceCatalog,
  standingOrderTemplateItems,
  users,
} from '../../shared/db/schema.js'
import { withTenantTx, type Tx } from '../../shared/db/withTenantTx.js'
import type { AuthUser } from '../../shared/middleware/auth.js'
import { startStandingOrderTx } from '../standing_orders/db.js'
import { createBiteIncidentInTx } from '../bite_incidents/db.js'
import { clinicCalendarDate } from '../scheduled_orders/dateMath.js'
import { previewBundle } from './db.js'
import { assertNoActiveEncounterTx } from '../encounters/db.js'
import { LifecycleError } from '../transactions/db.js'
import { sendLifecycleError } from '../../shared/lib/lifecycleError.js'
// Schemas live in the module contract (./contract.ts) so codegen and the
// runtime validators share one source — see docs/specs/api-contract-codegen.md.
import {
  previewQuerySchema,
  atomicBodySchema,
  type ArrivalsPreviewBundleResponse,
  type ArrivalsAtomicResponse,
} from './contract.js'

// Bite-incident enum allow-lists — kept in sync with the Postgres enums
// (bite_species, animal_vaccination_status, exposure_category) and with the
// shared biteAssessmentSchema. Used to coerce inbound JSONB safely.
const BITE_SPECIES = new Set(['Dog', 'Cat', 'Bat', 'Monkey', 'Other'])
const ANIMAL_ARV_STATUS = new Set(['Vaccinated', 'NotVaccinated', 'Unknown'])
const EXPOSURE_CATEGORY = new Set(['I', 'II', 'III'])

export const arrivalsRouter: RouterType = Router()

/** Normalize single + multi template inputs into a deduped, ordered list. */
function normalizeTemplateIds(single: string | undefined, multi: string[] | undefined): string[] {
  const list = multi && multi.length > 0 ? multi : single ? [single] : []
  return Array.from(new Set(list))
}

/**
 * Category III rabies arrivals must include an ERIG or HRIG service. Resolve
 * this from template-item/service data inside the same transaction instead of
 * trusting a template-code naming convention or the browser's selection state.
 */
async function assertCategoryIIIRigCoverage(
  tx: Tx,
  tenantId: string,
  templateIds: string[],
): Promise<void> {
  const services = await tx
    .select({ code: serviceCatalog.code })
    .from(standingOrderTemplateItems)
    .innerJoin(serviceCatalog, eq(standingOrderTemplateItems.serviceId, serviceCatalog.id))
    .where(
      and(
        eq(standingOrderTemplateItems.tenantId, tenantId),
        inArray(standingOrderTemplateItems.templateId, templateIds),
      ),
    )

  if (!services.some(({ code }) => /(?:^|_)(?:ERIG|HRIG)(?:_|$)/.test(code))) {
    throw new Error('CAT_III_RIG_REQUIRED')
  }
}

/**
 * GET /api/arrivals/preview-bundle
 *
 * Read-only FEFO preview for a template + triage context.
 * Returns Day-0 items with the earliest-expiring lot per service.
 * No writes — no reservation.
 */
arrivalsRouter.get('/preview-bundle', async (req: Request, res: Response) => {
  const parsed = previewQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid query parameters',
      code: 'BAD_REQUEST',
      issues: parsed.error.flatten(),
    })
    return
  }

  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id

  if (!user.branchId) {
    res.status(400).json({ error: 'No branch context', code: 'NO_BRANCH' })
    return
  }

  // templateIds (comma-separated) wins over single templateId. Re-validate each
  // segment against the catalog-code shape since the comma form arrives as one string.
  const rawIds = parsed.data.templateIds
    ? parsed.data.templateIds.split(',').map((s) => s.trim())
    : [parsed.data.templateId!]
  const idChecks = rawIds.map((id) => catalogCodeSchema.safeParse(id))
  if (idChecks.some((c) => !c.success)) {
    res.status(400).json({ error: 'Invalid templateIds', code: 'BAD_REQUEST' })
    return
  }

  const result = await previewBundle({
    tenantId,
    branchId: user.branchId, // bigint (number)
    templateIds: Array.from(new Set(rawIds)),
  })

  res.json(result satisfies ArrivalsPreviewBundleResponse)
})

/**
 * POST /api/arrivals/atomic
 *
 * Single transaction that:
 *   1. Creates an encounter (with triage_category, specialty, etc.)
 *   2. Creates a patient_standing_order + clinical_orders via startStandingOrderTx
 *
 * AUTHORIZED DEVIATION: Draft transaction creation is deferred to a follow-up PR.
 * The placeholder at Step3Protocol.tsx:460 (TXN id from server-issued draft) is
 * retained in the frontend. See handover-remaining-pure-lake.md for context.
 *
 * Response: { encounterId, patientStandingOrderId, scheduledOrderIds }
 */
arrivalsRouter.post('/atomic', async (req: Request, res: Response) => {
  const parsed = atomicBodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request body',
      code: 'BAD_REQUEST',
      issues: parsed.error.flatten(),
    })
    return
  }

  const user = (req as Request & { user: AuthUser }).user
  const tenantId = req.tenant.id

  if (!user.id) {
    res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' })
    return
  }
  // Cache narrowed bigint — TS doesn't propagate the truthy narrow through
  // the withTenantTx closure below.
  const userBigintId: number = user.id

  if (!user.branchId) {
    res.status(400).json({ error: 'No branch context', code: 'NO_BRANCH' })
    return
  }

  const body = parsed.data

  // NOTE: patient + provider are resolved INSIDE the withTenantTx below, not
  // here. Bare `db` reads outside a tenant transaction run with no
  // `app.current_tenant_id` GUC, so under FORCE ROW LEVEL SECURITY (the app
  // connects as the non-superuser `surevax_app` role) they return zero rows —
  // which previously made the atomic commit 404 on every patient. See
  // `.claude/rules/gotchas.md` (RLS bare-read).

  // Single withTenantTx: encounter + PSO in one unit.
  // RLS SET LOCAL covers the audit trigger requirement on all writes.
  try {
    const result = await withTenantTx(
      { tenantId, userId: userBigintId, branchId: user.branchId },
      async (tx) => {
        // 0. Resolve + validate references now that RLS GUCs are set.
        //    Throw sentinels mapped to 404 by the catch below.
        const [patientRow] = await tx
          .select({ id: patients.id, homeBranchId: patients.homeBranchId })
          .from(patients)
          .where(and(eq(patients.tenantId, tenantId), eq(patients.displayId, body.patientId)))
          .limit(1)
        if (!patientRow) throw new Error('PATIENT_NOT_FOUND')
        if (patientRow.homeBranchId !== null && patientRow.homeBranchId !== user.branchId) {
          throw new LifecycleError(
            'Cross-branch chart reveal is read-only; switch to the patient home branch to write',
            'CROSS_BRANCH_WRITE_FORBIDDEN',
            403,
          )
        }
        // startStandingOrderTx resolves authorizingProviderId → bigint
        // internally; here we only confirm the display_id exists.
        if (body.authorizingProviderId) {
          const [providerRow] = await tx
            .select({ id: users.id })
            .from(users)
            .where(
              and(eq(users.tenantId, tenantId), eq(users.displayId, body.authorizingProviderId)),
            )
            .limit(1)
          if (!providerRow) throw new Error('PROVIDER_NOT_FOUND')
        }

        const templateIds = normalizeTemplateIds(body.templateId, body.templateIds)
        const biteAssessment =
          body.specialty === 'Rabies' &&
          body.specialtyData &&
          typeof body.specialtyData === 'object' &&
          'biteAssessment' in body.specialtyData
            ? (body.specialtyData['biteAssessment'] as Record<string, unknown>)
            : undefined
        // The contract has already proved this is I/II/III for Rabies. Keep
        // the runtime guard so this safety check remains fail-closed if the
        // schema is ever widened.
        const whoCategory = biteAssessment?.['whoCategory']
        if (body.specialty === 'Rabies' && whoCategory === 'III') {
          await assertCategoryIIIRigCoverage(tx, tenantId, templateIds)
        }

        // Validate the complete clinical request before acquiring the
        // patient-scoped admission lock. The lock still precedes every write,
        // but malformed/unsafe protocol requests keep their specific error
        // instead of being masked by an unrelated existing visit.
        await assertNoActiveEncounterTx(tx, tenantId, patientRow.id)

        // 1. Insert encounter with bigint FKs. Generate display_id for the new row.
        //    postgres.js requires JSON.stringify for jsonb columns.
        const encDisplayId = displayId('ENC')

        const [enc] = await tx
          .insert(encounters)
          .values({
            displayId: encDisplayId,
            tenantId,
            branchId: user.branchId!, // bigint (number)
            patientId: patientRow.id, // bigint (number)
            providerId: userBigintId, // bigint (number)
            createdById: userBigintId, // bigint (number)
            specialty: body.specialty,
            status: 'Open' as const,
            // Rabies classification comes from the validated bite assessment,
            // never an independently supplied triage string.
            triageCategory:
              body.specialty === 'Rabies' ? (whoCategory as string) : (body.triageCategory ?? null),
            chiefComplaint: body.chiefComplaint ?? null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            specialtyData: (body.specialtyData ? JSON.stringify(body.specialtyData) : null) as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            clinicalNotes: (body.clinicalNotes ? JSON.stringify(body.clinicalNotes) : null) as any,
          })
          .returning({ id: encounters.id, displayId: encounters.displayId })

        if (!enc) {
          throw new Error('FAILED_TO_CREATE_ENCOUNTER')
        }

        // 1b. Record the explicitly attested walk-in consent against the new
        // encounter. The request contract requires this before we create the
        // active consent row that later clinical writes rely on.
        await tx.insert(consents).values({
          displayId: displayId('CNS'),
          tenantId,
          patientId: patientRow.id,
          encounterId: enc.id,
          consentType: 'informed_consent',
          scope: 'encounter',
          scopeRefType: 'encounter',
          scopeRefId: enc.displayId,
          consenterRelation: body.consentBy,
          consenterName: null,
          visProvided: false,
          obtainedAt: new Date(),
          obtainedById: userBigintId,
          createdById: userBigintId,
        })

        // 2. Start standing order(s) — one PSO per selected template, all
        //    sharing this transaction + RLS context (fail-whole-commit).
        //    Input contract (post-W3.a.4): display_ids for entity references,
        //    bigint for createdById.
        const startDateIso =
          body.startDate ?? clinicCalendarDate(new Date()).toISOString().slice(0, 10)
        const psos = []
        for (const templateId of templateIds) {
          psos.push(
            await startStandingOrderTx(tx, {
              tenantId,
              branchId: user.branchId,
              patientId: body.patientId, // PAT_… display_id
              encounterId: enc.displayId, // ENC_… display_id (just-created)
              templateId,
              authorizingProviderId: body.authorizingProviderId ?? null, // USR_… display_id or null
              startDateIso,
              createdById: userBigintId, // bigint
            }),
          )
        }
        const pso = psos[0]!

        // 3. Rabies-only: create a bite_incidents row + Day-14 followup task
        //    when the WHO exposure category is captured. Other bite-assessment
        //    fields default conservatively; the full payload is preserved in
        //    `metadata` so nothing is lost. Rolls back with the encounter + PSO
        //    if anything later in this transaction throws.
        let biteIncidentId: string | null = null
        if (biteAssessment) {
          const whoCategoryRaw = biteAssessment['whoCategory']
          const exposureCategory =
            typeof whoCategoryRaw === 'string' && EXPOSURE_CATEGORY.has(whoCategoryRaw)
              ? whoCategoryRaw
              : null

          if (exposureCategory) {
            const animalTypeRaw = biteAssessment['animalType']
            const species =
              typeof animalTypeRaw === 'string' && BITE_SPECIES.has(animalTypeRaw)
                ? animalTypeRaw
                : 'Other'

            const arvStatusRaw = biteAssessment['animalArvStatus']
            const animalVaccinationStatus =
              typeof arvStatusRaw === 'string' && ANIMAL_ARV_STATUS.has(arvStatusRaw)
                ? arvStatusRaw
                : 'Unknown'

            const exposureDateRaw = biteAssessment['exposureDate']
            const incidentDate =
              typeof exposureDateRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(exposureDateRaw)
                ? exposureDateRaw
                : new Date().toISOString().slice(0, 10)

            const woundSiteRaw = biteAssessment['woundSite']
            const biteSite =
              typeof woundSiteRaw === 'string' && woundSiteRaw.trim().length > 0
                ? woundSiteRaw.trim().slice(0, 500)
                : 'Not specified'

            const dispositionRaw = biteAssessment['animalDisposition']
            const requiresObservation =
              dispositionRaw === 'UnderObservation' ||
              dispositionRaw === undefined ||
              dispositionRaw === null

            // Resolve the PSO bigint inside the same tx (bite_incidents.patient_standing_order_id is a bigint FK).
            const [psoRow] = await tx
              .select({ id: patientStandingOrders.id })
              .from(patientStandingOrders)
              .where(
                and(
                  eq(patientStandingOrders.tenantId, tenantId),
                  eq(patientStandingOrders.displayId, pso.id),
                ),
              )
              .limit(1)

            const created = await createBiteIncidentInTx(
              tx,
              {
                tenantId,
                userId: userBigintId,
                patientBigId: patientRow.id,
                patientStandingOrderBigId: psoRow?.id ?? null,
              },
              {
                incidentDate,
                species,
                animalVaccinationStatus,
                exposureCategory,
                biteSite,
                requiresObservation,
                // Preserve the full bite assessment for downstream consumers.
                metadata: biteAssessment,
              },
            )
            biteIncidentId = created.id
          }
        }

        // API responses never leak internal bigint (locked decision #10).
        // CreatedStandingOrder.id IS the display_id (string) — no .displayId needed.
        return {
          encounterId: enc.displayId,
          patientStandingOrderId: pso.id,
          patientStandingOrderIds: psos.map((p) => p.id),
          scheduledOrderIds: psos.flatMap((p) => p.clinicalOrders.map((o) => o.id)),
          biteIncidentId,
        }
      },
    )

    res.status(201).json(result satisfies ArrivalsAtomicResponse)
  } catch (err) {
    if (sendLifecycleError(res, err)) return
    const message = err instanceof Error ? err.message : 'Transaction failed'
    if (message === 'PATIENT_NOT_FOUND') {
      res.status(404).json({ error: 'Patient not found', code: 'PATIENT_NOT_FOUND' })
      return
    }
    if (message === 'PROVIDER_NOT_FOUND') {
      res.status(404).json({ error: 'Authorizing provider not found', code: 'PROVIDER_NOT_FOUND' })
      return
    }
    const code =
      message === 'TEMPLATE_NOT_FOUND'
        ? 'TEMPLATE_NOT_FOUND'
        : message === 'TEMPLATE_INACTIVE'
          ? 'TEMPLATE_INACTIVE'
          : message === 'TEMPLATE_HAS_NO_ITEMS'
            ? 'TEMPLATE_HAS_NO_ITEMS'
            : message === 'CAT_III_RIG_REQUIRED'
              ? 'CAT_III_RIG_REQUIRED'
              : message === 'FAILED_TO_CREATE_ENCOUNTER'
                ? 'ENCOUNTER_CREATE_FAILED'
                : 'TRANSACTION_FAILED'
    res.status(400).json({ error: message, code })
  }
})
