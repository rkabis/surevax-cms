import { displayId } from '../../../shared/utils/displayId.js'
import { num, str, ts } from '../normalize.js'
import type { SrcImmunization } from '../types.js'
import type { TargetClinicalOrder, TargetPatientStandingOrder } from '../targets.js'
import { synthKey } from './encounters.js'

/**
 * Immunization sheet → clinical_orders (+ patient_standing_orders for PEP courses).
 *
 * Status mapping (data-analysis informed):
 *   • i_IsAdministered=true                       → Completed (~46,039 rows)
 *   • false AND i_Timestamp_Ideal > export_date   → Scheduled (~1,721 rows)
 *   • false AND i_Timestamp_Ideal ≤ export_date   → Cancelled (~11,716 rows)
 *
 * 🔴 EXPORT_DATE BELOW IS WRONG (R9): real export ≈ 2026-05-21, not 2025-05-21.
 * With the year-early cutoff, 9,146 lapsed doses are mislabelled Scheduled
 * instead of Cancelled. Derive the cutoff from max(admin/txn date) — see
 * docs/migration/appsheet/DATA-ANALYSIS.md §38. (Counts above are post-fix.)
 *
 * Future-dated typo clamping: dates >2y past export are typos (2027/2028/2520
 * seen). Clamp to export+1y and warn.
 *
 * ARV-PEP course detection: cluster a patient's anti-rabies-PEP doses on a
 * 60-day gap; each cluster → one patient_standing_orders row; member orders get
 * patient_standing_order_id + orderType='Standing_Order'.
 *
 * Bot-12-race: administered AND no txn link (neither direction) AND not a
 * Migration historical row → flag indication='paymentReconciliationRequired'.
 *
 * NOTE: dose_number is currently from i_DosageCount (always ~1). The deep-dive
 * found dose sequence lives in i_Label; parsing that is a pending fix
 * (DESIGN.md "not yet applied" §1).
 */

const EXPORT_DATE = new Date('2025-05-21T00:00:00Z')
const TYPO_THRESHOLD_MS = 730 * 86_400_000 // 2 years

export type ClinicalOrderTransformResult = {
  clinicalOrders: TargetClinicalOrder[]
  patientStandingOrders: TargetPatientStandingOrder[]
  warnings: Array<{ rowId: string; msg: string }>
}

export function transformClinicalOrders(
  src: SrcImmunization[],
  tenantSlug: string,
  serviceCodeByLegacyRef: ReadonlyMap<string, string>,
  vaccineTypeByLegacyRef: ReadonlyMap<string, string>,
  immunizationsInTxnList: ReadonlySet<string>,
): ClinicalOrderTransformResult {
  const warnings: ClinicalOrderTransformResult['warnings'] = []
  const orders: TargetClinicalOrder[] = []

  type PepDose = {
    legacyImmId: string
    scheduledAt: Date | null
    completedAt: Date | null
    route: 'IM' | 'ID' | null
    encounterLegacyId: string
  }
  const pepDosesByPatient = new Map<string, PepDose[]>()

  for (const row of src) {
    const rowId = str(row['Row ID'])
    const patientRef = str(row.i_PatientRef)
    const branchRef = str(row.i_BranchRef)
    const date =
      ts(row.i_Timestamp_Actual)?.toISOString().slice(0, 10) ??
      ts(row.i_Timestamp_Ideal)?.toISOString().slice(0, 10)
    if (!rowId || !patientRef || !branchRef || !date) continue

    const vaccineRef = str(row.i_VaccineRef)
    const serviceId = vaccineRef ? serviceCodeByLegacyRef.get(vaccineRef) : undefined
    if (!serviceId) continue

    const administered = row['i_IsAdministered?'] === true
    let scheduledAt = ts(row.i_Timestamp_Ideal)
    let completedAt = administered ? ts(row.i_Timestamp_Actual) : null

    if (scheduledAt && scheduledAt.getTime() - EXPORT_DATE.getTime() > TYPO_THRESHOLD_MS) {
      warnings.push({
        rowId,
        msg: `i_Timestamp_Ideal=${scheduledAt.toISOString().slice(0, 10)} clamped — likely typo`,
      })
      scheduledAt = new Date(EXPORT_DATE.getTime() + 365 * 86_400_000)
    }
    if (completedAt && completedAt.getTime() - EXPORT_DATE.getTime() > TYPO_THRESHOLD_MS) {
      warnings.push({
        rowId,
        msg: `i_Timestamp_Actual=${completedAt.toISOString().slice(0, 10)} clamped`,
      })
      completedAt = new Date(EXPORT_DATE.getTime() + 365 * 86_400_000)
    }

    let status: TargetClinicalOrder['status']
    if (administered) status = 'Completed'
    else if (scheduledAt && scheduledAt > EXPORT_DATE) status = 'Scheduled'
    else status = 'Cancelled'

    const hasTxn = !!str(row.i_TransactionRef)
    const inTxnList = immunizationsInTxnList.has(rowId)
    const isLegacyImport =
      str(row.i_NurseRef) === 'AppSheetAdmin' &&
      (str(row.i_DosagePrice) === 'Migration' || str(row.i_Remarks) === 'Migration')
    const paymentRaceUnpaid = administered && !hasTxn && !inTxnList && !isLegacyImport

    const route = normalizeRoute(str(row.i_VaccineRoute))
    const order: TargetClinicalOrder = {
      displayId: displayId('ORD'),
      tenantId: tenantSlug,
      serviceId,
      // External provenance is represented by the physical boolean/notes
      // columns. It is deliberately not an `orderType='External'` value: that
      // enum has only Standing_Order, Ad_Hoc and STAT.
      encounterLegacyId: synthKey(patientRef, branchRef, date),
      patientLegacyId: patientRef,
      patientStandingOrderLegacyId: null,
      orderType: 'Ad_Hoc',
      status,
      originalScheduledDate: scheduledAt,
      currentScheduledDate: scheduledAt,
      completedAt,
      completedAtUnknown: false,
      administeredByUserLegacyId: administered ? str(row.i_NurseRef) : null,
      quantity: (num(row.i_DosageCount) ?? 1).toFixed(2),
      doseNumber: num(row.i_DosageCount),
      administrationRoute: route,
      administrationSite: str(row.i_SiteAdministered),
      indication: paymentRaceUnpaid
        ? 'paymentReconciliationRequired'
        : isLegacyImport
          ? 'historicalImport'
          : null,
      administeredAtExternalClinic: isLegacyImport,
      externalClinicianName: null,
      externalClinicName: null,
      externalNotes: isLegacyImport ? 'Historical migration marker in AppSheet source.' : null,
      legacyAppsheetId: rowId,
    }
    orders.push(order)

    const vType = vaccineRef ? vaccineTypeByLegacyRef.get(vaccineRef) : undefined
    if (vType === 'Anti Rabies - PEP') {
      const ts0 = completedAt ?? scheduledAt
      const arr = pepDosesByPatient.get(patientRef) ?? []
      arr.push({
        legacyImmId: rowId,
        scheduledAt: ts0,
        completedAt,
        route: route === 'IM' || route === 'ID' ? route : null,
        encounterLegacyId: order.encounterLegacyId!,
      })
      pepDosesByPatient.set(patientRef, arr)
    }
  }

  const patientStandingOrders: TargetPatientStandingOrder[] = []
  for (const [patientLegacyId, doses] of pepDosesByPatient) {
    const sorted = doses
      .filter((d) => d.scheduledAt)
      .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())
    if (sorted.length === 0) continue

    const COURSE_GAP_MS = 60 * 86_400_000
    let courseStart: Date = sorted[0]!.scheduledAt!
    let courseRoute: 'IM' | 'ID' | null = sorted[0]!.route
    let courseDoses: PepDose[] = [sorted[0]!]
    const emitCourse = () => {
      if (courseDoses.length === 0) return
      const templateId = courseRoute === 'ID' ? 'SOT-RABIES-PEP-ID' : 'SOT-RABIES-PEP-IM'
      const psoLegacyId = `PSO::${patientLegacyId}::${courseStart.toISOString().slice(0, 10)}::${templateId}`
      const allComplete = courseDoses.every((d) => d.completedAt !== null)
      patientStandingOrders.push({
        displayId: displayId('PSO'),
        tenantId: tenantSlug,
        patientLegacyId,
        templateId,
        initiatingEncounterLegacyId: courseDoses[0]!.encounterLegacyId,
        status: allComplete ? 'Completed' : 'Active',
        startDate: courseStart,
        endDate: allComplete ? courseDoses[courseDoses.length - 1]!.completedAt : null,
        legacyAppsheetId: psoLegacyId,
      })
      for (const d of courseDoses) {
        const order = orders.find((o) => o.legacyAppsheetId === d.legacyImmId)
        if (order) {
          order.patientStandingOrderLegacyId = psoLegacyId
          order.orderType = 'Standing_Order'
        }
      }
    }
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!.scheduledAt!
      const cur = sorted[i]!.scheduledAt!
      if (cur.getTime() - prev.getTime() > COURSE_GAP_MS) {
        emitCourse()
        courseStart = cur
        courseRoute = sorted[i]!.route
        courseDoses = [sorted[i]!]
      } else {
        courseDoses.push(sorted[i]!)
        if (!courseRoute) courseRoute = sorted[i]!.route
      }
    }
    emitCourse()
  }

  return { clinicalOrders: orders, patientStandingOrders, warnings }
}

function normalizeRoute(r: string | null): TargetClinicalOrder['administrationRoute'] {
  if (!r) return null
  if (r === 'Oral') return 'PO'
  if (['IM', 'SC', 'ID', 'IV', 'PO', 'IN', 'Topical', 'INF'].includes(r))
    return r as TargetClinicalOrder['administrationRoute']
  return null
}

export const __testing__ = { normalizeRoute, EXPORT_DATE }
