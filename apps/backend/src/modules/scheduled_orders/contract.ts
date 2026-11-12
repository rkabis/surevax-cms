/**
 * scheduled-orders API contract — schemas + endpoint manifest.
 *
 * Pilot/canonical module for contract codegen (docs/specs/api-contract-codegen.md).
 * Request schemas are the runtime validators used by routes.ts; response
 * schemas describe the ACTUAL res.json payloads and are enforced against the
 * implementation via `satisfies` at each res.json callsite.
 *
 * Side-effect-free imports only (zod + pure shared utils) — the generator
 * imports this file without a configured environment.
 */
import { z } from 'zod'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { defineContract } from '../../contracts/defineContract.js'
import { DEFAULT_OBSERVATION_MINUTES } from './observation.js'

// ── Request schemas (runtime validators for routes.ts) ──────────────────────

/** Clinical order display_ids (ORD_…) on every :id route param. */
export const orderIdSchema = prefixedDisplayIdSchema('ORD')

export const administeredOnDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Administered date must be in YYYY-MM-DD format')

export const administerBody = z.object({
  consentBy: z.enum(['Patient', 'Guardian']),
  consentObtained: z.literal(true),
  visVersion: z.string().min(1),
  visProvided: z.boolean().optional(),
  /**
   * Internal representative lot for the explicitly selected brand. The current
   * administration UI groups eligible lots into brands and supplies this ID;
   * lot-to-patient verification remains a later workflow.
   */
  lotId: prefixedDisplayIdSchema('LOT'),
  /**
   * Set when the picked brand costs more than what was already billed for this
   * dose. The administration proceeds either way (a clinical decision is not
   * blocked on money) — this records that the operator saw the difference.
   */
  brandPriceVarianceAcknowledged: z.boolean().optional(),
  /**
   * The clinician who physically gave the dose, recorded as
   * `clinical_orders.administered_by_id`. Omit to attribute the dose to the
   * caller, which is only allowed when the caller is a real clinician logged in
   * as themselves. On the shared `Branch` kiosk this is REQUIRED, together with
   * `attestationPin`: see `shared/utils/clinicianAttestation.ts`.
   */
  administeredById: prefixedDisplayIdSchema('USR').optional(),
  /** The named clinician's 4-digit kiosk PIN: the same PIN clock-in uses. */
  attestationPin: z
    .string()
    .regex(/^\d{4}$/, 'PIN must be 4 digits')
    .optional(),
  /** Captured on the observation record; 15 minutes is the interim clinic default. */
  observationMinutes: z.number().int().min(1).max(240).default(DEFAULT_OBSERVATION_MINUTES),
})

const attestationFields = {
  /** `USR_…` of the clinician recording the observation action. */
  attestedById: prefixedDisplayIdSchema('USR').optional(),
  /** Named clinician's 4-digit kiosk PIN; omitted for self-attestation. */
  attestationPin: z
    .string()
    .regex(/^\d{4}$/, 'PIN must be 4 digits')
    .optional(),
}

export const observationActionBody = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('record_outcome'),
    outcome: z.enum(['NoReaction', 'Reaction', 'Escalated']),
    notes: z.string().trim().max(2000).optional(),
    ...attestationFields,
  }),
  z.object({
    action: z.literal('acknowledge_discharge'),
    ...attestationFields,
  }),
])

export const rescheduleBody = z.object({
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'New date must be in YYYY-MM-DD format'),
  reason: z.string().min(5, 'Reason must be at least 5 characters').max(2000),
})

export const scheduledOrdersFilterSchema = z.enum([
  'all',
  'today',
  'upcoming',
  'missed',
  'overdue',
  'backfill',
  'completed_today',
])

const listQuerySchema = z.object({
  q: z.string().optional(),
  /** Patient display_id (PAT_…) — scopes the list to one patient's orders. */
  patientId: z.string().optional(),
  /** Unknown values fall back to 'all' server-side. */
  filter: scheduledOrdersFilterSchema.optional(),
})

// ── Response schemas (wire truth — keep in lockstep with db.ts/service.ts) ──

const clinicalOrderStatusSchema = z.enum([
  'Scheduled',
  'Pending',
  'Completed',
  'Missed',
  'Cancelled',
])

const dosePaymentStatusSchema = z.enum(['Draft', 'Pending', 'Paid', 'Voided', 'Refunded'])

const observationStateSchema = z.enum([
  'Observing',
  'ReadyForDischarge',
  'Reaction',
  'Escalated',
  'Discharged',
])

const observationSummarySchema = z.object({
  id: z.string(),
  durationMinutes: z.number(),
  observeUntil: z.string(),
  outcome: z.enum(['NoReaction', 'Reaction', 'Escalated']).nullable(),
  outcomeNotes: z.string().nullable(),
  outcomeRecordedAt: z.string().nullable(),
  outcomeRecordedBy: z.object({ displayId: z.string(), fullName: z.string() }).nullable(),
  dischargedAt: z.string().nullable(),
  dischargedBy: z.object({ displayId: z.string(), fullName: z.string() }).nullable(),
  state: observationStateSchema,
})

const scheduledOrderRowSchema = z.object({
  id: z.string(),
  patientName: z.string(),
  patientMrn: z.string().nullable(),
  patientDateOfBirth: z.string().nullable(),
  contactNumber: z.string().nullable(),
  service: z.string(),
  doseNumber: z.number(),
  totalDoses: z.number(),
  scheduledDate: z.string().nullable(),
  status: clinicalOrderStatusSchema,
  standingOrderName: z.string(),
  indication: z.string().nullable(),
  paymentStatus: dosePaymentStatusSchema.nullable(),
  /** True when an earlier dose in the same course is Missed or past-due. */
  hasBlockingOverdue: z.boolean(),
  /** Canonical mutually-exclusive state, computed using the Manila clinic day. */
  priorityState: z.enum([
    'due',
    'overdue',
    'upcoming',
    'completed',
    'missed',
    'cancelled',
    'unscheduled',
  ]),
  /**
   * Messaging-consent flag (`patients.sms_opt_in`), distinct from the
   * clinical `consents` table. Lets the worklist show the "Text patient"
   * action as disabled, with a reason, without a round trip to
   * `/text-draft` for every row.
   */
  smsOptIn: z.boolean(),
  /**
   * Today-ready post-dose lane. A null dischargedAt remains authoritative;
   * reaching observeUntil alone never means the patient was discharged.
   */
  observation: observationSummarySchema.nullable(),
})

const scheduledOrdersStatsSchema = z.object({
  todayCount: z.number(),
  missedCount: z.number(),
  completedToday: z.number(),
  overdueCount: z.number(),
  backfillCount: z.number(),
  /** Tomorrow and the following clinic day. */
  upcomingCount: z.number(),
  activeCoursesCount: z.number(),
  recomputeNeededCount: z.number(),
  /** 7-day administered-count series, oldest → newest, today inclusive. */
  administered7d: z.array(z.number()),
})

const listResponseSchema = z.object({
  data: z.array(scheduledOrderRowSchema),
  stats: scheduledOrdersStatsSchema,
})

const administeredRowSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  patientName: z.string(),
  serviceName: z.string(),
  lotNumber: z.string().nullable(),
  administeredAt: z.string(),
  administeredByName: z.string().nullable(),
  encounterId: z.string().nullable(),
})

const detailResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  patientStandingOrderId: z.string().nullable(),
  serviceId: z.string().nullable(),
  encounterId: z.string().nullable(),
  orderType: z.string(),
  status: clinicalOrderStatusSchema,
  originalScheduledDate: z.string().nullable(),
  currentScheduledDate: z.string().nullable(),
  completedAt: z.string().nullable(),
  observation: observationSummarySchema.nullable(),
  /** Resolved to the user's USR_… display_id (null when unset). */
  documentedById: z.string().nullable(),
  /** Resolved to the user's USR_… display_id (null when unset). */
  administeredById: z.string().nullable(),
  /** numeric(8,2) — crosses the wire as a string. */
  quantity: z.string(),
  doseNumber: z.number().nullable(),
  administrationRoute: z.string().nullable(),
  administrationSite: z.string().nullable(),
  indication: z.string().nullable(),
  /** JSONB — shape not modeled. */
  notes: z.unknown(),
  deletedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  /** Resolved to the user's USR_… display_id (null when unset). */
  createdById: z.string().nullable(),
  paymentStatus: dosePaymentStatusSchema.nullable(),
  service: z
    .object({
      id: z.string().nullable(),
      name: z.string(),
      requiresDoseCalculation: z.boolean(),
    })
    .nullable(),
  patient: z
    .object({
      id: z.string(),
      // patients is LEFT-joined via the standing order — name columns widen to
      // null even though the patients table declares them NOT NULL.
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      dateOfBirth: z.string().nullable(),
      mrn: z.string().nullable(),
      /** Concise active clinical flags for the administration checkpoint. */
      allergies: z.array(z.string()),
      activeConditions: z.array(z.string()),
    })
    .nullable(),
  standingOrder: z
    .object({
      id: z.string(),
      status: z.string().nullable(),
      template: z.object({ name: z.string() }).nullable(),
    })
    .nullable(),
  consent: z
    .object({
      id: z.string(),
      visProvided: z.boolean().nullable(),
      visDate: z.string().nullable(),
      visVersion: z.string().nullable(),
      consentObtained: z.boolean(),
      consentBy: z.string().nullable(),
      consentTimestamp: z.string().nullable(),
      notes: z.string().nullable(),
    })
    .nullable(),
})

const timelineEntrySchema = z.object({
  id: z.string(),
  day: z.number(),
  scheduledAt: z.string(),
  administeredAt: z.string().nullable(),
  state: z.enum(['completed', 'overdue', 'due', 'upcoming', 'cancelled']),
  byClinician: z.string().nullable(),
  lotNumber: z.string().nullable(),
  doseSize: z.string(),
  note: z.string().optional(),
})

/**
 * The payer whose contracted rate should price the doses. Omitted = cash/retail.
 * A query param rather than a body field because the picker re-prices live as
 * the nurse changes the payer, before any transaction exists.
 */
export const dosesQuerySchema = z.object({
  payerId: prefixedDisplayIdSchema('PYR').optional(),
})

const prepayableDoseSchema = z.object({
  /** clinical_order display_id (ORD_…). */
  orderId: z.string(),
  doseNumber: z.number(),
  /** service_catalog code (e.g. ARVPEP_IM). */
  serviceId: z.string(),
  serviceName: z.string(),
  /** YYYY-MM-DD. */
  scheduledAt: z.string(),
  state: z.enum(['upcoming', 'due', 'overdue', 'completed', 'cancelled']),
  /** null when the dose has not been billed yet. */
  paymentStatus: z.enum(['Draft', 'Pending', 'Paid']).nullable(),
  /**
   * What this dose will actually bill at, resolved server-side through
   * `resolveServicePrice` for the requested payer (and, for a dose already
   * administered, the brand that went in). The picker used to estimate from
   * `service_catalog` base price, which silently ignored every payer contract ,
   * an HMO patient's ARV PEP IM dose reads ₱2,200, not the ₱1,500 cash rate.
   */
  unitPrice: z.string(),
})

/**
 * Downstream date-shift projection. The internal bigint PK used by the recompute
 * UPDATE is stripped server-side (toDownstreamWire) and never crosses the wire.
 */
const downstreamProjectionSchema = z.object({
  id: z.string(),
  day: z.number(),
  fromDate: z.string(),
  toDate: z.string(),
  deltaDays: z.number(),
})

const recomputePreviewResponseSchema = z.object({
  current: z.object({ id: z.string(), currentScheduledDate: z.string().nullable() }),
  downstream: z.array(downstreamProjectionSchema),
})

const recomputeResponseSchema = z.object({
  updated: z.number(),
  downstream: z.array(downstreamProjectionSchema),
})

/**
 * One selectable brand/lot for a dose. Ordered house-brand-first, then
 * earliest-expiring within the brand, so the default pick is both the clinic's
 * preferred product and the one closest to expiry.
 */
const eligibleLotSchema = z.object({
  /** inventory_lots.display_id (LOT_…) — what administer expects back. */
  id: z.string(),
  batchNumber: z.string(),
  /** 'YYYY-MM-DD'. */
  expiryDate: z.string(),
  /** numeric → string. */
  quantityOnHand: z.string(),
  product: z.object({
    id: z.string(),
    name: z.string(),
    manufacturer: z.string().nullable(),
  }),
  /** True for the clinic's default brand for this service (ranking 0 / is_default). */
  isHouseBrand: z.boolean(),
  /** Brand-resolved unit price for this dose's payer/branch context. */
  unitPrice: z.string(),
  /** True when an active recall covers this lot — surfaced BEFORE administering. */
  isRecalled: z.boolean(),
})

const eligibleLotsResponseSchema = z.object({
  data: z.array(eligibleLotSchema),
  /**
   * Unit price already snapshotted on this dose's transaction line, when the
   * dose was billed before administration. Null when nothing is billed yet —
   * then no brand can create a variance.
   */
  billedUnitPrice: z.string().nullable(),
})

const administerResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  completedAt: z.string(),
  patientId: z.string().nullable(),
  serviceId: z.string(),
  lot: z.object({ lotId: z.string(), batchNumber: z.string(), expiryDate: z.string() }),
  /**
   * The clinician the dose was recorded under: echoed back so the nurse can
   * confirm the attribution landed on the right person before closing the
   * panel. `null` only for a legacy row with no resolvable user.
   */
  administeredBy: z
    .object({
      displayId: z.string(),
      fullName: z.string(),
      licenseNumber: z.string().nullable(),
    })
    .nullable(),
  downstream: z.array(downstreamProjectionSchema),
  observation: observationSummarySchema,
})

const observationActionResponseSchema = observationSummarySchema

const rescheduleResponseSchema = z.object({
  id: z.string(),
  currentScheduledDate: z.string(),
})

/**
 * Manual "text patient" draft, R2 (docs/nurse-testing-readiness.md). Nothing
 * here is sent by our infrastructure: the nurse scans `qrDataUrl` with their
 * own phone, which opens Messages prefilled from `smsUri`, and presses send
 * themselves. No automated reminder pipeline, no provider, no queue.
 */
export const textDraftBlockedReasonSchema = z.enum(['no_contact_number', 'sms_opt_in_false'])

const textDraftResponseSchema = z.object({
  blocked: z.boolean(),
  blockedReason: textDraftBlockedReasonSchema.nullable(),
  /** Last-few-digits masked recipient, safe to render. Null only when blocked by no_contact_number. */
  maskedNumber: z.string().nullable(),
  /** `sms:<number>?body=<url-encoded body>`, null when blocked. */
  smsUri: z.string().nullable(),
  /** Plain-text message body the nurse is about to send, null when blocked. */
  messageBody: z.string().nullable(),
  /** data:image/png;base64,... QR rendering of smsUri, null when blocked. */
  qrDataUrl: z.string().nullable(),
})

// ── Manifest ─────────────────────────────────────────────────────────────────

export const scheduledOrdersContract = defineContract('scheduled-orders', {
  list: {
    method: 'GET',
    path: '/api/scheduled-orders',
    query: listQuerySchema,
    response: listResponseSchema,
  },
  administered: {
    method: 'GET',
    path: '/api/scheduled-orders/administered',
    query: z.object({ date: administeredOnDateSchema.optional() }),
    response: z.array(administeredRowSchema),
  },
  detail: {
    method: 'GET',
    path: '/api/scheduled-orders/:id',
    params: { id: orderIdSchema },
    response: detailResponseSchema,
  },
  timeline: {
    method: 'GET',
    path: '/api/scheduled-orders/:id/timeline',
    params: { id: orderIdSchema },
    response: z.array(timelineEntrySchema),
  },
  doses: {
    method: 'GET',
    path: '/api/scheduled-orders/:id/doses',
    params: { id: orderIdSchema },
    query: dosesQuerySchema,
    response: z.array(prepayableDoseSchema),
  },
  eligibleLots: {
    method: 'GET',
    path: '/api/scheduled-orders/:id/eligible-lots',
    params: { id: orderIdSchema },
    response: eligibleLotsResponseSchema,
  },
  recomputePreview: {
    method: 'GET',
    path: '/api/scheduled-orders/:id/recompute-preview',
    params: { id: orderIdSchema },
    response: recomputePreviewResponseSchema,
  },
  recompute: {
    method: 'POST',
    path: '/api/scheduled-orders/:id/recompute',
    params: { id: orderIdSchema },
    response: recomputeResponseSchema,
  },
  administer: {
    method: 'POST',
    path: '/api/scheduled-orders/:id/administer',
    params: { id: orderIdSchema },
    body: administerBody,
    response: administerResponseSchema,
  },
  observationAction: {
    method: 'POST',
    path: '/api/scheduled-orders/:id/observation',
    params: { id: orderIdSchema },
    body: observationActionBody,
    response: observationActionResponseSchema,
  },
  reschedule: {
    method: 'POST',
    path: '/api/scheduled-orders/:id/reschedule',
    params: { id: orderIdSchema },
    body: rescheduleBody,
    response: rescheduleResponseSchema,
  },
  textDraft: {
    method: 'GET',
    path: '/api/scheduled-orders/:id/text-draft',
    params: { id: orderIdSchema },
    response: textDraftResponseSchema,
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ───────

export type ScheduledOrdersListResponse = z.infer<typeof listResponseSchema>
export type ScheduledOrdersAdministeredResponse = z.infer<typeof administeredRowSchema>[]
export type ScheduledOrdersDetailResponse = z.infer<typeof detailResponseSchema>
export type ScheduledOrdersTimelineResponse = z.infer<typeof timelineEntrySchema>[]
export type ScheduledOrdersDosesResponse = z.infer<typeof prepayableDoseSchema>[]
export type ScheduledOrdersEligibleLotsResponse = z.infer<typeof eligibleLotsResponseSchema>
export type ScheduledOrdersRecomputePreviewResponse = z.infer<typeof recomputePreviewResponseSchema>
export type ScheduledOrdersRecomputeResponse = z.infer<typeof recomputeResponseSchema>
export type ScheduledOrdersAdministerResponse = z.infer<typeof administerResponseSchema>
export type ScheduledOrdersObservationActionResponse = z.infer<
  typeof observationActionResponseSchema
>
export type ScheduledOrdersRescheduleResponse = z.infer<typeof rescheduleResponseSchema>
export type ScheduledOrdersTextDraftResponse = z.infer<typeof textDraftResponseSchema>
