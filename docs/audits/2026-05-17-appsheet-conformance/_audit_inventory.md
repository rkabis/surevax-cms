# SureVax CMS — AppSheet Inventory (Pre-Audit)

## Bots (12 total)

| Table | Bot |
|---|---|
| Immunization | Create ARV succeeding doses |
| Immunization | Create TT booster dose |
| Immunization | Adjust future appointments |
| Immunization | Create HEP succeeding doses |
| Immunization | Create TDAP succeeding doses |
| Immunization | Create CP succeeding doses |
| Immunization | Create SINGLES succeeding doses |
| Immunization | Create ARV booster succeeding doses |
| ImmunizationBundle | Create immunization bundle |
| InventoryLog | Create inventory log transfer |
| Patient | Create health card |
| Transaction | Update immunization details |

## Actions (117 total — 51 custom, 66 system-generated)

### AdminEmails (1 — 0 custom)
- `Compose Email (Email)` *(auto for Email column)*

### Branch (6 — 1 custom)
- **⭐ Deposit Cash Balance**
- Add, Delete, Edit *(system)*
- Compose Email (b_BranchEmail), View Map (b_Address) *(auto for column types)*

### BranchReport (5 — 1 custom)
- **⭐ Refresh Values**
- Add, Delete, Edit *(system)*
- View Ref (br_NurseRef) *(auto)*

### CashBalanceLog (4 — 0 custom)
- Add, Delete, Edit, View Ref (cbl_BranchRef) *(all system/auto)*

### DataRequests (3 — 0 custom)
- Add, Delete, Edit *(system)*

### Immunization (38 — 28 custom)
**Refresh/Utility:**
- ⭐ `_ Refresh`
- ⭐ `_A Go To Log Txn`
- ⭐ `_A Mark Administered`
- ⭐ `_A Update Details Based on Txn`

**Single-Dose creators (likely fired by bots):**
- ⭐ `_SD ARV Booster D2`, `_SD ARV PEP D2`, `_SD ARV PEP D3`, `_SD ARV PEP D4 ID`, `_SD ARV PEP D4 IM`, `_SD ARV PEP D5 IM`, `_SD ARV PrEP D2`, `_SD ARV PrEP D3`, `_SD CP D2`, `_SD HEPAB D2`, `_SD HEPAB D3`, `_SD SHING D2`, `_SD TDAP D2`, `_SD TDAP D3`, `_SD TT D2`, `_SD TT D3` (16 actions)

**Admin / clinical:**
- ⭐ `[ADMIN] Add Immunization to Linked Transaction`
- ⭐ `[ADMIN] Update Dosage Details`
- ⭐ `Administer Vaccine`
- ⭐ `Call Patient`
- ⭐ `Create ARV PEP Dose 5`
- ⭐ `Create Next Doses`
- ⭐ `Create Transaction`
- ⭐ `Text Patient`

**System/Auto (10):**
- Add, Delete, Edit
- View Ref (i_BranchRef, i_NextDose, i_NurseRef, i_PatientRef, i_PreviousDose, i_TransactionRef, i_VaccineRef)

### ImmunizationBundle (9 — 3 custom)
- ⭐ `_Create ARV`, `_Create ERIG`, `_Create TT`
- System: Add, Delete, Edit, View Ref (ib_BranchRef, ib_NurseRef, ib_PatientRef)

### InventoryLog (5 — 0 custom)
- Add, Delete, Edit, View Ref (il_BranchRefFrom), View Ref (il_BranchRefTo) *(all system/auto)*

### Nurse (3 — 0 custom)
- Add, Delete, Edit *(system)*

### NurseShift (4 — 2 custom)
- ⭐ `Request Overtime`
- ⭐ `Time Out`
- Add, Edit *(system)*

### Patient (19 — 12 custom)
**Admin / bulk:**
- ⭐ `[ADMIN] Delete All Immunizations`
- ⭐ `[ADMIN] Delete All Unadministered Immunizations`

**Pet workflow:**
- ⭐ `[Pet] Mark as Alive`
- ⭐ `[Pet] Mark as Dead`
- ⭐ `[Pet] Mark as Unknown`
- ⭐ `[Pet] SMS - Inquire Status`
- ⭐ `Pet Update First Day`

**Clinical / data:**
- ⭐ `Create Health Card`
- ⭐ `Immunization Bundle`
- ⭐ `Log Medical Service`
- ⭐ `Log Today's Transaction`
- ⭐ `update row id` *(suspicious low-cased name — possible test action)*

**System/Auto (7):** Add, Call Phone (p_ContactNumber), Delete, Edit, Open File (p_HealthCard), Send SMS (p_ContactNumber), View Map (p_HomeAddress)

### Remarks (5 — 0 custom)
- Add, Delete, Edit, View Ref (r_NurseRef), View Ref (r_PatientRef) *(all system/auto)*

### TimeLog (2 — 0 custom)
- Add, Edit *(system)*

### Transaction (9 — 3 custom)
- ⭐ `[ADMIN] Set Transaction Label`
- ⭐ `Add Immunization to Linked Transaction`
- ⭐ `Update immunizations`
- System/Auto (6): Add, Delete, Edit, View Ref (t_BranchRef, t_DiscountRef, t_NurseRef)

### Vaccine (4 — 1 custom)
- ⭐ `Log Inventory`
- Add, Delete, Edit *(system)*

---

## Views (16 custom + ~37 system-generated)

### PRIMARY NAVIGATION (4)
- Today's Appointments *(landing view)*
- View Patient List
- Create Immunization
- Log Transaction

### MENU NAVIGATION (9)
- Future Appointments
- Past Valid Appointments
- Create Branch Report
- Time In / Time Out
- Follow up on Pet Status
- Nurse Shift
- Patient Table
- Immunization Table
- Transaction Table

### REFERENCE VIEWS (3)
- ImmunizationByBrand
- View Branch
- View Vaccine Inventory

### SYSTEM GENERATED (per-table Detail/Form/Inline)

| Table-group | Views |
|---|---|
| AdminEmails (1) | AllAccessEmails_Detail |
| Branch (2) | Branch_Detail, Branch_Form |
| BranchReport (3) | BranchReport_Detail, BranchReport_Form, BranchReport_Inline |
| CashBalanceLog (3) | CashBalanceLog_Detail, CashBalanceLog_Form, CashBalanceLog_Inline |
| DataRequests (2) | DataRequests_Detail, DataRequests_Form |
| Discount (1) | *(detail only)* |
| Immunization (3) | Immunization_Detail, Immunization_Form, Immunization_Inline |
| ImmunizationBundle (3) | ImmunizationBundle_Detail, ImmunizationBundle_Form, ImmunizationBundle_Inline |
| InventoryLog (3) | InventoryLog_Detail, InventoryLog_Form, InventoryLog_Inline |
| Nurse (2) | Nurse_Detail, Nurse_Form |
| NurseShift (2) | NurseShift_Detail, NurseShift_Form |
| Past and Valid (2) | Past and Not Administered_Detail, Past and Valid_Form |
| Patient (2) | Patient_Detail, Patient_Form |
| Pet Follow up (2) | Pet Follow up_Detail, Pet Follow up_Form |
| Remarks (3) | Remarks_Detail, Remarks_Form, Remarks_Inline |
| TimeLog (2) | TimeLog_Detail, TimeLog_Form |
| Today (2) | Today_Form, Todays Appointments_Detail |
| Transaction (3) | Transaction_Detail, Transaction_Form, Transaction_Inline |
| Upcoming (1) | Upcoming_Detail |
| Vaccine (2) | Vaccine_Detail, Vaccine_Form |
| Vaccine_InventoryView (2) | Vaccine_InventoryView_Detail, ... |

**Note:** Several "Past and Valid", "Pet Follow up", "Today", "Upcoming" groupings appear to be slice-driven views, not pure tables. Will confirm during Slices enumeration.

## Tables (16 parent tables)
AdminEmails, Branch, BranchReport, CashBalanceLog, DataRequests, Discount, Immunization (+4 slices), ImmunizationBundle, InventoryLog, Nurse, NurseShift, Patient (+1 slice), Remarks, TimeLog, Transaction, Vaccine (+1 slice)

## Pending: Slices, Security Roles (to be enumerated)
