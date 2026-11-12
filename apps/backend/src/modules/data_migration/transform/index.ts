/**
 * Top-level transform orchestrator.
 *
 * Reads a SourceBundle, runs every per-sheet transformer in dependency order,
 * returns a single LoadPlan. Skipped sheets: InventoryLog (D1), ImmunizationBundle
 * (A2), BranchReport (C2), staffing history (C1; TimeLog + NurseShift union is
 * optional/deferred), DataRequests, Discount (no lookup table).
 */

import type { SourceBundle } from '../types.js'
import { type LoadPlan, emptyLoadPlan } from '../targets.js'
import { transformBranches } from './branches.js'
import { transformUsers } from './users.js'
import { transformCatalog } from './catalog.js'
import { transformPatients } from './patients.js'
import { transformEncounters } from './encounters.js'
import { transformClinicalOrders } from './clinicalOrders.js'
import { transformTransactions } from './transactions.js'
import { transformCashBalance } from './cash.js'
import { transformOrphanRemarks, type RemarkOverlay } from './remarks.js'
import { str } from '../normalize.js'

export type TransformResult = {
  plan: LoadPlan
  serviceCodeByLegacyRef: Map<string, string>
  orphanRemarks: RemarkOverlay
  warnings: Array<{ source: string; rowId?: string; code?: string; msg: string }>
  sourceCounts: Record<keyof SourceBundle, number>
}

export function runTransforms(
  src: SourceBundle,
  tenantSlug: string,
  migrationAppliedAt: Date,
): TransformResult {
  const plan = emptyLoadPlan()
  const warnings: TransformResult['warnings'] = []

  plan.branches = transformBranches(src.Branch, tenantSlug)
  plan.users = transformUsers(src.Nurse, src.AdminEmails, tenantSlug)

  const catalog = transformCatalog(src.Vaccine, tenantSlug)
  plan.products = catalog.products
  plan.services = catalog.services
  plan.serviceEligibleProducts = catalog.serviceEligibleProducts
  plan.servicePrices = catalog.servicePrices
  for (const s of catalog.skipped) {
    warnings.push({ source: 'Vaccine', rowId: s.rowId, msg: s.reason })
  }

  plan.patients = transformPatients(src.Patient, tenantSlug)

  const biteCategoryByPatient = new Map<string, string>()
  for (const p of src.Patient) {
    const rid = str(p['Row ID'])
    const cat = str(p.p_Categorization)
    if (rid && cat) biteCategoryByPatient.set(rid, cat)
  }

  const encResult = transformEncounters(
    {
      immunizations: src.Immunization,
      remarks: src.Remarks,
      vaccineTypeByRef: catalog.vaccineTypeByLegacyRef,
      biteCategoryByPatient,
    },
    tenantSlug,
  )
  plan.encounters = encResult.encounters

  const txns = transformTransactions(
    src.Transactions,
    src.Immunization,
    src.ChargeAccounts,
    tenantSlug,
    catalog.legacyRefToServiceId,
    new Set(plan.patients.map((patient) => patient.legacyAppsheetId)),
  )
  plan.transactions = txns.transactions
  plan.transactionItems = txns.items
  plan.payments = txns.payments
  for (const unresolved of txns.unresolvedTransactions) {
    warnings.push({
      source: 'Transactions',
      rowId: unresolved.rowId,
      code: 'TRANSACTION_PATIENT_UNRESOLVED',
      msg: 'transaction patient reference does not resolve to one imported patient; financial group excluded for P1 reconciliation',
    })
  }
  for (const corrected of txns.correctedPaymentTransactions) {
    warnings.push({
      source: 'Transactions',
      rowId: corrected.rowId,
      code: corrected.rule,
      msg: `payment header corrected from source tender legs using ${corrected.rule}`,
    })
  }
  for (const unresolved of txns.unresolvedPaymentTransactions) {
    warnings.push({
      source: 'Transactions',
      rowId: unresolved.rowId,
      code: 'TRANSACTION_PAYMENT_UNRESOLVED',
      msg: 'transaction excluded: payment legs disagree with both the paid header and final bill',
    })
  }
  for (const unresolved of txns.unresolvedHeaderTransactions) {
    warnings.push({
      source: 'Transactions',
      rowId: unresolved.rowId,
      code:
        unresolved.reason === 'FINAL_BILL_FORMULA_DISAGREEMENT'
          ? 'TRANSACTION_FINAL_BILL_FORMULA_UNRESOLVED'
          : unresolved.reason === 'FULLY_PAID_DISCOUNT_NOT_MATERIALISED'
            ? 'TRANSACTION_FULLY_PAID_DISCOUNT_UNRESOLVED'
            : unresolved.reason === 'NEGATIVE_REFUND_REQUIRES_ORIGINAL_TRANSACTION'
              ? 'TRANSACTION_REFUND_LINK_UNRESOLVED'
              : 'TRANSACTION_NEGATIVE_PAYMENT_LEG_UNRESOLVED',
      msg: `transaction excluded: ${unresolved.reason}`,
    })
  }

  const co = transformClinicalOrders(
    src.Immunization,
    tenantSlug,
    catalog.legacyRefToServiceId,
    catalog.vaccineTypeByLegacyRef,
    txns.immunizationsInTxnList,
  )
  plan.clinicalOrders = co.clinicalOrders
  plan.patientStandingOrders = co.patientStandingOrders
  for (const w of co.warnings) {
    warnings.push({ source: 'Immunization', rowId: w.rowId, msg: w.msg })
  }

  plan.cashDrawerSessions = transformCashBalance(src.CashBalanceLog, tenantSlug)
  // C1 was reversed after the latest export review: TimeLog and NurseShift are
  // parallel attendance sources. Import neither until a union/dedupe transform
  // exists; staffing history is not a clinical/financial cutover prerequisite.
  plan.staffTimeLogs = []

  for (const patientLegacyId of txns.fullyPaidPatientLegacyIds) {
    plan.patientTags.push({
      tenantId: tenantSlug,
      patientLegacyId,
      tagCode: 'FULLY_PAID_PEP_COURSE',
      appliedAt: migrationAppliedAt,
    })
  }
  for (const p of plan.patients) {
    if (p.mergedIntoLegacyId) {
      plan.patientTags.push({
        tenantId: tenantSlug,
        patientLegacyId: p.legacyAppsheetId,
        tagCode: 'POTENTIAL_DUPLICATE',
        appliedAt: migrationAppliedAt,
      })
    }
  }

  const orphanRemarks = transformOrphanRemarks(src.Remarks, encResult.matchedRemarkIds)

  return {
    plan,
    serviceCodeByLegacyRef: catalog.legacyRefToServiceId,
    orphanRemarks,
    warnings,
    sourceCounts: {
      Patient: src.Patient.length,
      Immunization: src.Immunization.length,
      Transactions: src.Transactions.length,
      Remarks: src.Remarks.length,
      Vaccine: src.Vaccine.length,
      Branch: src.Branch.length,
      Nurse: src.Nurse.length,
      BranchReport: src.BranchReport.length,
      ImmunizationBundle: src.ImmunizationBundle.length,
      InventoryLog: src.InventoryLog.length,
      CashBalanceLog: src.CashBalanceLog.length,
      AdminEmails: src.AdminEmails.length,
      Discount: src.Discount.length,
      TimeLog: src.TimeLog.length,
      NurseShift: src.NurseShift.length,
      ChargeAccounts: src.ChargeAccounts.length,
    },
  }
}
