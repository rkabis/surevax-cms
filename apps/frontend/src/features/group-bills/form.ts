export type GroupBillLineDraft = {
  id: string
  serviceId: string
  quantity: number
}

export type GroupBillPatientDraft = {
  id: string
  patientId: string | null
  items: GroupBillLineDraft[]
}

export type GroupBillDraft = {
  payerId: string | null
  referenceNumber: string
  patients: GroupBillPatientDraft[]
}

export type CreateGroupBillInput = {
  payerId: string
  referenceNumber?: string
  patients: Array<{
    patientId: string
    items: Array<{ serviceId: string; quantity: number }>
  }>
}

export function newGroupBillLine(): GroupBillLineDraft {
  return { id: crypto.randomUUID(), serviceId: '', quantity: 1 }
}

export function newGroupBillPatient(): GroupBillPatientDraft {
  return { id: crypto.randomUUID(), patientId: null, items: [newGroupBillLine()] }
}

/**
 * This deliberately validates only the client-side review gate. Service pricing,
 * eligibility, consent, and final totals remain server-authoritative at commit.
 */
export function canReviewGroupBill(draft: GroupBillDraft): boolean {
  if (!draft.payerId || draft.patients.length < 2 || draft.patients.length > 20) return false
  const patientIds = draft.patients.map((patient) => patient.patientId)
  if (patientIds.some((id) => !id) || new Set(patientIds).size !== patientIds.length) return false
  return draft.patients.every(
    (patient) =>
      patient.items.length > 0 &&
      patient.items.every(
        (item) => !!item.serviceId && Number.isInteger(item.quantity) && item.quantity > 0,
      ),
  )
}

export function toCreateGroupBillPayload(draft: GroupBillDraft): CreateGroupBillInput {
  if (!canReviewGroupBill(draft) || !draft.payerId) {
    throw new Error('Group bill is incomplete')
  }

  return {
    payerId: draft.payerId,
    ...(draft.referenceNumber.trim() ? { referenceNumber: draft.referenceNumber.trim() } : {}),
    patients: draft.patients.map((patient) => ({
      patientId: patient.patientId!,
      items: patient.items.map((item) => ({ serviceId: item.serviceId, quantity: item.quantity })),
    })),
  }
}
