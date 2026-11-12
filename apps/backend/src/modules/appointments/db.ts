import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import {
  appointments,
  patients,
  users,
  branches,
  locations,
  encounters,
} from '../../shared/db/schema.js'
import { displayId } from '../../shared/utils/displayId.js'

// ── Input types (FK fields are display_id strings from callers; resolved to
// bigint internally before DB ops) ──────────────────────────────────────────

export type CreateAppointmentInput = {
  patientId: string // display_id resolved → bigint
  branchId: string // display_id resolved → bigint
  providerId?: string | null // display_id resolved → bigint
  locationId?: string | null // display_id resolved → bigint
  scheduledStartAt: string
  scheduledEndAt: string
  appointmentType: string
  reason?: string | null
  notes?: string | null
  createdById: number // already bigint (from req.user.id)
}

export type UpdateAppointmentInput = {
  scheduledStartAt?: string
  scheduledEndAt?: string
  providerId?: string | null // display_id
  locationId?: string | null // display_id
  status?: string
  reason?: string | null
  notes?: string | null
}

export type ListAppointmentsOptions = {
  patientId?: string // display_id
  providerId?: string // display_id
  branchId?: string // display_id
  status?: string
  from?: Date
  to?: Date
  limit?: number
}

// ── Serializer ───────────────────────────────────────────────────────────────

function serializeRow(row: {
  id: number
  displayId: string
  bookingRef: string | null
  tenantId: string
  patientId: number
  branchId: number
  providerId: number | null
  locationId: number | null
  scheduledStartAt: Date
  scheduledEndAt: Date
  appointmentType: string
  status: string
  reason: string | null
  notes: string | null
  cancelledAt: Date | null
  cancelledById: number | null
  cancellationReason: string | null
  encounterId: number | null
  rowVersion: number
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
  createdById: number | null
}) {
  return {
    // Public handle — never leak internal bigint
    id: row.displayId,
    bookingRef: row.bookingRef ?? null,
    tenantId: row.tenantId,
    // FK bigints are opaque to API consumers; we surface them as-is for now.
    // When related modules are converted, these will map to their display_ids.
    patientId: row.patientId,
    branchId: row.branchId,
    providerId: row.providerId ?? null,
    locationId: row.locationId ?? null,
    scheduledStartAt: row.scheduledStartAt.toISOString(),
    scheduledEndAt: row.scheduledEndAt.toISOString(),
    appointmentType: row.appointmentType,
    status: row.status,
    reason: row.reason ?? null,
    notes: row.notes ?? null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelledById: row.cancelledById ?? null,
    cancellationReason: row.cancellationReason ?? null,
    encounterId: row.encounterId ?? null,
    rowVersion: row.rowVersion,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdById: row.createdById ?? null,
  }
}

// ── FK resolution helpers ────────────────────────────────────────────────────

async function resolvePatientBigint(
  tx: Parameters<Parameters<typeof withTenantTx>[1]>[0],
  tenantId: string,
  patientDisplayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.tenantId, tenantId), eq(patients.displayId, patientDisplayId)))
    .limit(1)
  return row?.id ?? null
}

async function resolveBranchBigint(
  tx: Parameters<Parameters<typeof withTenantTx>[1]>[0],
  tenantId: string,
  branchDisplayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.displayId, branchDisplayId)))
    .limit(1)
  return row?.id ?? null
}

async function resolveUserBigint(
  tx: Parameters<Parameters<typeof withTenantTx>[1]>[0],
  tenantId: string,
  userDisplayId: string,
): Promise<number | null> {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.displayId, userDisplayId)))
    .limit(1)
  return row?.id ?? null
}

// Alias for provider (user) join
const providerUsers = users

// ── List ─────────────────────────────────────────────────────────────────────

export async function listAppointments(tenantId: string, opts: ListAppointmentsOptions) {
  const limit = Math.min(opts.limit ?? 100, 500)
  const now = new Date()
  const fromDate = opts.from ?? now
  const toDate = opts.to ?? new Date(fromDate.getTime() + 30 * 24 * 60 * 60 * 1000)

  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    // Resolve optional filter display_ids → bigint
    let patientBigint: number | undefined
    let providerBigint: number | undefined
    let branchBigint: number | undefined

    if (opts.patientId) {
      const resolved = await resolvePatientBigint(tx, tenantId, opts.patientId)
      if (resolved === null) return [] // unknown patient → empty result
      patientBigint = resolved
    }
    if (opts.providerId) {
      const resolved = await resolveUserBigint(tx, tenantId, opts.providerId)
      if (resolved === null) return []
      providerBigint = resolved
    }
    if (opts.branchId) {
      const resolved = await resolveBranchBigint(tx, tenantId, opts.branchId)
      if (resolved === null) return []
      branchBigint = resolved
    }

    const conditions = [eq(appointments.tenantId, tenantId), isNull(appointments.deletedAt)]
    conditions.push(gte(appointments.scheduledStartAt, fromDate))
    conditions.push(lte(appointments.scheduledStartAt, toDate))
    if (patientBigint !== undefined) conditions.push(eq(appointments.patientId, patientBigint))
    if (providerBigint !== undefined) conditions.push(eq(appointments.providerId, providerBigint))
    if (branchBigint !== undefined) conditions.push(eq(appointments.branchId, branchBigint))
    if (opts.status) conditions.push(eq(appointments.status, opts.status))

    const rows = await tx
      .select({
        id: appointments.id,
        displayId: appointments.displayId,
        bookingRef: appointments.bookingRef,
        tenantId: appointments.tenantId,
        patientId: appointments.patientId,
        branchId: appointments.branchId,
        providerId: appointments.providerId,
        locationId: appointments.locationId,
        scheduledStartAt: appointments.scheduledStartAt,
        scheduledEndAt: appointments.scheduledEndAt,
        appointmentType: appointments.appointmentType,
        status: appointments.status,
        reason: appointments.reason,
        notes: appointments.notes,
        cancelledAt: appointments.cancelledAt,
        cancelledById: appointments.cancelledById,
        cancellationReason: appointments.cancellationReason,
        encounterId: appointments.encounterId,
        rowVersion: appointments.rowVersion,
        deletedAt: appointments.deletedAt,
        createdAt: appointments.createdAt,
        updatedAt: appointments.updatedAt,
        createdById: appointments.createdById,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        patientDisplayId: patients.displayId,
        providerFirstName: providerUsers.firstName,
        providerLastName: providerUsers.lastName,
        branchName: branches.name,
        locationName: locations.name,
        encounterDisplayId: encounters.displayId,
      })
      .from(appointments)
      .innerJoin(patients, eq(appointments.patientId, patients.id))
      .leftJoin(providerUsers, eq(appointments.providerId, providerUsers.id))
      .innerJoin(branches, eq(appointments.branchId, branches.id))
      .leftJoin(locations, eq(appointments.locationId, locations.id))
      .leftJoin(encounters, eq(appointments.encounterId, encounters.id))
      .where(and(...conditions))
      .orderBy(asc(appointments.scheduledStartAt))
      .limit(limit)

    return rows.map((r) => ({
      ...serializeRow(r),
      patientFirstName: r.patientFirstName,
      patientLastName: r.patientLastName,
      patientDisplayId: r.patientDisplayId,
      providerName:
        r.providerFirstName && r.providerLastName
          ? `${r.providerLastName}, ${r.providerFirstName}`
          : null,
      branchName: r.branchName,
      locationName: r.locationName ?? null,
      encounterDisplayId: r.encounterDisplayId ?? null,
    }))
  })
}

// ── Get by display_id ─────────────────────────────────────────────────────────

export async function getAppointment(tenantId: string, aptDisplayId: string) {
  return withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({
        id: appointments.id,
        displayId: appointments.displayId,
        bookingRef: appointments.bookingRef,
        tenantId: appointments.tenantId,
        patientId: appointments.patientId,
        branchId: appointments.branchId,
        providerId: appointments.providerId,
        locationId: appointments.locationId,
        scheduledStartAt: appointments.scheduledStartAt,
        scheduledEndAt: appointments.scheduledEndAt,
        appointmentType: appointments.appointmentType,
        status: appointments.status,
        reason: appointments.reason,
        notes: appointments.notes,
        cancelledAt: appointments.cancelledAt,
        cancelledById: appointments.cancelledById,
        cancellationReason: appointments.cancellationReason,
        encounterId: appointments.encounterId,
        rowVersion: appointments.rowVersion,
        deletedAt: appointments.deletedAt,
        createdAt: appointments.createdAt,
        updatedAt: appointments.updatedAt,
        createdById: appointments.createdById,
        patientFirstName: patients.firstName,
        patientLastName: patients.lastName,
        patientDisplayId: patients.displayId,
        providerFirstName: providerUsers.firstName,
        providerLastName: providerUsers.lastName,
        branchName: branches.name,
        locationName: locations.name,
        encounterDisplayId: encounters.displayId,
      })
      .from(appointments)
      .innerJoin(patients, eq(appointments.patientId, patients.id))
      .leftJoin(providerUsers, eq(appointments.providerId, providerUsers.id))
      .innerJoin(branches, eq(appointments.branchId, branches.id))
      .leftJoin(locations, eq(appointments.locationId, locations.id))
      .leftJoin(encounters, eq(appointments.encounterId, encounters.id))
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          eq(appointments.displayId, aptDisplayId),
          isNull(appointments.deletedAt),
        ),
      )
      .limit(1)

    if (!row) return null

    // Fetch cancelledBy user name if cancelled
    let cancelledByName: string | null = null
    if (row.cancelledById) {
      const [cancelledByUser] = await tx
        .select({ firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(eq(users.id, row.cancelledById))
        .limit(1)
      if (cancelledByUser) {
        cancelledByName = `${cancelledByUser.lastName}, ${cancelledByUser.firstName}`
      }
    }

    return {
      ...serializeRow(row),
      patientFirstName: row.patientFirstName,
      patientLastName: row.patientLastName,
      patientDisplayId: row.patientDisplayId,
      providerName:
        row.providerFirstName && row.providerLastName
          ? `${row.providerLastName}, ${row.providerFirstName}`
          : null,
      branchName: row.branchName,
      locationName: row.locationName ?? null,
      encounterDisplayId: row.encounterDisplayId ?? null,
      cancelledByName,
    }
  })
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createAppointment(
  tenantId: string,
  userId: number,
  branchId: number | null,
  input: CreateAppointmentInput,
) {
  const aptDisplayId = displayId('APT')
  const now = new Date()

  let createdDisplayId = aptDisplayId

  await withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    // Resolve display_id FKs → bigint
    const patientBigint = await resolvePatientBigint(tx, tenantId, input.patientId)
    if (patientBigint === null)
      throw Object.assign(new Error('Patient not found'), { code: 'PATIENT_NOT_FOUND' })

    const branchBigint = await resolveBranchBigint(tx, tenantId, input.branchId)
    if (branchBigint === null)
      throw Object.assign(new Error('Branch not found'), { code: 'BRANCH_NOT_FOUND' })

    let providerBigint: number | null = null
    if (input.providerId) {
      providerBigint = await resolveUserBigint(tx, tenantId, input.providerId)
      if (providerBigint === null)
        throw Object.assign(new Error('Provider not found'), { code: 'PROVIDER_NOT_FOUND' })
    }

    // locationId: no location table yet — store as-is (bigint 0 or null).
    // When the locations module is converted, resolve via display_id here.
    const locationBigint: number | null = null // input.locationId not yet resolvable

    // Retry on display_id collision (≈ never, but required by gotchas)
    let attempts = 0
    while (attempts < 3) {
      try {
        const currentDisplayId = attempts === 0 ? aptDisplayId : displayId('APT')
        createdDisplayId = currentDisplayId
        await tx.insert(appointments).values({
          displayId: currentDisplayId,
          tenantId,
          patientId: patientBigint,
          branchId: branchBigint,
          providerId: providerBigint,
          locationId: locationBigint,
          scheduledStartAt: new Date(input.scheduledStartAt),
          scheduledEndAt: new Date(input.scheduledEndAt),
          appointmentType: input.appointmentType,
          status: 'Scheduled',
          reason: input.reason ?? null,
          notes: input.notes ?? null,
          rowVersion: 0,
          createdAt: now,
          updatedAt: now,
          createdById: input.createdById,
        })
        break
      } catch (err) {
        if (
          err &&
          typeof err === 'object' &&
          (err as Record<string, unknown>)['code'] === '23505' &&
          String((err as Record<string, unknown>)['constraint'] ?? '').includes('display_id')
        ) {
          attempts++
          if (attempts >= 3) throw err
          continue
        }
        throw err
      }
    }
  })

  return getAppointment(tenantId, createdDisplayId)
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateAppointment(
  tenantId: string,
  userId: number,
  branchId: number | null,
  aptDisplayId: string,
  input: UpdateAppointmentInput,
) {
  const now = new Date()

  const result = await withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [existing] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          eq(appointments.displayId, aptDisplayId),
          isNull(appointments.deletedAt),
        ),
      )
      .limit(1)

    if (!existing) return null

    const updates: Record<string, unknown> = {
      updatedAt: now,
      rowVersion: sql`${appointments.rowVersion} + 1`,
    }

    if (input.scheduledStartAt !== undefined)
      updates.scheduledStartAt = new Date(input.scheduledStartAt)
    if (input.scheduledEndAt !== undefined) updates.scheduledEndAt = new Date(input.scheduledEndAt)
    if (input.status !== undefined) updates.status = input.status
    if ('reason' in input) updates.reason = input.reason ?? null
    if ('notes' in input) updates.notes = input.notes ?? null

    // Resolve optional FK display_ids
    if ('providerId' in input) {
      if (input.providerId == null) {
        updates.providerId = null
      } else {
        const providerBigint = await resolveUserBigint(tx, tenantId, input.providerId)
        if (providerBigint === null)
          throw Object.assign(new Error('Provider not found'), { code: 'PROVIDER_NOT_FOUND' })
        updates.providerId = providerBigint
      }
    }

    // locationId: when locations module is converted, resolve here
    if ('locationId' in input) {
      updates.locationId = null // placeholder until locations are converted
    }

    await tx
      .update(appointments)
      .set(updates)
      .where(and(eq(appointments.tenantId, tenantId), eq(appointments.displayId, aptDisplayId)))

    return { updated: true }
  })

  if (!result) return null
  return getAppointment(tenantId, aptDisplayId)
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelAppointment(
  tenantId: string,
  userId: number,
  branchId: number | null,
  aptDisplayId: string,
  reason: string,
) {
  const now = new Date()

  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [existing] = await tx
      .select({ id: appointments.id, status: appointments.status })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          eq(appointments.displayId, aptDisplayId),
          isNull(appointments.deletedAt),
        ),
      )
      .limit(1)

    if (!existing) return { found: false, invalidState: false }
    if (existing.status === 'Cancelled' || existing.status === 'Completed') {
      return { found: true, invalidState: true, status: existing.status }
    }

    await tx
      .update(appointments)
      .set({
        status: 'Cancelled',
        cancelledAt: now,
        cancelledById: userId,
        cancellationReason: reason,
        updatedAt: now,
        rowVersion: sql`${appointments.rowVersion} + 1`,
      })
      .where(and(eq(appointments.tenantId, tenantId), eq(appointments.displayId, aptDisplayId)))

    return { found: true, invalidState: false }
  })
}

// ── Soft delete ───────────────────────────────────────────────────────────────

export async function softDeleteAppointment(
  tenantId: string,
  userId: number,
  branchId: number | null,
  aptDisplayId: string,
) {
  return withTenantTx({ tenantId, userId, branchId }, async (tx) => {
    const [existing] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          eq(appointments.displayId, aptDisplayId),
          isNull(appointments.deletedAt),
        ),
      )
      .limit(1)

    if (!existing) return null

    await tx
      .update(appointments)
      .set({ deletedAt: new Date() })
      .where(and(eq(appointments.tenantId, tenantId), eq(appointments.displayId, aptDisplayId)))

    return { ok: true }
  })
}

// ── Availability ──────────────────────────────────────────────────────────────

export type AvailabilityOptions = {
  providerDisplayId: string // display_id of the provider user
  from: Date
  to: Date
  durationMinutes: number
}

export async function getAvailability(tenantId: string, opts: AvailabilityOptions) {
  const { providerDisplayId, from, to, durationMinutes } = opts
  const slotMs = durationMinutes * 60 * 1000

  // Resolve provider display_id → bigint
  const providerBigint = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) =>
    resolveUserBigint(tx, tenantId, providerDisplayId),
  )

  if (providerBigint === null) return []

  // Pull existing booked ranges for this provider in the window
  const bookedRows = await withTenantTx({ tenantId, userId: 0, branchId: null }, async (tx) => {
    return tx
      .select({
        scheduledStartAt: appointments.scheduledStartAt,
        scheduledEndAt: appointments.scheduledEndAt,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenantId),
          eq(appointments.providerId, providerBigint),
          isNull(appointments.deletedAt),
          // overlap: starts before `to` AND ends after `from`
          lte(appointments.scheduledStartAt, to),
          gte(appointments.scheduledEndAt, from),
        ),
      )
  })

  const bookedRanges = bookedRows.map((r) => ({
    start: r.scheduledStartAt.getTime(),
    end: r.scheduledEndAt.getTime(),
  }))

  // Emit slots that don't overlap any booked range
  const slots: Array<{ startAt: string; endAt: string }> = []
  let cursor = from.getTime()
  const toMs = to.getTime()

  while (cursor + slotMs <= toMs && slots.length < 50) {
    const slotEnd = cursor + slotMs
    const overlaps = bookedRanges.some((b) => cursor < b.end && slotEnd > b.start)
    if (!overlaps) {
      slots.push({
        startAt: new Date(cursor).toISOString(),
        endAt: new Date(slotEnd).toISOString(),
      })
    }
    cursor += slotMs
  }

  return slots
}
