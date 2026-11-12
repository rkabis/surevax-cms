# SureVax CMS — Column Schema Reference

**Purpose:** Field-mapping reference for the AppSheet → new CMS workflow conformance audit.

**Source:** AppSheet Application Documentation HTML export, parsed into structured JSON.

Use this as the canonical "this is what AppSheet stores" reference when verifying the new CMS covers each field's intent and any computed/derived columns are migrated correctly.


## Legend

| Symbol | Meaning |
|---|---|
| 🔑 | Key column (primary key part) |
| 🏷️ | Label column (row display name) |
| 👁️ | Hidden (Visible = NEVER) |
| 🔒 | Read-only |
| ⚙️ | System-defined / auto-generated |
| 🧮 | Virtual (computed, not stored) |
| `App formula` | derives value from other columns |
| `Initial value` | default on new-row create |


## AdminEmails (2 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Email` | Email | 🔑 🏷️ |  | `` | `` |  |

## Branch (14 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 👁️ |  | `` | `[b_Name]` | ID of this row |
| 3 | `b_Name` | Name | 🏷️ |  | `` | `` |  |
| 4 | `b_Address` | Address |  |  | `` | `` |  |
| 5 | `b_BranchEmail` | Email |  |  | `` | `` |  |
| 6 | `b_TransactionInitials` | Text |  |  | `` | `` |  |
| 7 | `b_AllowAccess` | Yes/No | 👁️ 🔒 |  | `` | `` |  |
| 8 | `b_RelatedTransactions` | List | 👁️ 🔒 ⚙️ 🧮 |  | `REF_ROWS("Transaction", "t_BranchRef")` | `` | Transaction entries that reference this entry in t |
| 9 | `Related Immunizations By i_BranchRef` | List | 👁️ 🔒 ⚙️ 🧮 |  | `REF_ROWS("Immunization", "i_BranchRef")` | `` | Immunization entries that reference this entry in  |
| 10 | `Related InventoryLogs By il_BranchRefFrom` | List | 👁️ 🔒 ⚙️ 🧮 |  | `REF_ROWS("InventoryLog", "il_BranchRefFrom")` | `` | InventoryLog entries that reference this entry in  |
| 11 | `Related InventoryLogs By il_BranchRefTo` | List | 👁️ 🔒 ⚙️ 🧮 |  | `REF_ROWS("InventoryLog", "il_BranchRefTo")` | `` | InventoryLog entries that reference this entry in  |
| 12 | `b_CashBalance` | Number | 👁️ 🔒 🧮 |  | `SUM(SELECT(Transaction[t_AmountPaid_Cash], TRUE, FALSE)) + (SUM(SELECT(CashBalan...` | `` |  |
| 13 | `Related CashBalanceLogs` | List | 👁️ 🔒 ⚙️ 🧮 |  | `REF_ROWS("CashBalanceLog", "cbl_BranchRef")` | `` | CashBalanceLog entries that reference this entry i |
| 14 | `Related ImmunizationBundles` | List | 👁️ 🔒 ⚙️ 🧮 |  | `REF_ROWS("ImmunizationBundle", "ib_BranchRef")` | `` | ImmunizationBundle entries that reference this ent |

## BranchReport (19 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 👁️ |  | `` | `UNIQUEID()` |  |
| 3 | `br_Label` | Text | 🏷️ |  | `"Branch Report for " & [br_BranchRef][b_Name] & " - " &` | `` |  |
| 4 | `br_Timestamp` | DateTime | 🔒 | Report Creation Time | `` | `NOW()` |  |
| 5 | `br_DateStart` | Date |  | "Date Start" | `` | `TODAY()` |  |
| 6 | `br_DateEnd` | Date |  | "Date End" | `` | `TODAY()` |  |
| 7 | `br_BranchRef` | EnumList |  | Reporting Branch | `` | `LOOKUP(USEREMAIL(), "Branch", "b_BranchEmail", "Row ID")` |  |
| 8 | `br_NurseRef` | Ref |  | Reporting Nurse | `` | `` |  |
| 9 | `br_ServicesTotal` | Number |  | Total Services Rendered | `SUM([Report Transactions][t_TransactionValue])` | `` |  |
| 10 | `br_AdjustmentTotal` | Number |  | Total Adjustments | `SUM([Report Transactions][t_Adjustment])` | `` |  |
| 11 | `br_PaidTotal` | Number |  | "Total - Payment Received" | `SUM([Report Transactions][t_TotalAmountPaid])` | `` |  |
| 12 | `br_SubtotalCash` | Number |  | Subtotal Cash | `SUM([Report Transactions][t_AmountPaid_Cash])` | `` |  |
| 13 | `br_SubtotalGCash` | Number | 👁️ | Subtotal GCash | `SUM([Report Transactions][t_AmountPaid_GCash])` | `` |  |
| 14 | `br_SubtotalBankTransfer` | Number | 👁️ | Subtotal Bank Transfer | `SUM([Report Transactions][t_AmountPaid_BankTransfer])` | `` |  |
| 15 | `br_SubtotalPayMongo` | Number |  | Subtotal PayMongo | `SUM([Report Transactions][t_AmountPaid_PayMongo])` | `` |  |
| 16 | `br_SubtotalMiscellaneous` | Number |  | Subtotal Miscellaneous | `SUM([Report Transactions][t_AmountPaid_Misc])` | `` |  |
| 17 | `br_Remarks` | Text |  |  | `` | `` |  |
| 18 | `Report Transactions` | List | 🔒 🧮 |  | `SELECT(Transaction[Row ID],` | `` |  |
| 19 | `Report Immunizations` | List | 🔒 🧮 |  | `SELECT(Immunization[Row ID],` | `` |  |

## CashBalanceLog (6 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 🏷️ |  | `` | `UNIQUEID()` |  |
| 3 | `cbl_Timestamp` | Date |  | Timestamp | `` | `NOW()` |  |
| 4 | `cbl_BranchRef` | Ref |  | Branch | `` | `` |  |
| 5 | `cbl_DepositAmount` | Decimal |  | Deposit Amount | `` | `` |  |
| 6 | `cbl_Remarks` | Text |  | Remarks | `` | `` |  |

## DataRequests (9 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 |  | `` | `UNIQUEID()` |  |
| 3 | `dr_Branch` | Text |  |  | `` | `` |  |
| 4 | `dr_Requestor` | Text |  |  | `` | `` |  |
| 5 | `dr_Type` | Text |  |  | `` | `` |  |
| 6 | `dr_Transaction` | Text |  |  | `` | `` |  |
| 7 | `dr_PatientName` | Name | 🏷️ |  | `` | `` |  |
| 8 | `dr_AdditionalDetails` | Text |  |  | `` | `` |  |
| 9 | `dr_Status` | Text |  |  | `` | `` |  |

## Discount (7 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 |  | `` | `UNIQUEID()` |  |
| 3 | `d_DiscountName` | Name | 🏷️ |  | `` | `` |  |
| 4 | `d_Type` | Text |  |  | `` | `` |  |
| 5 | `d_Percentage` | Percent |  |  | `` | `0` |  |
| 6 | `d_Value` | Number |  |  | `` | `` |  |
| 7 | `Related Transactions` | List | 🔒 ⚙️ 🧮 |  | `REF_ROWS("Transaction", "t_DiscountRef")` | `` | Transaction entries that reference this entry in t |

## Immunization (26 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 |  | `` | `UNIQUEID("PackedUUID")` | ID of this row |
| 3 | `i_Label` | Text | 🏷️ | Immunization Label | `[i_VaccineRef].[v_Label] &` | `` |  |
| 4 | `i_Timestamp_Ideal` | DateTime |  | Appointment Timestamp | `` | `[i_Timestamp_Actual]` |  |
| 5 | `i_Timestamp_Actual` | DateTime |  | Timestamp Administered | `` | `NOW()` |  |
| 6 | `i_IdealActualDifference` | Number | 👁️ |  | `` | `` |  |
| 7 | `i_PatientRef` | Ref |  | Patient Name | `` | `` |  |
| 8 | `i_VaccineType` | Enum |  | Vaccine Type | `` | `` |  |
| 9 | `i_VaccineBrand` | Enum |  | Vaccine Brand | `` | `IF(` |  |
| 10 | `i_VaccineRoute` | Enum |  | Vaccine Route | `` | `IF(` |  |
| 11 | `i_VaccineRef` | Ref |  | Vaccine Administered | `ANY(SELECT(Vaccine[Row ID],` | `` |  |
| 12 | `i_DosageCount` | Enum |  | Dosage Count | `` | `IF(CONTAINS([i_VaccineType], "Anti Rabies"), "", IF([i_Vacci...` |  |
| 13 | `i_SiteAdministered` | Enum |  | Site Administered | `` | `` |  |
| 14 | `i_DosagePrice` | Decimal |  | Dosage Price | `` | `[i_VaccineRef].[v_DosagePrice]` |  |
| 15 | `i_DosageAmount` | Decimal |  | "Dosage Amount (cc)" | `` | `[i_VaccineRef].[v_DosageAmount]` |  |
| 16 | `i_NurseRef` | Ref |  | Administering Nurse | `` | `` |  |
| 17 | `i_BranchRef` | Ref |  | Branch Administered | `` | `LOOKUP(USEREMAIL(), "Branch", "b_BranchEmail", "Row ID")` |  |
| 18 | `i_LocationRef` | Enum |  | Location Administered | `` | `` |  |
| 19 | `i_TransactionRef` | Ref |  | Transaction | `` | `` |  |
| 20 | `i_IsAdministered?` | Yes/No |  | Administration Status | `` | `True` |  |
| 21 | `i_IsPaid?` | Yes/No |  | Paid? | `` | `` |  |
| 22 | `i_Remarks` | Text |  | Remarks | `` | `` |  |
| 23 | `i_NextDose` | Ref | 🔒 🧮 |  | `IF([i_DosageCount] = "Booster", null,` | `` |  |
| 24 | `i_PreviousDose` | Ref | 🔒 🧮 |  | `IF([i_DosageCount] = "Booster", null,` | `` |  |
| 25 | `i_PatientBranch` | Text | 🔒 🧮 |  | `CONCATENATE([i_PatientRef].[p_Branch])` | `` |  |
| 26 | `i_PatientName&Branch` | Text | 🔒 🧮 |  | `[i_PatientRef].[p_FullName] & " - " & [i_PatientRef].[p_Branch]` | `` |  |

## ImmunizationBundle (13 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 👁️ |  | `` | `UNIQUEID()` |  |
| 3 | `ib_PatientRef` | Ref |  | Patient Name | `` | `` |  |
| 4 | `ib_BranchRef` | Ref |  |  | `` | `LOOKUP(USEREMAIL(), "Branch", "b_BranchEmail", "Row ID")` |  |
| 5 | `ib_NurseRef` | Ref |  |  | `` | `` |  |
| 6 | `ib_ARVbrand` | Enum | 🏷️ | ARV Brand | `` | `` |  |
| 7 | `ib_ARVRoute` | Enum |  | ARV Route | `` | `` |  |
| 8 | `ib_ARVSite` | Enum |  | ARV Site Administered | `` | `` |  |
| 9 | `ib_TTSite` | Enum |  | TT Site Administered | `` | `` |  |
| 10 | `ib_ERIGRoute` | Enum |  | ERIG Route | `` | `` |  |
| 11 | `ib_ERIGSite` | Enum |  | ERIG Site Administered | `` | `` |  |
| 12 | `ib_ERIGDosageAmount` | Decimal |  | "ERIG Dosage Amount (cc)" | `` | `ANY(SELECT(Vaccine[v_DosageAmount],` |  |
| 13 | `ib_ERIGDosagePrice` | Number |  | ERIG Dosage Price | `` | `ANY(SELECT(Vaccine[v_DosagePrice],` |  |

## InventoryLog (11 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 👁️ |  | `` | `UNIQUEID()` |  |
| 3 | `il_Timestamp` | DateTime | 🏷️ | Timestamp | `` | `NOW()` |  |
| 4 | `il_VaccineBrand` | Enum |  | Vaccine Brand | `` | `` |  |
| 5 | `il_IsTransfer` | Yes/No |  | "Transfer from another clinic?... | `` | `` |  |
| 6 | `il_BranchRefFromEnum` | Enum |  | Originating Branch | `` | `` |  |
| 7 | `il_BranchRefFrom` | Ref | 👁️ | Originating Branch | `[il_BranchRefFromEnum]` | `` |  |
| 8 | `il_BranchRefTo` | Ref |  | Target Branch | `` | `LOOKUP(USEREMAIL(), "Branch", "b_BranchEmail", "Row ID")` |  |
| 9 | `il_InventoryCount_vials` | Decimal |  | "Adjustment Amount (in vials)" | `` | `` |  |
| 10 | `il_InventoryCount_cc` | Decimal |  | "Adjustment Amount (in cc)" | `` | `[il_InventoryCount_vials]*LOOKUP([il_VaccineBrand], "Vaccine...` |  |
| 11 | `il_Remarks` | Text |  | Remarks | `` | `` |  |

## Nurse (12 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 👁️ |  | `` | `[n_FirstName] & [n_LastName]` | ID of this row |
| 3 | `n_FullName` | Name | 🏷️ |  | `CONCATENATE([n_FirstName]," ",[n_LastName])` | `` |  |
| 4 | `n_FirstName` | Name |  |  | `` | `` |  |
| 5 | `n_LastName` | Name |  |  | `` | `` |  |
| 6 | `n_BranchRef` | EnumList |  |  | `` | `` |  |
| 7 | `_ComputedName` | Name | 🔒 ⚙️ 🧮 |  | `CONCATENATE([n_FirstName]," ",[n_LastName])` | `` |  |
| 8 | `Related Remarks` | List | 🔒 ⚙️ 🧮 |  | `REF_ROWS("Remarks", "r_NurseRef")` | `` | Remarks entries that reference this entry in the r |
| 9 | `Related Transactions` | List | 🔒 ⚙️ 🧮 |  | `REF_ROWS("Transaction", "t_NurseRef")` | `` | Transaction entries that reference this entry in t |
| 10 | `Related Immunizations` | List | 🔒 ⚙️ 🧮 |  | `REF_ROWS("Immunization", "i_NurseRef")` | `` | Immunization entries that reference this entry in  |
| 11 | `Related BranchReports` | List | 🔒 ⚙️ 🧮 |  | `REF_ROWS("BranchReport", "br_NurseRef")` | `` | BranchReport entries that reference this entry in  |
| 12 | `Related ImmunizationBundles` | List | 🔒 ⚙️ 🧮 |  | `REF_ROWS("ImmunizationBundle", "ib_NurseRef")` | `` | ImmunizationBundle entries that reference this ent |

## NurseShift (13 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 👁️ |  | `` | `UNIQUEID()` |  |
| 3 | `ns_BranchEmail` | Text | 👁️ |  | `` | `USEREMAIL()` |  |
| 4 | `ns_Location` | LatLong | 👁️ |  | `` | `HERE()` |  |
| 5 | `ns_NurseRef` | Enum | 🏷️ | Nurse | `` | `` |  |
| 6 | `ns_Date` | Date |  | Date | `` | `TODAY()` |  |
| 7 | `ns_TimeIn` | DateTime |  | Time In | `` | `NOW()` |  |
| 8 | `ns_TimeOut` | DateTime |  | Time Out | `` | `` |  |
| 9 | `ns_ShiftHours` | Duration |  | Shift Hours | `` | `` |  |
| 10 | `ns_OvertimeRequest` | Yes/No |  | Request Overtime? | `` | `` |  |
| 11 | `ns_Remarks` | Text |  | Remarks | `` | `` |  |
| 12 | `ns_OvertimeRemarks` | Text |  | Overtime Remarks | `` | `` |  |
| 13 | `ns_Status` | Text | 🔒 🧮 |  | `IF(ISBLANK([ns_TimeOut]), "Timed In - Please remember to Time Out", "Shift Over"...` | `` |  |

## Patient (30 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 | Patient ID | `` | `[p_Initials]&[_RowNumber]` | ID of this row |
| 3 | `p_FullName` | Name | 🏷️ | Full Name | `CONCATENATE([p_FirstName],` | `` |  |
| 4 | `p_FirstName` | Name |  | First Name | `` | `` |  |
| 5 | `p_MiddleName` | Name |  | Middle Name | `` | `` |  |
| 6 | `p_LastName` | Name |  | Last Name | `` | `` |  |
| 7 | `p_DateOfBirth` | Date |  | Date of Birth | `` | `01 January 2000` |  |
| 8 | `p_Gender` | Enum |  | Gender | `` | `` |  |
| 9 | `p_ContactNumber` | Phone |  | Contact Number | `` | `` |  |
| 10 | `p_EmailAddress` | Text |  | Email Address | `` | `` |  |
| 11 | `p_HomeAddress` | Address |  | Home Address | `` | `` |  |
| 12 | `p_OnboardingChannel` | Enum |  | Onboarding Channel | `` | `` |  |
| 13 | `p_Categorization` | Enum |  | Categorization | `` | `` |  |
| 14 | `p_SourceOfConcern` | Enum |  | Source of Concern | `` | `` |  |
| 15 | `p_DateFirstVisit` | Date |  | First Visit Date | `` | `TODAY()` |  |
| 16 | `p_Branch` | EnumList |  | Branch | `` | `ANY(SELECT(Branch[Row ID], TRUE))` |  |
| 17 | `p_HealthCard` | File |  | Health Card | `` | `` |  |
| 18 | `p_PetStatus` | Enum |  | Status of Animal | `` | `` |  |
| 19 | `p_PetFirstARVDate` | Date |  |  | `` | `` |  |
| 20 | `_ComputedName` | Name | 🔒 ⚙️ 🧮 |  | `CONCATENATE([p_FirstName]," ",[p_MiddleName]," ",[p_LastName])` | `` |  |
| 21 | `Related Immunizations` | List | 🔒 ⚙️ 🧮 |  | `REF_ROWS("Immunization", "i_PatientRef")` | `` | Immunization entries that reference this entry in  |
| 22 | `Related Remarks` | List | 🔒 ⚙️ 🧮 |  | `REF_ROWS("Remarks", "r_PatientRef")` | `` | Remarks entries that reference this entry in the r |
| 23 | `p_LastName_FirstLetter` | Text | 👁️ 🔒 🧮 |  | `LEFT([p_LastName], 1)` | `` |  |
| 24 | `p_Age` | Number | 🔒 🧮 | "Age" | `FLOOR(HOUR(TODAY()-[p_DateOfBirth])/365.25/24)` | `` |  |
| 25 | `p_Initials` | Text | 🔒 🧮 |  | `UPPER((LEFT([p_FirstName],1) & LEFT([p_MiddleName],1) & LEFT([p_LastName],1)))` | `` |  |
| 26 | `Related Transactions` | List | 🔒 🧮 |  | `SELECT(Transaction[Row ID], IN([_THISROW].[Row ID], [t_PatientRef]), TRUE)` | `` |  |
| 27 | `Related ImmunizationBundles` | List | 👁️ 🔒 ⚙️ 🧮 |  | `REF_ROWS("ImmunizationBundle", "ib_PatientRef")` | `` | ImmunizationBundle entries that reference this ent |
| 28 | `p_Label_LastNameFirst` | Text | 🔒 🧮 |  | `[p_LastName] &", " & [p_FirstName] & IF(ISNOTBLANK([p_MiddleName]), " " & [p_Mid...` | `` |  |
| 29 | `rel immunizations count` | Number | 🔒 🧮 |  | `COUNT([Related Immunizations])` | `` |  |
| 30 | `p_PetDaysSinceFirstVirtual` | Number | 🔒 🧮 |  | `DAY(TODAY())-DAY([p_PetFirstARVDate])` | `` |  |

## Remarks (6 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 👁️ |  | `` | `UNIQUEID("PackedUUID")` | ID of this row |
| 3 | `r_Timestamp` | DateTime |  | Remark Timestamp | `now()` | `NOW()` |  |
| 4 | `r_Remarks` | Text | 🏷️ | Remark Content | `` | `` |  |
| 5 | `r_PatientRef` | Ref |  | Patient Name | `` | `` |  |
| 6 | `r_NurseRef` | Ref |  | Nurse Name | `` | `` |  |

## TimeLog (9 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 👁️ |  | `` | `UNIQUEID()` |  |
| 3 | `tl_BranchEmail` | Text | 👁️ |  | `` | `USEREMAIL()` |  |
| 4 | `tl_NurseRef` | Enum | 🏷️ | Nurse | `` | `` |  |
| 5 | `tl_Option` | Enum |  | Option | `` | `` |  |
| 6 | `tl_Date` | Date | 👁️ |  | `` | `TODAY()` |  |
| 7 | `tl_Time` | Time | 👁️ |  | `` | `TIMENOW()` |  |
| 8 | `tl_Location` | Text | 👁️ |  | `` | `HERE()` |  |
| 9 | `tl_Remarks` | Text |  | Remarks | `` | `` |  |

## Transaction (22 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 👁️ |  | `` | `UNIQUEID("PackedUUID")` | ID of this row |
| 3 | `t_Label` | Text | 🏷️ | Transaction Label | `` | `[t_BranchRef].[b_TransactionInitials]` | =Transaction Label |
| 4 | `t_Timestamp` | DateTime |  | Transaction Timestamp | `` | `NOW()` | =Timestamp |
| 5 | `t_PatientRef` | EnumList |  | Patient Name | `` | `` | =Patient Name |
| 6 | `t_NurseRef` | Ref |  | Nurse Name | `` | `` | =Nurse Name |
| 7 | `t_BranchRef` | Ref |  | Branch | `` | `LOOKUP(USEREMAIL(), "Branch", "b_BranchEmail", "Row ID")` | =Branch |
| 8 | `t_ImmunizationRef` | EnumList |  | Immunizations Paid For | `` | `` | =Immunizations |
| 9 | `t_TransactionValue` | Number |  | Transaction Value | `sum([t_ImmunizationRef][i_DosagePrice])` | `` |  |
| 10 | `t_TransactionValueNonService` | Number | 👁️ |  | `sum(SELECT(Immunization[i_DosagePrice], AND(IN([Row ID], [t_ImmunizationRef]), [...` | `` |  |
| 11 | `t_DiscountRef` | Ref |  | Transaction Discount | `` | `` |  |
| 12 | `t_Adjustment` | Number |  | Transaction Adjustment | `` | `IF([t_DiscountRef].[d_Type] = "Flat",` |  |
| 13 | `t_TotalAmount` | Number |  | Transaction Amount | `[t_TransactionValue]+[t_Adjustment]` | `` | =Total Amount |
| 14 | `t_TotalAmountPaid` | Number | 👁️ | Total Amount Paid | `[t_AmountPaid_Cash]+[t_AmountPaid_GCash]+[t_AmountPaid_BankTransfer]+[t_AmountPa...` | `[t_AmountPaid_Cash]+[t_AmountPaid_GCash]+[t_AmountPaid_BankT...` |  |
| 15 | `t_AmountPaid_Cash` | Number |  | "💰 CASH 💰" | `` | `0` |  |
| 16 | `t_AmountPaid_GCash` | Number | 👁️ | "Amount Paid - GCash" | `` | `0` | ="Amount Paid - GCash" |
| 17 | `t_AmountPaid_BankTransfer` | Number |  | 💳 BANK TRANSFER 💳 | `` | `0` |  |
| 18 | `t_AmountPaid_PayMongo` | Number |  | ☎️ PAYMONGO ☎️ | `` | `0` |  |
| 19 | `t_AmountPaid_Misc` | Number |  | 📕 MISCELLANEOUS 📕 | `` | `0` |  |
| 20 | `t_MiscPaymentType` | Enum |  | Miscellanous Payment Type | `` | `` |  |
| 21 | `t_Remarks` | LongText |  | Trasanction Remarks | `` | `` | =Transaction Remarks |
| 22 | `Related Immunizations` | List | 🔒 ⚙️ 🧮 |  | `REF_ROWS("Immunization", "i_TransactionRef")` | `` | Immunization entries that reference this entry in  |

## Vaccine (15 columns)

| # | Column | Type | Flags | Display Name | App Formula | Initial Value | Description |
|---|---|---|---|---|---|---|---|
| 1 | `_RowNumber` | Number | 👁️ 🔒 ⚙️ |  | `` | `` | Number of this row |
| 2 | `Row ID` | Text | 🔑 👁️ |  | `` | `UNIQUEID("PackedUUID")` | ID of this row |
| 3 | `v_Label` | Text | 🏷️ | Vaccine Label | `concatenate(` | `concatenate(` |  |
| 4 | `v_Type` | Enum |  | Vaccine Type | `` | `` |  |
| 5 | `v_Brand` | Enum |  | Vaccine Brand | `` | `` |  |
| 6 | `v_Route` | Enum |  | Vaccine Route | `` | `` |  |
| 7 | `v_DosagePrice` | Decimal |  | Vaccine Base Dosage Price | `` | `` |  |
| 8 | `v_DosageAmount` | Decimal |  | Vaccine Base Dosage Amount | `` | `` |  |
| 9 | `v_DosageVial` | Decimal |  | Vaccine Base Dosage per Vial | `` | `` |  |
| 10 | `v_DosageDetailsEditable?` | Yes/No |  | Dosage Price and Amount Editab... | `` | `` |  |
| 11 | `Related Immunizations` | List | 👁️ 🔒 ⚙️ 🧮 |  | `REF_ROWS("Immunization", "i_VaccineRef")` | `` | Immunization entries that reference this entry in  |
| 12 | `v_BranchInventory_cc` | Decimal | 🔒 🧮 |  | `SUM(SELECT(InventoryLog[il_InventoryCount_cc],` | `` |  |
| 13 | `v_BranchInventory_vials` | Number | 🔒 🧮 |  | `CEILING([v_BranchInventory_cc]/[v_DosageVial])` | `` |  |
| 14 | `v_BranchInventory_ccText` | Text | 🔒 🧮 |  | `[v_BranchInventory_cc] & " cc"` | `` |  |
| 15 | `v_BranchInventory_vialsText` | Text | 🔒 🧮 |  | `[v_BranchInventory_vials] & " vials"` | `` |  |