/**
 * Source-sheet row types for the AppSheet/GSheet → SureVax v2 migration.
 *
 * One type per sheet in `surevax_gsheet_db.xlsx`. Field names mirror the
 * exact column headers (`p_FirstName`, `t_AmountPaid_Cash`, …) so the
 * extractor can produce these rows by a 1:1 header map.
 *
 * All fields are loose at the boundary and narrowed inside the transformer —
 * AppSheet exports are inconsistent (numbers stringified, dates as strings or
 * Date objects, empty cells as null OR empty-string). The transformer layer is
 * the only place that knows the canonical normalisation rules (see normalize.ts).
 */

export type SrcPatient = {
  'Row ID': string
  p_FullName?: string | null
  p_FirstName?: string | null
  p_MiddleName?: string | null
  p_LastName?: string | null
  p_DateOfBirth?: Date | string | null
  p_Gender?: string | null
  p_ContactNumber?: number | string | null
  p_EmailAddress?: string | null
  p_HomeAddress?: string | null
  p_OnboardingChannel?: string | null
  p_Categorization?: string | number | null
  p_SourceOfConcern?: string | null
  p_DateFirstVisit?: Date | string | null
  p_Branch?: string | null
  p_HealthCard?: string | null
  p_PetStatus?: string | null
  p_PetFirstARVDate?: Date | string | null
}

export type SrcImmunization = {
  'Row ID': string
  i_Label?: string | null
  i_Timestamp_Ideal?: Date | string | null
  i_Timestamp_Actual?: Date | string | null
  i_IdealActualDifference?: string | number | null
  i_PatientRef?: string | null
  i_VaccineType?: string | null
  i_VaccineBrand?: string | null
  i_VaccineRoute?: string | null
  i_VaccineRef?: string | null
  i_DosageCount?: string | number | null
  i_SiteAdministered?: string | null
  i_DosagePrice?: number | string | null
  i_DosageAmount?: number | string | null
  i_NurseRef?: string | null
  i_BranchRef?: string | null
  i_LocationRef?: string | null
  i_TransactionRef?: string | null
  'i_IsAdministered?'?: boolean | string | null
  'i_IsPaid?'?: boolean | string | null
  i_Remarks?: string | null
}

export type SrcTransaction = {
  'Row ID': string
  t_Label?: string | null
  t_Timestamp?: Date | string | null
  t_PatientRef?: string | null
  t_NurseRef?: string | null
  t_BranchRef?: string | null
  t_ImmunizationRef?: string | null
  t_TransactionValue?: number | string | null
  t_TransactionValueNonService?: number | string | null
  t_DiscountRef?: string | null
  t_Adjustment?: number | string | null
  t_TotalAmount?: number | string | null
  t_TotalAmountPaid?: number | string | null
  t_AmountPaid_Cash?: number | string | null
  t_AmountPaid_GCash?: number | string | null
  t_AmountPaid_BankTransfer?: number | string | null
  t_AmountPaid_PayMongo?: number | string | null
  t_AmountPaid_Misc?: number | string | null
  t_MiscPaymentType?: string | null
  t_Remarks?: string | null
}

export type SrcRemark = {
  'Row ID': string
  r_Timestamp?: Date | string | null
  r_Remarks?: string | null
  r_PatientRef?: string | null
  r_NurseRef?: string | null
}

export type SrcVaccine = {
  'Row ID': string // AppSheet uses the catalog code (e.g. ARVPEP_AbhayrabID) as the row id
  v_Label?: string | null
  v_Type?: string | null
  v_Brand?: string | null
  v_Route?: string | null
  v_DosagePrice?: number | string | null
  v_DosageAmount?: number | string | null
  v_DosageVial?: number | string | null
  'v_DosageDetailsEditable?'?: boolean | null
}

export type SrcBranch = {
  'Row ID': string // branch slug (e.g. "HolySpirit")
  b_Name?: string | null
  b_Address?: string | null
  b_BranchEmail?: string | null
  b_TransactionInitials?: string | null // 3-letter code (HST, TMG, AGR)
  b_AllowAccess?: boolean | null
}

export type SrcNurse = {
  'Row ID': string // staff slug (e.g. "RoberosePuri", "AppSheetAdmin")
  n_FullName?: string | null
  n_FirstName?: string | null
  n_LastName?: string | null
  n_BranchRef?: string | null
}

export type SrcBranchReport = {
  'Row ID': string
  br_Label?: string | null
  br_Timestamp?: Date | string | null
  br_DateStart?: Date | string | null
  br_DateEnd?: Date | string | null
  br_BranchRef?: string | null
  br_NurseRef?: string | null
  br_ServicesTotal?: number | string | null
  br_AdjustmentTotal?: number | string | null
  br_PaidTotal?: number | string | null
  br_SubtotalCash?: number | string | null
  br_SubtotalGCash?: number | string | null
  br_SubtotalBankTransfer?: number | string | null
  br_SubtotalPayMongo?: number | string | null
  br_SubtotalMiscellaneous?: number | string | null
  br_Remarks?: string | null
}

export type SrcImmunizationBundle = {
  'Row ID': string
  ib_PatientRef?: string | null
  ib_BranchRef?: string | null
  ib_NurseRef?: string | null
  ib_ARVbrand?: string | null
  ib_ARVRoute?: string | null
  ib_ARVSite?: string | null
  ib_TTSite?: string | null
  ib_ERIGRoute?: string | null
  ib_ERIGSite?: string | null
  ib_ERIGDosageAmount?: number | string | null
  ib_ERIGDosagePrice?: number | string | null
}

export type SrcInventoryLog = {
  'Row ID': string
  il_Timestamp?: Date | string | null
  il_VaccineBrand?: string | null
  il_IsTransfer?: boolean | string | null
  il_BranchRefFromEnum?: string | null
  il_BranchRefFrom?: string | null
  il_BranchRefTo?: string | null
  il_InventoryCount_vials?: number | string | null
  il_InventoryCount_cc?: number | string | null
  il_Remarks?: string | null
}

export type SrcCashBalanceLog = {
  'Row ID': string
  cbl_Timestamp?: Date | string | null
  cbl_BranchRef?: string | null
  cbl_DepositAmount?: number | string | null
  cbl_Remarks?: string | null
}

export type SrcAdminEmail = {
  Email: string
}

export type SrcDiscount = {
  'Row ID': string
  d_DiscountName?: string | null
  d_Type?: string | null // 'Percentage' | 'Flat'
  d_Percentage?: number | string | null
  d_Value?: number | string | null
}

export type SrcTimeLog = {
  'Row ID': string
  tl_BranchEmail?: string | null
  tl_NurseRef?: string | null
  tl_Option?: string | null // 'Time In' | 'Time Out'
  tl_Date?: Date | string | null
  tl_Time?: Date | string | null
  tl_Location?: string | null
  tl_Remarks?: string | null
}

export type SrcNurseShift = {
  'Row ID': string
  ns_BranchEmail?: string | null
  ns_Location?: string | null
  ns_NurseRef?: string | null
  ns_Date?: Date | string | null
  ns_TimeIn?: Date | string | null
  ns_TimeOut?: Date | string | null
  ns_ShiftHours?: Date | string | null
  ns_OvertimeRequest?: boolean | null
  ns_Remarks?: string | null
  ns_OvertimeRemarks?: string | null
}

export type SrcChargeAccount = {
  'Transaction Name'?: string | null
  'Patient Name'?: string | null
  'Charge Account'?: string | null
  'Transaction Amount Due'?: number | string | null
  'Service Price'?: number | string | null
  'Reconciliation Status'?: string | null
  'Transaction Posting Date'?: Date | string | null
  'Vaccine Brand'?: string | null
  'Vaccine Type'?: string | null
  'Vaccine Route'?: string | null
  Branch?: string | null
  'Transaction ID'?: string | null
  'Immunization ID'?: string | null
  'Service Render Date'?: Date | string | null
}

// =============================================================================
// Source-bundle: keyed by sheet name. The extractor returns this aggregate.
// =============================================================================

export type SourceBundle = {
  Patient: SrcPatient[]
  Immunization: SrcImmunization[]
  Transactions: SrcTransaction[]
  Remarks: SrcRemark[]
  Vaccine: SrcVaccine[]
  Branch: SrcBranch[]
  Nurse: SrcNurse[]
  BranchReport: SrcBranchReport[]
  ImmunizationBundle: SrcImmunizationBundle[]
  InventoryLog: SrcInventoryLog[]
  CashBalanceLog: SrcCashBalanceLog[]
  AdminEmails: SrcAdminEmail[]
  Discount: SrcDiscount[]
  TimeLog: SrcTimeLog[]
  NurseShift: SrcNurseShift[]
  ChargeAccounts: SrcChargeAccount[]
}

// =============================================================================
// Migration context — passed through every stage.
// =============================================================================

export type MigrationContext = {
  /** Destination tenant slug. Defaults to 'SVX'. */
  tenantId: string
  /**
   * Platform user id whose audit signature the importer rows carry. Resolved
   * at the start of a non-dry run from `platform_users`.
   */
  platformUserId: number
  /** One cutover timestamp shared by every synthetic legacy-import consent. */
  cutoverAt: Date
  /** Dry-run flag: builds + validates rows but skips DB writes. */
  dryRun: boolean
  /** Per-batch row limit for INSERT chunks. */
  batchSize: number
  /** Logger used for progress + error reporting. */
  log: (event: { level: 'info' | 'warn' | 'error'; msg: string; data?: unknown }) => void
}

export type SheetCounts = Partial<Record<keyof SourceBundle, number>>

export type MigrationReport = {
  sourceCounts: SheetCounts
  inserted: Record<string, number>
  skipped: Record<string, number>
  warnings: Array<{ sheet: keyof SourceBundle; row: number; msg: string }>
  durationMs: number
}
