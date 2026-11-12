# **Database Schema Comparison: Existing vs. New (v4)**

## **SureVax CMS - Migration Analysis**

---

## **Executive Summary**

**Current System**: AppSheet-based with flat, denormalized tables  
**New System**: PostgreSQL with normalized, relational schema

**Key Changes**:

- ✅ Proper relational database design with foreign keys
- ✅ Standing orders as core abstraction (vs. manual immunization tracking)
- ✅ Prepayment support for multi-dose protocols
- ✅ Automated recall engine (vs. manual tracking)
- ✅ Comprehensive audit trail
- ✅ Staff time tracking
- ✅ Cross-branch access control
- ✅ Inventory management with FEFO
- ✅ Lab services integration

---

## **Table-by-Table Comparison**

### **1. Branches**

**Existing (Branch Table)**:

```
Row ID, b_Name, b_Address, b_BranchEmail, b_TransactionInitials, b_AllowAccess
```

**New (branches)**:

```sql
id UUID, code, name, address, contact_email, contact_phone,
is_active, settings JSONB, created_at, updated_at, created_by_id
```

**Changes**:

- ✅ UUID instead of Row ID
- ✅ `code` replaces `b_TransactionInitials` (e.g., "HS" for Holy Spirit)
- ✅ `settings` JSONB for flexible config (printer IPs, operating hours)
- ✅ Audit fields (`created_at`, `updated_at`, `created_by_id`)
- ✅ Soft delete via `is_active`
- ❌ Removed `b_AllowAccess` (handled by user roles)

**Migration**:

```sql
INSERT INTO branches (code, name, address, contact_email, is_active)
SELECT b_TransactionInitials, b_Name, b_Address, b_BranchEmail,
       CASE WHEN b_AllowAccess = 'TRUE' THEN TRUE ELSE FALSE END
FROM Branch;
```

---

### **2. Users / Staff**

**Existing (Nurse Table)**:

```
Row ID, n_FullName, n_FirstName, n_LastName, n_BranchRef
```

**New (users)**:

```sql
id UUID, branch_id, email, password_hash, first_name, last_name,
role, license_number, is_active, last_login_at, created_at, updated_at
```

**Changes**:

- ✅ Proper authentication (email, password_hash)
- ✅ Role-based access control (SuperAdmin, BranchManager, Doctor, Nurse, LabTech, Cashier)
- ✅ Single branch assignment (vs. comma-separated list)
- ✅ License number for compliance
- ✅ Last login tracking
- ❌ Removed `n_FullName` (computed from first_name + last_name)

**Migration**:

```sql
INSERT INTO users (first_name, last_name, role, branch_id, email, is_active)
SELECT
  n_FirstName,
  n_LastName,
  'Nurse', -- Default role
  (SELECT id FROM branches WHERE code = SPLIT_PART(n_BranchRef, ',', 1) LIMIT 1), -- Take first branch
  LOWER(n_FirstName || '.' || n_LastName || '@surevax.com'), -- Generate email
  TRUE
FROM Nurse
WHERE n_FirstName != 'Appsheet' AND n_FirstName != 'Admin';
```

**Note**: Multi-branch access (e.g., "HolySpirit, Timog, Aguirre") needs to be handled via cross-branch access requests in new system.

---

### **3. Staff Time Tracking**

**Existing (NurseShift Table)**:

```
Row ID, ns_BranchEmail, ns_Location, ns_NurseRef, ns_Date, ns_TimeIn,
ns_TimeOut, ns_ShiftHours, ns_OvertimeRequest, ns_Remarks, ns_OvertimeRemarks
```

**New (staff_time_logs)**:

```sql
id UUID, user_id, branch_id, clock_in_at, clock_out_at, total_hours,
notes, created_at, updated_at
```

**Changes**:

- ✅ Proper foreign keys (user_id, branch_id)
- ✅ Timestamps instead of separate date + time fields
- ✅ Auto-calculated `total_hours`
- ✅ Single `notes` field (combines remarks)
- ❌ Removed `ns_OvertimeRequest` (handle in application logic)

**Migration**:

```sql
INSERT INTO staff_time_logs (user_id, branch_id, clock_in_at, clock_out_at, total_hours, notes)
SELECT
  (SELECT id FROM users WHERE email = ns_NurseRef || '@surevax.com'),
  (SELECT id FROM branches WHERE contact_email = ns_BranchEmail),
  ns_Date + ns_TimeIn::time,
  ns_Date + ns_TimeOut::time,
  ns_ShiftHours,
  CONCAT_WS(' | ', ns_Remarks, ns_OvertimeRemarks)
FROM NurseShift;
```

---

### **4. Patients**

**Existing (Patient Table)**:

```
Row ID, p_FullName, p_FirstName, p_MiddleName, p_LastName, p_DateOfBirth,
p_Gender, p_ContactNumber, p_EmailAddress, p_HomeAddress, p_OnboardingChannel,
p_Categorization, p_SourceOfConcern, p_DateFirstVisit, p_Branch, p_HealthCard,
p_PetStatus, p_PetFirstARVDate
```

**New (patients)**:

```sql
id UUID, home_branch_id, first_name, middle_name, last_name, suffix, dob, sex,
contact_number, email, address, guardian_name, guardian_contact,
emergency_contact_name, emergency_contact_number, allergies, medical_conditions,
is_active, search_vector, created_at, updated_at, created_by_id
```

**Changes**:

- ✅ Proper normalization (separate name fields)
- ✅ Full-text search via `search_vector`
- ✅ Guardian info for pediatric patients
- ✅ Emergency contact (critical for safety)
- ✅ Allergies and medical conditions
- ❌ Removed `p_FullName` (computed)
- ❌ Removed `p_OnboardingChannel`, `p_Categorization`, `p_SourceOfConcern` (move to JSONB or separate table if needed)
- ❌ Removed `p_HealthCard`, `p_PetStatus`, `p_PetFirstARVDate` (move to clinical notes or separate table)

**Migration**:

```sql
INSERT INTO patients (
  first_name, middle_name, last_name, dob, sex, contact_number, email, address,
  home_branch_id, is_active, created_at
)
SELECT
  p_FirstName,
  p_MiddleName,
  p_LastName,
  p_DateOfBirth,
  CASE WHEN p_Gender = 'Male' THEN 'M' WHEN p_Gender = 'Female' THEN 'F' ELSE NULL END,
  p_ContactNumber,
  p_EmailAddress,
  p_HomeAddress,
  (SELECT id FROM branches WHERE code = p_Branch),
  TRUE,
  p_DateFirstVisit
FROM Patient;
```

---

### **5. Service Catalog**

**Existing (Vaccine Table)**:

```
Row ID, v_Label, v_Type, v_Brand, v_Route, v_DosagePrice, v_DosageAmount,
v_DosageVial, v_DosageDetailsEditable?
```

**New (service_catalog)**:

```sql
id UUID, code, name, description, service_type, category, base_price,
is_stockable, is_active, requires_prescription, search_vector,
created_at, updated_at, created_by_id
```

**Changes**:

- ✅ Unified catalog (vaccines, labs, consultations, procedures, goods)
- ✅ `code` for unique identification (e.g., "ARVPEP_AbhayrabID")
- ✅ `service_type` enum (Immunization, Laboratory, Consultation, Procedure, Goods)
- ✅ Full-text search
- ✅ `is_stockable` flag for inventory tracking
- ❌ Removed vaccine-specific fields (v_Brand, v_Route, v_DosageAmount, v_DosageVial) → Move to JSONB or separate table if needed

**Migration**:

```sql
INSERT INTO service_catalog (code, name, service_type, category, base_price, is_stockable, is_active)
SELECT
  "Row ID" AS code,
  v_Label AS name,
  CASE
    WHEN v_Type LIKE '%Diagnostics%' THEN 'Laboratory'
    WHEN v_Type LIKE '%SERVICE%' THEN 'Consultation'
    ELSE 'Immunization'
  END AS service_type,
  v_Type AS category,
  CAST(REPLACE(REPLACE(v_DosagePrice, ',', ''), 'PHP', '') AS DECIMAL(10,2)) AS base_price,
  CASE WHEN v_DosageVial::numeric > 0 THEN TRUE ELSE FALSE END AS is_stockable,
  TRUE AS is_active
FROM Vaccine;
```

---

### **6. Immunizations / Clinical Orders**

**Existing (Immunization Table)**:

```
Row ID, i_Label, i_Timestamp_Ideal, i_Timestamp_Actual, i_IdealActualDifference,
i_PatientRef, i_VaccineType, i_VaccineBrand, i_VaccineRoute, i_VaccineRef,
i_DosageCount, i_SiteAdministered, i_DosagePrice, i_DosageAmount, i_NurseRef,
i_BranchRef, i_LocationRef, i_TransactionRef, i_IsAdministered?, i_IsPaid?, i_Remarks
```

**New (clinical_orders)**:

```sql
id UUID, patient_id, standing_order_id, service_id, encounter_id,
ordering_provider_id, administering_provider_id, order_type, status, priority,
original_scheduled_date, current_scheduled_date, due_date, completed_at,
quantity, administration_site, administration_route, lot_id, notes JSONB,
created_at, updated_at, created_by_id
```

**Changes**:

- ✅ Links to `standing_order_id` (protocol-driven)
- ✅ Separate `original_scheduled_date` and `current_scheduled_date` (for missed dose recalculation)
- ✅ FSM status (Pending, Due, Overdue, In_Progress, Completed, Missed, Cancelled)
- ✅ Links to `lot_id` for inventory traceability
- ✅ `encounter_id` for visit grouping
- ✅ Separate ordering vs. administering provider
- ❌ Removed `i_IsAdministered?` and `i_IsPaid?` (use status and transaction_items)
- ❌ Removed `i_IdealActualDifference` (calculated on-the-fly)

**Migration**:

```sql
INSERT INTO clinical_orders (
  patient_id, service_id, ordering_provider_id, administering_provider_id,
  order_type, status, original_scheduled_date, current_scheduled_date, completed_at,
  administration_site, administration_route, quantity, created_at
)
SELECT
  (SELECT id FROM patients WHERE CONCAT(first_name, ' ', last_name) = (SELECT p_FullName FROM Patient WHERE "Row ID" = i_PatientRef)),
  (SELECT id FROM service_catalog WHERE code = i_VaccineRef),
  (SELECT id FROM users WHERE email = i_NurseRef || '@surevax.com'),
  (SELECT id FROM users WHERE email = i_NurseRef || '@surevax.com'),
  'Ad_Hoc', -- No standing orders in old system
  CASE WHEN i_IsAdministered = 'TRUE' THEN 'Completed' ELSE 'Pending' END,
  i_Timestamp_Ideal::date,
  i_Timestamp_Actual::date,
  i_Timestamp_Actual,
  i_SiteAdministered,
  i_VaccineRoute,
  i_DosageCount,
  i_Timestamp_Actual
FROM Immunization;
```

**Note**: Old system doesn't have standing orders, so all orders are migrated as `Ad_Hoc`.

---

### **7. Standing Orders (NEW)**

**Existing**: ❌ No equivalent (manual tracking)

**New**:

- `standing_order_templates` - Reusable protocols (e.g., "Rabies PEP Category III")
- `patient_standing_orders` - Active protocols for patients

**Purpose**:

- Auto-generate clinical orders for multi-dose protocols
- Track protocol completion status
- Enable automated recall engine
- Support prepayment for future doses

**Example**:

```sql
-- Create template for Rabies PEP
INSERT INTO standing_order_templates (code, name, protocol_type, protocol_items)
VALUES (
  'RABIES-PEP-CAT3',
  'Rabies PEP Category III',
  'Immunization',
  '[
    {"service_id": "consultation-uuid", "day_offset": 0, "sequence": 1, "quantity": 1},
    {"service_id": "wound-cleaning-uuid", "day_offset": 0, "sequence": 2, "quantity": 1},
    {"service_id": "arv-dose-1-uuid", "day_offset": 0, "sequence": 3, "quantity": 1},
    {"service_id": "erig-uuid", "day_offset": 0, "sequence": 4, "quantity": 1},
    {"service_id": "arv-dose-2-uuid", "day_offset": 3, "sequence": 1, "quantity": 1},
    {"service_id": "arv-dose-3-uuid", "day_offset": 7, "sequence": 1, "quantity": 1},
    {"service_id": "arv-dose-4-uuid", "day_offset": 14, "sequence": 1, "quantity": 1}
  ]'::jsonb
);
```

---

### **8. Encounters (NEW)**

**Existing**: ❌ No equivalent (transactions loosely group services)

**New (encounters)**:

```sql
id UUID, patient_id, branch_id, provider_id, encounter_type,
started_at, ended_at, chief_complaint, status, created_at, updated_at
```

**Purpose**:

- Group all services/orders for a single visit
- Track visit start/end times
- Document chief complaint
- Enable proper clinical workflow

**Migration**: Cannot migrate directly (no encounter concept in old system). Need to infer from transactions:

```sql
-- Create encounters from transactions
INSERT INTO encounters (patient_id, branch_id, provider_id, encounter_type, started_at, ended_at, status)
SELECT DISTINCT
  (SELECT id FROM patients WHERE CONCAT(first_name, ' ', last_name) = (SELECT p_FullName FROM Patient WHERE "Row ID" = t_PatientRef)),
  (SELECT id FROM branches WHERE code = t_BranchRef),
  (SELECT id FROM users WHERE email = t_NurseRef || '@surevax.com'),
  'Initial',
  t_Timestamp,
  t_Timestamp + INTERVAL '1 hour', -- Estimate
  'Completed'
FROM Transactions;
```

---

### **9. Transactions**

**Existing (Transactions Table)**:

```
Row ID, t_Label, t_Timestamp, t_PatientRef, t_NurseRef, t_BranchRef,
t_ImmunizationRef, t_TransactionValue, t_TransactionValueNonService,
t_DiscountRef, t_Adjustment, t_TotalAmount, t_TotalAmountPaid,
t_AmountPaid_Cash, t_AmountPaid_GCash, t_AmountPaid_BankTransfer,
t_AmountPaid_PayMongo, t_AmountPaid_Misc, t_MiscPaymentType, t_Remarks
```

**New (transactions + transaction_items + payments)**:

```sql
-- transactions
id UUID, reference_number, branch_id, patient_id, encounter_id, transaction_date,
cashier_id, payer_id, total_gross, total_discount, total_vat_exempt, total_vat,
total_net, discount_id_type, discount_id_number, status, is_prepayment,
prepayment_note, created_at, updated_at, created_by_id

-- transaction_items
id UUID, transaction_id, clinical_order_id, service_id, quantity, unit_price,
discount_amount, vat_exempt, subtotal, is_prepaid, prepaid_for_date, created_at

-- payments
id UUID, transaction_id, payment_method, amount, payer_id, reference_number,
payment_date, received_by_id, notes, created_at
```

**Changes**:

- ✅ Normalized into 3 tables (header, items, payments)
- ✅ Proper foreign keys to clinical_orders
- ✅ Support for split payments (multiple payment methods)
- ✅ Prepayment support (`is_prepaid`, `prepaid_for_date`)
- ✅ VAT tracking for BIR compliance
- ✅ Discount ID tracking (Senior/PWD)
- ❌ Removed comma-separated `t_ImmunizationRef` (use transaction_items)

**Migration**:

```sql
-- Migrate transactions
INSERT INTO transactions (
  reference_number, branch_id, patient_id, transaction_date, cashier_id,
  total_gross, total_discount, total_net, status, created_at
)
SELECT
  "Row ID" AS reference_number,
  (SELECT id FROM branches WHERE code = t_BranchRef),
  (SELECT id FROM patients WHERE CONCAT(first_name, ' ', last_name) = (SELECT p_FullName FROM Patient WHERE "Row ID" = t_PatientRef)),
  t_Timestamp::date,
  (SELECT id FROM users WHERE email = t_NurseRef || '@surevax.com'),
  t_TransactionValue,
  t_Adjustment,
  t_TotalAmountPaid,
  CASE WHEN t_TotalAmountPaid > 0 THEN 'Paid' ELSE 'Unpaid' END,
  t_Timestamp
FROM Transactions;

-- Migrate payments (Cash)
INSERT INTO payments (transaction_id, payment_method, amount, payment_date, received_by_id)
SELECT
  (SELECT id FROM transactions WHERE reference_number = t."Row ID"),
  'Cash',
  t_AmountPaid_Cash,
  t_Timestamp::date,
  (SELECT id FROM users WHERE email = t_NurseRef || '@surevax.com')
FROM Transactions t
WHERE t_AmountPaid_Cash > 0;

-- Migrate payments (GCash)
INSERT INTO payments (transaction_id, payment_method, amount, payment_date, received_by_id)
SELECT
  (SELECT id FROM transactions WHERE reference_number = t."Row ID"),
  'GCash',
  t_AmountPaid_GCash,
  t_Timestamp::date,
  (SELECT id FROM users WHERE email = t_NurseRef || '@surevax.com')
FROM Transactions t
WHERE t_AmountPaid_GCash > 0;

-- Repeat for BankTransfer, PayMongo, Misc...
```

---

### **10. Inventory (NEW)**

**Existing**: ❌ No inventory tracking

**New**:

- `inventory_lots` - Batch/lot tracking with FEFO
- `inventory_transactions` - Audit trail of stock movements

**Purpose**:

- Track vaccine batches, expiry dates, manufacturers
- FEFO (First-Expired-First-Out) dispensing
- Traceability (which patient received which lot)
- Prevent expired vaccine administration
- Automatic stock deduction on administration

**Cannot migrate** (no existing data).

---

### **11. Lab Services (NEW)**

**Existing**: Diagnostics in Vaccine table (no order tracking)

**New**:

- `partner_laboratories` - External lab partners
- `lab_orders` - Lab test requests and results

**Purpose**:

- Track lab orders from request to result
- Integrate with partner labs (Hi-Precision, etc.)
- Store structured results (JSONB)
- Notify patients when results ready

**Migration**: Extract diagnostics from Vaccine table:

```sql
INSERT INTO service_catalog (code, name, service_type, category, base_price, is_stockable)
SELECT
  "Row ID",
  v_Label,
  'Laboratory',
  'Diagnostics',
  CAST(REPLACE(REPLACE(v_DosagePrice, ',', ''), 'PHP', '') AS DECIMAL(10,2)),
  FALSE
FROM Vaccine
WHERE v_Type = 'Diagnostics';
```

---

### **12. Audit Logs (NEW)**

**Existing**: ❌ No audit trail

**New (audit_logs)**:

```sql
id UUID, user_id, action, entity_type, entity_id, branch_id,
ip_address, user_agent, changes JSONB, timestamp
```

**Purpose**:

- Track all data changes (who, what, when, why)
- Cross-branch access requests/approvals
- Transaction modifications
- Schedule changes
- Patient data updates
- Compliance and security

**Cannot migrate** (no existing data).

---

### **13. Notifications (NEW)**

**Existing**: ❌ No automated notifications

**New (notifications)**:

```sql
id UUID, patient_id, clinical_order_id, notification_type, recipient,
message, status, sent_at, delivered_at, error_message, external_reference, created_at
```

**Purpose**:

- Automated SMS reminders for follow-up doses
- Lab result notifications
- Appointment confirmations
- Track delivery status

**Cannot migrate** (no existing data).

---

## **Removed Tables**

### **Remarks Table**

**Existing**: `Row ID, r_Timestamp, r_Remarks, r_PatientRef, r_NurseRef`

**New**: ❌ Removed (use `clinical_orders.notes` JSONB or `encounters.chief_complaint`)

**Migration**: Merge into clinical notes or audit logs if needed.

---

### **ImmunizationBundle Table**

**Existing**: Temporary table for common vaccine bundles

**New**: ❌ Removed (use `standing_order_templates` instead)

**Migration**: Create standing order templates for common bundles:

```sql
-- Example: Rabies PEP bundle
INSERT INTO standing_order_templates (code, name, protocol_type, protocol_items)
SELECT
  'BUNDLE-' || ib_ARVbrand || '-' || ib_ARVRoute,
  'Rabies PEP: ' || ib_ARVbrand || ' ' || ib_ARVRoute,
  'Immunization',
  jsonb_build_array(
    jsonb_build_object('service_id', (SELECT id FROM service_catalog WHERE name LIKE '%' || ib_ARVbrand || '%'), 'day_offset', 0, 'sequence', 1, 'quantity', 1)
  )
FROM ImmunizationBundle
GROUP BY ib_ARVbrand, ib_ARVRoute;
```

---

### **BranchReport Table**

**Existing**: Pre-calculated daily reports

**New**: ❌ Removed (generate on-the-fly from transactions)

**Migration**: Create views or materialized views for reporting:

```sql
CREATE MATERIALIZED VIEW daily_branch_reports AS
SELECT
  b.name AS branch_name,
  DATE(t.transaction_date) AS report_date,
  COUNT(DISTINCT t.id) AS transaction_count,
  SUM(t.total_gross) AS total_gross,
  SUM(t.total_discount) AS total_discount,
  SUM(t.total_net) AS total_net,
  SUM(CASE WHEN p.payment_method = 'Cash' THEN p.amount ELSE 0 END) AS cash_total,
  SUM(CASE WHEN p.payment_method = 'GCash' THEN p.amount ELSE 0 END) AS gcash_total,
  SUM(CASE WHEN p.payment_method = 'BankTransfer' THEN p.amount ELSE 0 END) AS bank_transfer_total,
  SUM(CASE WHEN p.payment_method = 'PayMongo' THEN p.amount ELSE 0 END) AS paymongo_total
FROM transactions t
JOIN branches b ON b.id = t.branch_id
LEFT JOIN payments p ON p.transaction_id = t.id
GROUP BY b.name, DATE(t.transaction_date);
```

---

## **Key Architectural Improvements**

### **1. Normalization**

**Old**: Flat, denormalized tables with comma-separated values  
**New**: Proper 3NF normalization with foreign keys

**Example**:

- Old: `n_BranchRef = "HolySpirit, Timog, Aguirre"` (comma-separated)
- New: `branch_id` foreign key + cross-branch access requests

---

### **2. Data Integrity**

**Old**: No foreign keys, manual data entry, prone to orphaned records  
**New**: Foreign keys, cascading deletes, referential integrity

**Example**:

- Old: `i_PatientRef` could reference non-existent patient
- New: `patient_id UUID REFERENCES patients(id)` enforces existence

---

### **3. Audit Trail**

**Old**: No audit trail, no change tracking  
**New**: Comprehensive audit logs with before/after values

**Example**:

- Old: No way to know who changed payment method
- New: `audit_logs` tracks all changes with user, timestamp, reason

---

### **4. Workflow Automation**

**Old**: Manual tracking of multi-dose protocols  
**New**: Automated standing orders with recall engine

**Example**:

- Old: Nurse manually creates 4 separate immunization records for Rabies PEP
- New: Doctor orders "Rabies PEP" → system auto-generates 4 clinical orders with scheduled dates

---

### **5. Prepayment Support**

**Old**: No prepayment tracking, patients pay per visit  
**New**: Prepayment flag on transaction items

**Example**:

- Old: Patient pays P3000 on Day 0, P3000 on Day 3, P3000 on Day 7, P3000 on Day 14
- New: Patient pays P12000 on Day 0 for all 4 doses (marked as prepaid)

---

### **6. Inventory Traceability**

**Old**: No inventory tracking, no lot numbers  
**New**: Full lot/batch tracking with FEFO

**Example**:

- Old: No way to know which vaccine batch was administered
- New: `clinical_orders.lot_id` links to `inventory_lots` with batch number, expiry, manufacturer

---

### **7. Cross-Branch Access Control**

**Old**: Comma-separated branch list, no access control  
**New**: Request/approval workflow with audit trail

**Example**:

- Old: Nurse has access to "HolySpirit, Timog, Aguirre" (permanent)
- New: Nurse requests access to Cainta patient → Manager approves → 24-hour access granted

---

## **Migration Strategy**

### **Phase 1: Core Data Migration**

1. Migrate branches
2. Migrate users (nurses → users with role='Nurse')
3. Migrate patients
4. Migrate service catalog (vaccines + diagnostics)
5. Migrate staff time logs

### **Phase 2: Clinical Data Migration**

1. Create encounters (infer from transactions)
2. Migrate immunizations → clinical_orders
3. Link clinical_orders to encounters

### **Phase 3: Financial Data Migration**

1. Migrate transactions (header)
2. Migrate transaction_items (link to clinical_orders)
3. Migrate payments (split by payment method)

### **Phase 4: New Features (No Migration)**

1. Create standing order templates for common protocols
2. Set up inventory lots (start fresh)
3. Configure partner laboratories
4. Set up notification templates

### **Phase 5: Validation**

1. Verify patient counts match
2. Verify transaction totals match
3. Verify immunization counts match
4. Run test queries to ensure data integrity

---

## **Data Loss / Transformation Notes**

### **Lost Data** (cannot migrate):

- ❌ `p_OnboardingChannel`, `p_Categorization`, `p_SourceOfConcern` (patient metadata)
- ❌ `p_HealthCard`, `p_PetStatus`, `p_PetFirstARVDate` (rabies-specific fields)
- ❌ `i_IdealActualDifference` (calculated field)
- ❌ `t_ImmunizationRef` (comma-separated, replaced by transaction_items)
- ❌ Branch reports (regenerate from transactions)
- ❌ Remarks table (merge into clinical notes)

### **Transformed Data**:

- ✅ Comma-separated branch lists → Single branch + cross-branch access
- ✅ Flat immunization records → Standing orders + clinical orders
- ✅ Single transaction record → transactions + transaction_items + payments
- ✅ Vaccine-specific fields → Generic service catalog

---

## **Post-Migration Cleanup**

### **1. Generate Missing Data**

```sql
-- Generate search vectors for patients
UPDATE patients SET search_vector = to_tsvector('english',
  coalesce(first_name, '') || ' ' || coalesce(middle_name, '') || ' ' ||
  coalesce(last_name, '') || ' ' || coalesce(contact_number, '')
);

-- Generate search vectors for services
UPDATE service_catalog SET search_vector = to_tsvector('english',
  coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(code, '')
);
```

### **2. Create Standing Order Templates**

```sql
-- Rabies PEP Category III (4 doses)
INSERT INTO standing_order_templates (code, name, protocol_type, protocol_items)
VALUES (
  'RABIES-PEP-CAT3',
  'Rabies PEP Category III',
  'Immunization',
  '[
    {"service_id": "...", "day_offset": 0, "sequence": 1, "quantity": 1, "instructions": "Consultation"},
    {"service_id": "...", "day_offset": 0, "sequence": 2, "quantity": 1, "instructions": "Wound cleaning"},
    {"service_id": "...", "day_offset": 0, "sequence": 3, "quantity": 1, "instructions": "ARV Dose 1"},
    {"service_id": "...", "day_offset": 0, "sequence": 4, "quantity": 1, "instructions": "ERIG"},
    {"service_id": "...", "day_offset": 3, "sequence": 1, "quantity": 1, "instructions": "ARV Dose 2"},
    {"service_id": "...", "day_offset": 7, "sequence": 1, "quantity": 1, "instructions": "ARV Dose 3"},
    {"service_id": "...", "day_offset": 14, "sequence": 1, "quantity": 1, "instructions": "ARV Dose 4"}
  ]'::jsonb
);
```

### **3. Set Up Inventory**

```sql
-- Start fresh with current stock
INSERT INTO inventory_lots (service_id, branch_id, batch_number, manufacturer, expiry_date, received_date, received_quantity, quantity_on_hand)
VALUES
  ((SELECT id FROM service_catalog WHERE code = 'ARVPEP_AbhayrabID'), (SELECT id FROM branches WHERE code = 'HS'), 'BATCH-001', 'Abhay Biologicals', '2026-12-31', CURRENT_DATE, 100, 100);
```

### **4. Create Default Users**

```sql
-- Create admin user
INSERT INTO users (branch_id, email, password_hash, first_name, last_name, role, is_active)
VALUES (
  (SELECT id FROM branches WHERE code = 'HS'),
  'admin@surevax.com',
  '$2b$10$...', -- Bcrypt hash of default password
  'System',
  'Administrator',
  'SuperAdmin',
  TRUE
);
```

---

## **Summary**

**Total Tables**:

- Old: 9 tables (Branch, Nurse, NurseShift, Patient, Vaccine, Immunization, Transactions, Remarks, ImmunizationBundle, BranchReport)
- New: 18 tables (branches, users, staff_time_logs, patients, service_catalog, standing_order_templates, patient_standing_orders, encounters, clinical_orders, transactions, transaction_items, payments, payer_profiles, inventory_lots, inventory_transactions, partner_laboratories, lab_orders, audit_logs, notifications)

**Key Improvements**:

- ✅ Proper relational design with foreign keys
- ✅ Standing orders for protocol automation
- ✅ Prepayment support
- ✅ Inventory tracking with FEFO
- ✅ Comprehensive audit trail
- ✅ Cross-branch access control
- ✅ Lab services integration
- ✅ Automated recall engine
- ✅ Staff time tracking

**Migration Complexity**: Medium

- Core data (branches, users, patients, services) is straightforward
- Clinical data (immunizations → clinical_orders) requires transformation
- Financial data (transactions) requires normalization into 3 tables
- New features (standing orders, inventory, audit logs) start fresh
