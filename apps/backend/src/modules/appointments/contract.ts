/**
 * appointments API contract — schemas + endpoint manifest.
 *
 * Request schemas are the runtime validators used by routes.ts; response
 * schemas describe the ACTUAL res.json payloads and are enforced against the
 * implementation via `satisfies` at each res.json callsite.
 *
 * Side-effect-free imports only (zod + pure shared utils) — the generator
 * imports this file without a configured environment.
 */
import { z } from 'zod'
import { displayIdSchema, prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { defineContract } from '../../contracts/defineContract.js'

// ── Request schemas (runtime validators for routes.ts) ──────────────────────

const APPOINTMENT_TYPES = [
  'Consultation',
  'Vaccination',
  'LabDraw',
  'Procedure',
  'FollowUp',
] as const

const APPOINTMENT_STATUSES = [
  'Scheduled',
  'Confirmed',
  'CheckedIn',
  'InProgress',
  'Completed',
  'Cancelled',
  'NoShow',
] as const

export const aptDisplayIdParam = prefixedDisplayIdSchema('APT')

export const listQuerySchema = z.object({
  patientId: displayIdSchema.optional(),
  providerId: displayIdSchema.optional(),
  branchId: displayIdSchema.optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export const createBody = z
  .object({
    patientId: displayIdSchema,
    branchId: displayIdSchema,
    providerId: displayIdSchema.optional().nullable(),
    locationId: displayIdSchema.optional().nullable(),
    scheduledStartAt: z.string().datetime({ offset: true }),
    scheduledEndAt: z.string().datetime({ offset: true }),
    appointmentType: z.enum(APPOINTMENT_TYPES),
    reason: z.string().max(500).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine((d) => new Date(d.scheduledEndAt) > new Date(d.scheduledStartAt), {
    message: 'End time must be after start time',
    path: ['scheduledEndAt'],
  })

export const patchBody = z
  .object({
    scheduledStartAt: z.string().datetime({ offset: true }).optional(),
    scheduledEndAt: z.string().datetime({ offset: true }).optional(),
    providerId: displayIdSchema.optional().nullable(),
    locationId: displayIdSchema.optional().nullable(),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
    reason: z.string().max(500).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (d) => {
      if (d.scheduledStartAt && d.scheduledEndAt) {
        return new Date(d.scheduledEndAt) > new Date(d.scheduledStartAt)
      }
      return true
    },
    {
      message: 'End time must be after start time',
      path: ['scheduledEndAt'],
    },
  )

export const cancelBody = z.object({
  reason: z.string().min(1).max(500),
})

export const availabilityQuerySchema = z.object({
  providerId: displayIdSchema,
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
})

// ── Response schemas (wire truth — keep in lockstep with db.ts/service.ts) ──

// appointments.status is a plain text column (not a pg enum) — the wire type
// is string. Request schemas still validate against APPOINTMENT_STATUSES.

/**
 * Core serialized appointment row — produced by serializeRow() in db.ts.
 *
 * NOTE: patientId, branchId, providerId, locationId, cancelledById, encounterId,
 * createdById are bigint internal PKs currently crossing the wire raw — a known
 * display-id convention leak, captured as-is because contracts model the ACTUAL
 * shape. Flagged for a separate fix (resolve to display_ids).
 */
const appointmentRowSchema = z.object({
  id: z.string(), // display_id (APT_…)
  bookingRef: z.string().nullable(),
  tenantId: z.string(),
  /** NOTE: bigint PK leak — crosses wire as number. */
  patientId: z.number(),
  /** NOTE: bigint PK leak — crosses wire as number. */
  branchId: z.number(),
  /** NOTE: bigint PK leak — crosses wire as number. */
  providerId: z.number().nullable(),
  /** NOTE: bigint PK leak — crosses wire as number. */
  locationId: z.number().nullable(),
  scheduledStartAt: z.string(),
  scheduledEndAt: z.string(),
  appointmentType: z.string(),
  status: z.string(),
  reason: z.string().nullable(),
  notes: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  /** NOTE: bigint PK leak — crosses wire as number. */
  cancelledById: z.number().nullable(),
  cancellationReason: z.string().nullable(),
  /** NOTE: bigint PK leak — crosses wire as number. */
  encounterId: z.number().nullable(),
  rowVersion: z.number(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** NOTE: bigint PK leak — crosses wire as number. */
  createdById: z.number().nullable(),
})

/**
 * Row shape for list endpoint (listAppointments in db.ts) — extends base
 * row with join fields from patients/providers/branches/locations/encounters.
 *
 * patientFirstName/patientLastName widen to nullable despite patients using
 * INNER JOIN because schema columns allow null.
 */
const listRowSchema = appointmentRowSchema.extend({
  patientFirstName: z.string().nullable(),
  patientLastName: z.string().nullable(),
  patientDisplayId: z.string().nullable(),
  providerName: z.string().nullable(),
  branchName: z.string().nullable(),
  locationName: z.string().nullable(),
  encounterDisplayId: z.string().nullable(),
})

/**
 * Detail row — list row + cancelledByName (resolved in getAppointment).
 */
const detailRowSchema = listRowSchema.extend({
  cancelledByName: z.string().nullable(),
})

const detailEnvelopeSchema = z.object({ data: detailRowSchema })

const availabilitySlotSchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
})

const availabilityResponseSchema = z.object({
  slots: z.array(availabilitySlotSchema),
})

const removeResponseSchema = z.object({ ok: z.literal(true) })

// ── Manifest ─────────────────────────────────────────────────────────────────

export const appointmentsContract = defineContract('appointments', {
  list: {
    method: 'GET',
    path: '/api/appointments',
    query: listQuerySchema,
    response: z.array(listRowSchema),
  },
  availability: {
    method: 'GET',
    path: '/api/appointments/availability',
    query: availabilityQuerySchema,
    response: availabilityResponseSchema,
  },
  detail: {
    method: 'GET',
    path: '/api/appointments/:displayId',
    params: { displayId: aptDisplayIdParam },
    response: detailEnvelopeSchema,
  },
  create: {
    method: 'POST',
    path: '/api/appointments',
    body: createBody,
    response: detailEnvelopeSchema,
  },
  update: {
    method: 'PATCH',
    path: '/api/appointments/:displayId',
    params: { displayId: aptDisplayIdParam },
    body: patchBody,
    response: detailEnvelopeSchema,
  },
  cancel: {
    method: 'POST',
    path: '/api/appointments/:displayId/cancel',
    params: { displayId: aptDisplayIdParam },
    body: cancelBody,
    response: detailEnvelopeSchema,
  },
  remove: {
    method: 'DELETE',
    path: '/api/appointments/:displayId',
    params: { displayId: aptDisplayIdParam },
    response: removeResponseSchema,
  },
})

// ── Inferred response types (used by routes.ts `satisfies` assertions) ───────

export type AppointmentsListResponse = z.infer<typeof listRowSchema>[]
export type AppointmentsAvailabilityResponse = z.infer<typeof availabilityResponseSchema>
export type AppointmentsDetailResponse = z.infer<typeof detailEnvelopeSchema>
export type AppointmentsCreateResponse = z.infer<typeof detailEnvelopeSchema>
export type AppointmentsUpdateResponse = z.infer<typeof detailEnvelopeSchema>
export type AppointmentsCancelResponse = z.infer<typeof detailEnvelopeSchema>
export type AppointmentsRemoveResponse = z.infer<typeof removeResponseSchema>
