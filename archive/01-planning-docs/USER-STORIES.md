# **SureVax CMS v2.0: User Stories**

## **Comprehensive Workflow Coverage**

---

## **As a Nurse**

### **Patient Management**

### **Story 1: Create and View Patients**

**As a** nurse  
**I want to** create new patients and view existing patient records  
**So that** I can manage patient information efficiently

**Acceptance Criteria**:

- Nurse clicks "New Patient" button
- System shows registration form with required fields (first name, last name, DOB, sex, contact number)
- Nurse enters patient information
- System validates required fields and checks for duplicates using fuzzy search
- System creates patient record and shows success message
- Nurse can search for patients by name, contact number, or DOB
- System displays patient list with key information
- Nurse can click on patient to view full details

---

### **Story 2: Edit Patient Details**

**As a** nurse  
**I want to** edit patient information  
**So that** I can keep records up-to-date

**Acceptance Criteria**:

- Nurse searches for and selects a patient
- Nurse clicks "Edit Patient" button
- System shows editable form with current patient information
- Nurse updates fields (contact number, address, allergies, etc.)
- System validates changes
- System saves updates and logs change in audit_logs
- System shows "Patient updated successfully" message

---

### **Story 3: Add General Remarks to Patients**

**As a** nurse  
**I want to** add general remarks or notes to a patient's record  
**So that** important information is visible to all staff

**Acceptance Criteria**:

- Nurse views patient details
- Nurse sees "General Remarks" section
- Nurse clicks "Add Remark"
- System shows text area for remarks
- Nurse enters note (e.g., "Patient prefers morning appointments", "Allergic to penicillin - confirmed")
- System saves remark with timestamp and nurse's name
- All staff can view remarks when accessing patient record
- Remarks are displayed chronologically with most recent first

**Technical Notes**:

```sql
-- Store in patients.medical_conditions or create separate remarks table
UPDATE patients
SET medical_conditions = medical_conditions || E'\n[2026-03-09 - Nurse Maria] Patient prefers morning appointments'
WHERE id = 'patient-uuid';
```

---

### **Story 4: Log Patient Visit**

**As a** nurse  
**I want to** log when a patient has visited  
**So that** we track patient attendance

**Acceptance Criteria**:

- Nurse searches for patient
- Nurse clicks "Log Visit" or "Start Encounter"
- System creates encounter record with timestamp
- System marks any due appointments as "Completed" or "In Progress"
- System shows visit logged successfully
- Visit appears in patient's visit history

---

### **Story 5: View Patient Visit History**

**As a** nurse  
**I want to** see a patient's complete visit history  
**So that** I understand their treatment timeline

**Acceptance Criteria**:

- Nurse views patient details
- System shows "Visit History" section with chronological list
- Each visit shows:
  - Date and time
  - Encounter type (Initial, Follow-Up, Emergency)
  - Services received
  - Provider name
  - Payment status
  - Clinical notes summary
- Nurse can click on visit to see full details
- Nurse can filter by date range or encounter type

---

### **Appointment Management**

### **Story 6: See Upcoming Appointments for My Branch**

**As a** nurse  
**I want to** see all upcoming appointments for my assigned branch  
**So that** I can prepare for expected patients

**Acceptance Criteria**:

- Nurse clicks "Upcoming Appointments" or "Daily Recall List"
- System shows appointments filtered by nurse's branch
- Display includes:
  - Patient name and contact number
  - Scheduled date and time
  - Service/procedure name
  - Payment status (Prepaid/Unpaid)
  - Protocol name (if part of standing order)
- Nurse can filter by date (Today, Tomorrow, This Week, Custom Range)
- Nurse can sort by time, patient name, or service type
- System highlights overdue appointments in red

**Technical Notes**:

```sql
SELECT
  p.first_name || ' ' || p.last_name AS patient_name,
  p.contact_number,
  co.current_scheduled_date,
  sc.name AS service_name,
  co.status,
  CASE
    WHEN ti.is_prepaid = TRUE THEN 'Prepaid'
    WHEN t.status = 'Paid' THEN 'Paid'
    ELSE 'Unpaid'
  END AS payment_status
FROM clinical_orders co
JOIN patients p ON p.id = co.patient_id
JOIN service_catalog sc ON sc.id = co.service_id
LEFT JOIN transaction_items ti ON ti.clinical_order_id = co.id
LEFT JOIN transactions t ON t.id = ti.transaction_id
WHERE p.home_branch_id = 'nurse-branch-uuid'
  AND co.current_scheduled_date >= CURRENT_DATE
  AND co.status IN ('Pending', 'Due')
ORDER BY co.current_scheduled_date, p.last_name;
```

---

### **Story 7: Easily Create Appointment Details for a Patient**

**As a** nurse  
**I want to** quickly create appointment details for a patient  
**So that** I can schedule follow-ups or new visits

**Acceptance Criteria**:

- Nurse views patient record
- Nurse clicks "Create Appointment"
- System shows appointment form:
  - Service/procedure (searchable dropdown)
  - Scheduled date and time
  - Provider (defaults to current nurse)
  - Notes (optional)
- Nurse fills in details
- System creates clinical_order with status='Pending'
- System shows "Appointment created successfully"
- Appointment appears in upcoming appointments list
- System can optionally send SMS reminder to patient

---

### **Story 8: See Missed Appointments and Send Reminder**

**As a** nurse  
**I want to** see missed appointments and send SMS reminders  
**So that** patients return for their scheduled treatments

**Acceptance Criteria**:

- Nurse clicks "Missed Appointments"
- System shows list of appointments where:
  - `current_scheduled_date < CURRENT_DATE`
  - `status = 'Overdue'`
- Each entry shows:
  - Patient name and contact number
  - Missed date
  - Service name
  - Days overdue
- Nurse clicks "Send Reminder" next to patient
- **On Desktop**: System opens SMS compose dialog with pre-filled message
- **On Mobile**: System opens default messaging app with:
  - To: Patient's contact number
  - Message: "Hi [Patient Name], you missed your [Service Name] appointment on [Date]. Please visit us soon to continue your treatment. - SureVax Clinic"
- Nurse sends SMS manually
- System logs SMS sent in notifications table
- System marks reminder as sent

**Technical Notes**:

```javascript
// Mobile detection
if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
  // Open default messaging app
  window.location.href = `sms:${patientPhone}?body=${encodeURIComponent(message)}`
} else {
  // Desktop: show SMS dialog or use SMS gateway API
  showSMSDialog(patientPhone, message)
}
```

---

### **Encounter & Clinical Workflow**

### **Story 9: From Appointment, Easily Create All Necessary Fields**

**As a** nurse  
**I want to** start an encounter from an appointment with pre-filled information  
**So that** I don't have to re-enter patient details

**Acceptance Criteria**:

- Nurse views upcoming appointments list
- Nurse clicks "Start Encounter" next to appointment
- System creates encounter with:
  - Patient ID (from appointment)
  - Branch ID (nurse's branch)
  - Provider ID (current nurse)
  - Encounter type (auto-detected: Initial or Follow-Up)
  - Started timestamp
- System links clinical_order to encounter
- System shows encounter screen with:
  - Patient info (pre-filled)
  - Chief complaint (if available)
  - Pending orders for this visit
  - Vitals entry form
  - Clinical notes section
- Nurse can immediately start documenting visit

---

### **Story 10: Easily Use System for Common Standing Orders/Bundles**

**As a** nurse  
**I want to** quickly apply common standing order bundles  
**So that** I can process standard cases efficiently

**Acceptance Criteria**:

- Nurse starts encounter
- Nurse clicks "Apply Bundle" or "Quick Order"
- System shows list of common bundles:
  - "Rabies PEP Category II" (3 doses)
  - "Rabies PEP Category III" (4 doses + ERIG)
  - "Flu Vaccination"
  - "Tetanus Booster"
  - "General Consultation + Lab"
- Nurse selects bundle (e.g., "Rabies PEP Category III")
- System shows bundle preview with all services and schedule
- Nurse can customize (add/remove services, adjust dates)
- Nurse clicks "Apply"
- System creates:
  - patient_standing_orders record
  - All clinical_orders with calculated dates
- System shows "Bundle applied: 7 orders created"
- Nurse can immediately start administering Day 0 services

---

### **Story 11: Human Body Map for Rabies Bite Location**

**As a** nurse  
**I want to** click on a human body map to tag bite location  
**So that** I can quickly document the source of concern

**Acceptance Criteria**:

- Nurse starts rabies encounter
- System shows human body diagram (front and back view)
- Nurse clicks on affected area (e.g., right forearm)
- System highlights selected area
- System auto-fills specialty_data with anatomical location
- Nurse can add additional details (wound size, depth, type)
- System saves bite location in specialty_data JSONB:
  ```json
  {
    "bite_location": "Right forearm",
    "bite_location_coordinates": { "x": 245, "y": 180, "view": "front" },
    "wound_type": "Bite",
    "wound_size_cm": 3,
    "wound_depth": "Moderate"
  }
  ```
- Body map with marked location is visible in patient record

**Technical Notes**:

- Use SVG body diagram with clickable regions
- Map coordinates to anatomical terms
- Store both visual coordinates and text description

---

### **Billing & Transactions**

### **Story 12: Easily Create Transactions from Upcoming Appointments**

**As a** nurse  
**I want to** create transactions directly from upcoming appointments  
**So that** I can bill patients quickly

**Acceptance Criteria**:

- Nurse views upcoming appointments or encounter screen
- Nurse clicks "Create Transaction" or "Bill Patient"
- System shows transaction form with:
  - Patient info (pre-filled)
  - Services from appointment/encounter (pre-selected)
  - Quantity and unit price for each service
  - Total amount calculated
- Nurse can add/remove services
- Nurse can apply discounts (Senior, PWD, HMO)
- Nurse selects payment method (Cash, GCash, Maya, etc.)
- System creates transaction and payment records
- System prints receipt
- System links transaction to clinical_orders

---

### **Story 13: Generate Branch Report for Today's Transactions**

**As a** nurse  
**I want to** generate a branch report showing all transactions today  
**So that** I can see daily revenue and payment methods used

**Acceptance Criteria**:

- Nurse clicks "Daily Report" or "End of Day Report"
- System shows report for current date and nurse's branch:
  - **Summary Section**:
    - Total transactions: 25
    - Total revenue: P45,000
    - Total discounts: P3,000
    - Net revenue: P42,000
  - **Payment Method Breakdown**:
    - Cash: P25,000 (15 transactions)
    - GCash: P12,000 (7 transactions)
    - Maya: P5,000 (3 transactions)
  - **Transaction List**:
    - Reference number
    - Patient name
    - Time
    - Amount
    - Payment method
    - Cashier name
- Nurse can export to PDF or Excel
- Nurse can filter by date range or payment method

**Technical Notes**:

```sql
SELECT
  t.reference_number,
  p.first_name || ' ' || p.last_name AS patient_name,
  t.transaction_date,
  t.total_net,
  pm.payment_method,
  u.first_name || ' ' || u.last_name AS cashier_name
FROM transactions t
JOIN patients p ON p.id = t.patient_id
JOIN payments pm ON pm.transaction_id = t.id
JOIN users u ON u.id = t.cashier_id
WHERE t.branch_id = 'nurse-branch-uuid'
  AND t.transaction_date = CURRENT_DATE
ORDER BY t.created_at;

-- Summary
SELECT
  COUNT(*) AS total_transactions,
  SUM(total_gross) AS total_revenue,
  SUM(total_discount) AS total_discounts,
  SUM(total_net) AS net_revenue
FROM transactions
WHERE branch_id = 'nurse-branch-uuid'
  AND transaction_date = CURRENT_DATE;

-- Payment method breakdown
SELECT
  pm.payment_method,
  SUM(pm.amount) AS total_amount,
  COUNT(*) AS transaction_count
FROM payments pm
JOIN transactions t ON t.id = pm.transaction_id
WHERE t.branch_id = 'nurse-branch-uuid'
  AND t.transaction_date = CURRENT_DATE
GROUP BY pm.payment_method;
```

---

### **Story 14: Accept Multiple Payment Methods**

**As a** nurse/cashier  
**I want to** accept different payment methods for a transaction  
**So that** patients can pay using their preferred method

**Acceptance Criteria**:

- Nurse creates transaction for patient
- System shows payment method options:
  - Cash
  - GCash
  - Maya
  - PayMongo (Credit/Debit Card)
  - Bank Transfer
  - Charge to Account (HMO/Corporate)
  - Check
- Nurse selects payment method
- For digital payments (GCash, Maya, PayMongo):
  - Nurse enters reference number
  - System validates reference format
- For Charge to Account:
  - Nurse selects payer (HMO or Corporate account)
  - Nurse enters authorization number
  - System marks transaction status as 'Partial' or 'Unpaid'
- For Check:
  - Nurse enters check number and bank name
- System records payment with selected method
- System prints receipt showing payment method

**Technical Notes**:

```sql
INSERT INTO payments (transaction_id, payment_method, amount, reference_number, payer_id, payment_date, received_by_id)
VALUES ('txn-uuid', 'GCash', 5000, 'GC-123456789', NULL, CURRENT_DATE, 'nurse-uuid');
```

---

### **Story 15: Process Split Payment**

**As a** nurse/cashier  
**I want to** accept multiple payment methods for a single transaction  
**So that** patients can split payment between cash and digital wallets

**Acceptance Criteria**:

- Nurse creates transaction with total amount P5,000
- Nurse clicks "Split Payment"
- System shows split payment form:
  - Payment 1: Method (dropdown), Amount (input)
  - Payment 2: Method (dropdown), Amount (input)
  - Add more payments (button)
- Patient wants to pay P3,000 cash + P2,000 GCash
- Nurse enters:
  - Payment 1: Cash, P3,000
  - Payment 2: GCash, P2,000, Reference: GC-123456
- System validates: SUM(payments) = transaction total
- If sum doesn't match, system shows error: "Total payments (P5,000) must equal transaction amount (P5,000)"
- System creates multiple payment records
- System updates transaction status to 'Paid'
- System prints receipt showing payment breakdown

**Technical Notes**:

```sql
-- Create multiple payments
INSERT INTO payments (transaction_id, payment_method, amount, reference_number, payment_date, received_by_id)
VALUES
  ('txn-uuid', 'Cash', 3000, NULL, CURRENT_DATE, 'nurse-uuid'),
  ('txn-uuid', 'GCash', 2000, 'GC-123456', CURRENT_DATE, 'nurse-uuid');

-- Validate total
SELECT
  t.total_net,
  SUM(p.amount) AS total_paid,
  t.total_net - SUM(p.amount) AS balance
FROM transactions t
LEFT JOIN payments p ON p.transaction_id = t.id
WHERE t.id = 'txn-uuid'
GROUP BY t.id, t.total_net;
```

---

### **Story 16: Pay for All Standing Order Doses Upfront**

**As a** nurse/cashier  
**I want to** allow patients to pay for all future doses on Day 0  
**So that** they don't need to pay on follow-up visits

**Acceptance Criteria**:

- Nurse starts encounter for new rabies patient
- Doctor orders "Rabies PEP Category III" (4 doses over 14 days)
- Nurse administers Day 0 services
- Nurse clicks "Create Transaction"
- System shows all clinical orders:
  - ✓ Day 0: Consultation (completed)
  - ✓ Day 0: Wound Cleaning (completed)
  - ✓ Day 0: ARV Dose 1 (completed)
  - ✓ Day 0: ERIG (completed)
  - ⏳ Day 3: ARV Dose 2 (pending)
  - ⏳ Day 7: ARV Dose 3 (pending)
  - ⏳ Day 14: ARV Dose 4 (pending)
- Nurse selects all items (Day 0 + future doses)
- System calculates total: P15,000
- System marks transaction as prepayment
- For each item:
  - Day 0 items: `is_prepaid = FALSE` (already completed)
  - Future items: `is_prepaid = TRUE`, `prepaid_for_date = scheduled_date`
- Patient pays P15,000
- System prints receipt showing:
  - Services completed today: P8,000
  - Services prepaid for future: P7,000
  - Next appointment: Day 3 (March 12)
- On Day 3, nurse sees "Already Paid" badge on order

**Technical Notes**:

```sql
-- Create transaction with prepayment flag
INSERT INTO transactions (reference_number, branch_id, patient_id, encounter_id, transaction_date, total_net, is_prepayment, status)
VALUES ('CNT-2026-0001', 'branch-uuid', 'patient-uuid', 'encounter-uuid', CURRENT_DATE, 15000, TRUE, 'Paid');

-- Create transaction items
INSERT INTO transaction_items (transaction_id, clinical_order_id, service_id, quantity, unit_price, subtotal, is_prepaid, prepaid_for_date)
VALUES
  -- Day 0 services (completed)
  ('txn-uuid', 'order-1-uuid', 'consultation-uuid', 1, 500, 500, FALSE, NULL),
  ('txn-uuid', 'order-2-uuid', 'wound-cleaning-uuid', 1, 300, 300, FALSE, NULL),
  ('txn-uuid', 'order-3-uuid', 'arv-dose-1-uuid', 1, 3000, 3000, FALSE, NULL),
  ('txn-uuid', 'order-4-uuid', 'erig-uuid', 1, 4200, 4200, FALSE, NULL),
  -- Future services (prepaid)
  ('txn-uuid', 'order-5-uuid', 'arv-dose-2-uuid', 1, 3000, 3000, TRUE, '2026-03-12'),
  ('txn-uuid', 'order-6-uuid', 'arv-dose-3-uuid', 1, 2000, 2000, TRUE, '2026-03-16'),
  ('txn-uuid', 'order-7-uuid', 'arv-dose-4-uuid', 1, 2000, 2000, TRUE, '2026-03-23');
```

---

### **Story 17: Apply Senior Citizen Discount**

**As a** nurse/cashier  
**I want to** apply senior citizen discount correctly  
**So that** we comply with Philippine law (RA 9994)

**Acceptance Criteria**:

- Nurse creates transaction for patient aged 60+
- System detects patient age and shows "Senior Citizen Discount Available"
- Nurse clicks "Apply Senior Discount"
- System prompts for OSCA ID number
- Nurse enters OSCA ID: "QC-2024-123456"
- System calculates discount:
  - Base price: P5,000
  - Strip 12% VAT: P5,000 / 1.12 = P4,464.29
  - Apply 20% discount: P4,464.29 × 0.80 = P3,571.43
  - Final amount: P3,571.43
  - Total discount: P1,428.57
- System updates transaction:
  - `total_gross = 5000`
  - `total_vat_exempt = 4464.29`
  - `total_discount = 1428.57`
  - `total_net = 3571.43`
  - `discount_id_type = 'Senior_Citizen'`
  - `discount_id_number = 'QC-2024-123456'`
- System prints receipt showing:
  - Gross amount: P5,000.00
  - Less: VAT Exempt (12%): P535.71
  - Less: Senior Discount (20%): P892.86
  - Net amount: P3,571.43
  - OSCA ID: QC-2024-123456

**Technical Notes**:

```sql
-- Calculate senior discount
-- Formula: (base_price / 1.12) * 0.80
UPDATE transactions
SET total_vat_exempt = total_gross / 1.12,
    total_discount = (total_gross / 1.12) * 0.20,
    total_net = (total_gross / 1.12) * 0.80,
    discount_id_type = 'Senior_Citizen',
    discount_id_number = 'QC-2024-123456'
WHERE id = 'txn-uuid';
```

---

### **Story 18: Apply PWD Discount**

**As a** nurse/cashier  
**I want to** apply PWD (Person with Disability) discount correctly  
**So that** we comply with Philippine law (RA 10754)

**Acceptance Criteria**:

- Nurse creates transaction for PWD patient
- Nurse clicks "Apply PWD Discount"
- System prompts for PWD ID number
- Nurse enters PWD ID: "PWD-QC-2024-789"
- System calculates discount (same formula as senior):
  - Base price: P5,000
  - Strip 12% VAT: P5,000 / 1.12 = P4,464.29
  - Apply 20% discount: P4,464.29 × 0.80 = P3,571.43
- System updates transaction with discount details
- System prints receipt showing PWD ID number

---

### **Story 19: Apply HMO/Corporate Discount**

**As a** nurse/cashier  
**I want to** apply HMO or corporate pricing  
**So that** we can bill according to negotiated rates

**Acceptance Criteria**:

- Nurse creates transaction
- Nurse clicks "Apply Payer Discount"
- System shows list of payer profiles:
  - Maxicare HMO
  - PhilCare HMO
  - ABC Corporation
  - Government Employee Program
- Nurse selects payer (e.g., "Maxicare HMO")
- System applies payer-specific pricing from payer_profiles
- For HMO with markup: Base price × 1.15 (15% markup for delayed payment)
- For Corporate with discount: Base price × 0.90 (10% discount)
- Nurse enters authorization number
- System marks transaction as "Charge to Account"
- System updates transaction status to 'Unpaid' or 'Partial'
- System prints receipt showing payer name and auth number

**Technical Notes**:

```sql
-- Get payer pricing
SELECT
  pp.name,
  pp.payer_type,
  pp.payment_terms_days,
  -- Apply payer-specific pricing logic
  CASE
    WHEN pp.payer_type = 'HMO' THEN sc.base_price * 1.15
    WHEN pp.payer_type = 'Corporate' THEN sc.base_price * 0.90
    ELSE sc.base_price
  END AS adjusted_price
FROM payer_profiles pp
CROSS JOIN service_catalog sc
WHERE pp.id = 'payer-uuid';
```

---

### **Story 20: Collect Partial Payment**

**As a** nurse/cashier  
**I want to** accept partial payment from a patient  
**So that** they can pay the balance later

**Acceptance Criteria**:

- Nurse creates transaction with total P5,000
- Patient can only pay P3,000 today
- Nurse enters payment: Cash, P3,000
- System calculates balance: P2,000
- System updates transaction status to 'Partial'
- System prints receipt showing:
  - Total amount: P5,000
  - Amount paid: P3,000
  - Balance due: P2,000
- When patient returns to pay balance:
  - Nurse searches for transaction by reference number
  - Nurse clicks "Add Payment"
  - Nurse enters: Cash, P2,000
  - System validates: total payments = transaction total
  - System updates transaction status to 'Paid'
  - System prints receipt for balance payment

**Technical Notes**:

```sql
-- Check payment status
SELECT
  t.reference_number,
  t.total_net,
  COALESCE(SUM(p.amount), 0) AS total_paid,
  t.total_net - COALESCE(SUM(p.amount), 0) AS balance,
  CASE
    WHEN COALESCE(SUM(p.amount), 0) = 0 THEN 'Unpaid'
    WHEN COALESCE(SUM(p.amount), 0) < t.total_net THEN 'Partial'
    WHEN COALESCE(SUM(p.amount), 0) = t.total_net THEN 'Paid'
    ELSE 'Overpaid'
  END AS payment_status
FROM transactions t
LEFT JOIN payments p ON p.transaction_id = t.id
WHERE t.id = 'txn-uuid'
GROUP BY t.id, t.reference_number, t.total_net;
```

---

### **Story 21: Log Payment with Receipt**

**As a** nurse/cashier  
**I want to** log payment and print official receipt  
**So that** we have proper documentation for BIR compliance

**Acceptance Criteria**:

- Nurse completes payment collection
- System generates unique reference number: {BRANCH_CODE}-{YEAR}-{SEQUENCE}
  - Example: "CNT-2026-00123"
- System creates payment record with:
  - Transaction ID
  - Payment method
  - Amount
  - Reference number (for digital payments)
  - Payment date
  - Received by (nurse ID)
- System prints BIR-compliant receipt with:
  - Clinic name and TIN
  - Branch address
  - Receipt number
  - Date and time
  - Patient name
  - Services rendered (itemized)
  - Gross amount
  - Discounts (if any) with ID number
  - VAT breakdown
  - Net amount
  - Payment method
  - Received by (nurse name)
  - "This serves as your official receipt"
- System logs transaction in audit_logs
- Receipt is stored in electronic journal (e-journal)

**Technical Notes**:

```sql
-- Generate reference number
SELECT
  b.code || '-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' ||
  LPAD(NEXTVAL('transaction_sequence')::TEXT, 5, '0') AS reference_number
FROM branches b
WHERE b.id = 'branch-uuid';

-- Create payment
INSERT INTO payments (transaction_id, payment_method, amount, reference_number, payment_date, received_by_id)
VALUES ('txn-uuid', 'Cash', 5000, NULL, CURRENT_DATE, 'nurse-uuid');

-- Update transaction status
UPDATE transactions
SET status = 'Paid'
WHERE id = 'txn-uuid';

-- Log in audit
INSERT INTO audit_logs (user_id, action, entity_type, entity_id, changes)
VALUES (
  'nurse-uuid',
  'PAYMENT_RECEIVED',
  'Payment',
  'payment-uuid',
  '{"amount": 5000, "method": "Cash", "transaction_ref": "CNT-2026-00123"}'::jsonb
);
```

---

### **Story 22: Handle Cash Change Calculation**

**As a** nurse/cashier  
**I want to** calculate change automatically  
**So that** I don't make errors in cash handling

**Acceptance Criteria**:

- Transaction total: P3,571.43
- Nurse enters "Amount Tendered": P4,000
- System calculates change: P428.57
- System displays prominently: "CHANGE: P428.57"
- Nurse gives change to patient
- System records:
  - Payment amount: P3,571.43 (transaction total, not tendered amount)
  - Payment method: Cash
- Receipt shows:
  - Amount due: P3,571.43
  - Amount tendered: P4,000.00
  - Change: P428.57

---

### **Story 23: Void Transaction**

**As a** nurse/cashier  
**I want to** void a transaction if created in error  
**So that** financial records remain accurate

**Acceptance Criteria**:

- Nurse realizes transaction was created in error
- Nurse searches for transaction by reference number
- Nurse clicks "Void Transaction"
- System prompts for:
  - Reason for void (required)
  - Manager approval (required for amounts > P1,000)
- Nurse enters reason: "Duplicate transaction created"
- System updates transaction:
  - `status = 'Voided'`
  - `voided_at = NOW()`
  - `voided_by_id = nurse-uuid`
  - `void_reason = reason`
- System logs in audit_logs with full transaction details
- System does NOT delete transaction (for audit trail)
- Voided transaction appears in reports with "VOIDED" label
- System can generate void report for BIR compliance

**Technical Notes**:

```sql
UPDATE transactions
SET status = 'Voided',
    voided_at = NOW(),
    voided_by_id = 'nurse-uuid',
    void_reason = 'Duplicate transaction created'
WHERE id = 'txn-uuid';

-- Log void
INSERT INTO audit_logs (user_id, action, entity_type, entity_id, changes)
VALUES (
  'nurse-uuid',
  'TRANSACTION_VOID',
  'Transaction',
  'txn-uuid',
  '{
    "reference_number": "CNT-2026-00123",
    "original_amount": 5000,
    "reason": "Duplicate transaction created",
    "voided_at": "2026-03-09T15:30:00Z"
  }'::jsonb
);
```

---

### **Story 24: Process Refund**

**As a** nurse/cashier  
**I want to** process refunds for cancelled services  
**So that** patients are reimbursed correctly

**Acceptance Criteria**:

- Patient paid P15,000 for full rabies protocol
- Patient decides to discontinue after Day 3
- Nurse calculates refund:
  - Total paid: P15,000
  - Services completed: P8,000 (Day 0 + Day 3)
  - Refund amount: P7,000
- Nurse clicks "Process Refund"
- System shows refund form:
  - Original transaction reference
  - Original amount paid
  - Services to refund (checkboxes)
  - Refund amount (calculated)
  - Refund method (Cash, Bank Transfer, etc.)
  - Reason (required)
- Nurse selects services to refund
- System creates refund transaction:
  - Negative transaction amount: -P7,000
  - Links to original transaction
  - Status: 'Refunded'
- System updates original transaction status to 'Refunded'
- System prints refund receipt
- System logs refund in audit_logs
- Requires manager approval for refunds > P5,000

**Technical Notes**:

```sql
-- Create refund transaction
INSERT INTO transactions (reference_number, branch_id, patient_id, transaction_date, total_net, status)
VALUES ('CNT-2026-00124-REFUND', 'branch-uuid', 'patient-uuid', CURRENT_DATE, -7000, 'Refunded');

-- Link to original transaction in audit log
INSERT INTO audit_logs (user_id, action, entity_type, entity_id, changes)
VALUES (
  'nurse-uuid',
  'REFUND_PROCESSED',
  'Transaction',
  'refund-txn-uuid',
  '{
    "original_transaction": "CNT-2026-00123",
    "original_amount": 15000,
    "refund_amount": 7000,
    "reason": "Patient discontinued protocol",
    "approved_by": "manager-uuid"
  }'::jsonb
);
```

---

### **Story 25: View Transaction History for Patient**

**As a** nurse/cashier  
**I want to** view all transactions for a patient  
**So that** I can see their payment history

**Acceptance Criteria**:

- Nurse views patient record
- Nurse clicks "Transaction History"
- System shows list of all transactions:
  - Reference number
  - Date
  - Services
  - Total amount
  - Payment method(s)
  - Status (Paid, Partial, Unpaid, Voided, Refunded)
  - Balance (if any)
- Nurse can click on transaction to see full details
- Nurse can print receipt copy
- Nurse can see prepaid services and their scheduled dates

---

### **Staff Management**

### **Story 26: Time In and Time Out from System**

**As a** nurse  
**I want to** clock in when I start my shift and clock out when I end  
**So that** my working hours are tracked for payroll

**Acceptance Criteria**:

- Nurse logs into system
- System shows "Clock In" button if not already clocked in
- Nurse clicks "Clock In"
- System records timestamp in staff_time_logs
- System shows "Currently Clocked In" status with elapsed time
- When shift ends, nurse clicks "Clock Out"
- System prompts for optional notes
- System calculates total hours worked
- System shows summary: "You worked 8.5 hours today"

**Technical Notes**:

```sql
-- Clock in
INSERT INTO staff_time_logs (user_id, branch_id, clock_in_at)
VALUES ('nurse-uuid', 'branch-uuid', NOW());

-- Clock out
UPDATE staff_time_logs
SET clock_out_at = NOW(),
    total_hours = EXTRACT(EPOCH FROM (NOW() - clock_in_at)) / 3600
WHERE user_id = 'nurse-uuid' AND clock_out_at IS NULL;
```

---

### **Story 27: Request Overtime**

**As a** nurse  
**I want to** request overtime approval if I worked more than 8.5 hours  
**So that** I can be compensated for extra hours

**Acceptance Criteria**:

- Nurse clocks out after working 9.5 hours
- System detects total_hours > 8.5
- System shows "Overtime Detected: 1.0 hours"
- System prompts: "Request overtime approval?"
- Nurse clicks "Request Overtime"
- System shows overtime request form:
  - Overtime hours: 1.0 (auto-filled)
  - Reason: (text field - e.g., "High patient volume")
  - Approved by: (manager dropdown)
- Nurse submits request
- System logs in audit_logs:
  ```json
  {
    "action": "OVERTIME_REQUEST",
    "entity_type": "StaffTimeLog",
    "entity_id": "time-log-uuid",
    "changes": {
      "overtime_hours": 1.0,
      "reason": "High patient volume",
      "status": "Pending",
      "requested_by": "nurse-uuid",
      "requested_at": "2026-03-09T18:30:00Z"
    }
  }
  ```
- System sends notification to branch manager
- Manager reviews and approves/denies
- System updates time log notes with approval status

---

### **Scheduling & Protocol Management**

### **Story 28: Auto-Reschedule When Patient Delayed**

**As a** nurse  
**I want to** have the system automatically reschedule future appointments when a patient is delayed  
**So that** protocol intervals are maintained correctly

**Acceptance Criteria**:

- Patient scheduled for Day 3 (March 12) arrives on Day 5 (March 14)
- Nurse administers late dose
- System calculates delay: 2 days
- System automatically updates all future appointments:
  - Day 7 appointment: March 16 → March 18
  - Day 14 appointment: March 23 → March 25
- System updates patient_standing_orders.current_end_date
- System logs change in audit_logs
- System sends updated SMS reminders with new dates
- Nurse sees confirmation: "Future appointments rescheduled due to 2-day delay"

**Technical Notes**:

```sql
-- Calculate delay
SELECT EXTRACT(DAY FROM (NOW()::date - original_scheduled_date)) AS delay_days
FROM clinical_orders WHERE id = 'order-uuid';

-- Update future orders
UPDATE clinical_orders
SET current_scheduled_date = original_scheduled_date + INTERVAL '2 days',
    due_date = original_scheduled_date + INTERVAL '5 days'
WHERE standing_order_id = 'pso-uuid'
  AND status = 'Pending'
  AND original_scheduled_date > CURRENT_DATE;
```

---

### **Cross-Branch Operations**

### **Story 29: Request Patient Data from Another Branch**

**As a** nurse  
**I want to** request access to a patient's data from another branch  
**So that** I can provide care when they visit my branch

**Acceptance Criteria**:

- Nurse searches for patient
- System shows "Patient not found in your branch"
- System shows "Search Other Branches" button
- Nurse clicks and finds patient in different branch
- Nurse clicks "Request Access"
- System prompts for reason (e.g., "Emergency dose needed")
- System logs request in audit_logs
- System sends notification to patient's home branch manager
- Manager approves request
- Nurse receives notification and can now view patient data
- Access is time-limited (24 hours by default)
- All access is logged for audit purposes

---

### **Transaction Management**

### **Story 30: Request to Edit Transaction Details**

**As a** nurse  
**I want to** request changes to transaction details  
**So that** errors can be corrected with proper approval

**Acceptance Criteria**:

- Nurse searches for transaction by reference number
- Nurse clicks "Request Modification"
- System shows modification options:
  - Change payment method
  - Update payment reference number
  - Adjust discount
  - Void transaction
  - Delete transaction (requires special approval)
- Nurse selects modification type and provides:
  - Current value
  - New value
  - Reason for change
- System logs request in audit_logs with status='Pending'
- System sends notification to branch manager
- Manager reviews and approves/denies
- If approved, system applies changes and updates audit log
- Nurse receives notification of approval/denial

**Technical Notes**:

```sql
-- Log modification request
INSERT INTO audit_logs (user_id, action, entity_type, entity_id, changes)
VALUES (
  'nurse-uuid',
  'TRANSACTION_MODIFY',
  'Transaction',
  'txn-uuid',
  '{
    "modification_type": "payment_method_change",
    "old_value": {"method": "Cash", "amount": 5000},
    "new_value": {"method": "GCash", "amount": 5000, "reference": "GC-123456"},
    "reason": "Patient requested change",
    "status": "Pending"
  }'::jsonb
);
```

---

## **As an Admin**

### **Story 31: Approve/Deny Data Transfer Requests**

**As an** admin  
**I want to** review and approve cross-branch data access requests  
**So that** patient privacy is protected while enabling necessary care

**Acceptance Criteria**:

- Admin receives notification of data access request
- Admin clicks "Review Request"
- System shows request details:
  - Requesting nurse name and branch
  - Patient name and home branch
  - Reason for request
  - Request timestamp
- Admin can:
  - Approve (with time limit: 24h, 48h, 1 week)
  - Deny (with reason)
  - Request more information
- If approved:
  - System grants access for specified duration
  - System logs approval in audit_logs
  - Requesting nurse receives notification
- If denied:
  - System logs denial with reason
  - Requesting nurse receives notification with reason

---

### **Story 32: Approve/Deny Transaction Modification Requests**

**As an** admin  
**I want to** review and approve transaction modification requests  
**So that** financial records remain accurate and auditable

**Acceptance Criteria**:

- Admin receives notification of transaction modification request
- Admin clicks "Review Request"
- System shows:
  - Transaction details (reference number, date, amount, patient)
  - Modification type
  - Current value vs. new value
  - Reason provided by nurse
  - Requesting nurse name
- Admin can:
  - Approve modification
  - Deny modification (with reason)
  - Request clarification
- If approved:
  - System applies changes to transaction/payment
  - System logs approval in audit_logs
  - Original values preserved in audit log
  - Requesting nurse receives notification
- If denied:
  - System logs denial with reason
  - Requesting nurse receives notification

---

### **Story 33: Edit Anything and See Everything**

**As an** admin  
**I want to** have unrestricted access to edit and view all data  
**So that** I can manage the system and resolve issues

**Acceptance Criteria**:

- Admin can access all branches (not restricted to home branch)
- Admin can view all patient records across branches
- Admin can edit any patient, encounter, transaction, or order
- Admin can view all audit logs
- Admin can manage users (create, edit, deactivate)
- Admin can configure system settings:
  - Branch details
  - Service catalog
  - Standing order templates
  - Payer profiles
  - Feature flags
- All admin actions are logged in audit_logs with action='ADMIN_EDIT'

---

### **Story 34: View Dashboards**

**As an** admin  
**I want to** view comprehensive dashboards  
**So that** I can monitor clinic performance and make data-driven decisions

**Acceptance Criteria**:

- Admin clicks "Dashboard"
- System shows multiple dashboard views:

  **Overview Dashboard**:
  - Total patients (all branches)
  - Total encounters today
  - Total revenue today
  - Active standing orders
  - Pending appointments

  **Financial Dashboard**:
  - Revenue by branch (chart)
  - Revenue by service type (chart)
  - Payment method breakdown (pie chart)
  - Outstanding receivables (HMO/Corporate)
  - Discount analysis (Senior/PWD)

  **Clinical Dashboard**:
  - Encounters by type (Initial, Follow-Up, Emergency)
  - Protocol completion rates
  - Missed appointments by branch
  - Average wait time

  **Inventory Dashboard**:
  - Stock levels by item
  - Items expiring soon
  - Items out of stock
  - Inventory value

  **Staff Dashboard**:
  - Staff attendance
  - Overtime hours
  - Productivity metrics (encounters per staff)
  - Performance trends

- Admin can filter by date range, branch, or service type
- Admin can export dashboard data to PDF or Excel

---

## **As the System**

### **Story 35: Audit Log Important Events**

**As the** system  
**I want to** automatically log important events  
**So that** there is a complete audit trail without cluttering the database

**Acceptance Criteria**:

- System logs the following events in audit_logs:

  **Security Events** (always log):
  - User login/logout
  - Failed login attempts
  - Password changes
  - Cross-branch data access
  - Admin privilege usage

  **Financial Events** (always log):
  - Transaction creation
  - Payment recording
  - Transaction modifications (requests and approvals)
  - Refunds/voids
  - Discount applications

  **Clinical Events** (selective logging):
  - Standing order creation
  - Protocol modifications
  - Missed dose rescheduling
  - Clinical order status changes (Pending → Completed)
  - Encounter creation (log summary, not every field change)

  **Data Events** (always log):
  - Patient record creation
  - Patient record modifications (log what changed)
  - Cross-branch access requests and approvals
  - Data export operations

  **System Events** (selective logging):
  - Feature flag changes
  - Service catalog updates
  - User role changes
  - System configuration changes

- System does NOT log:
  - Every database read operation
  - UI navigation events
  - Search queries
  - Report generation (unless exporting sensitive data)
  - Routine status checks

- Audit logs include:
  - User ID (who)
  - Action type (what)
  - Entity type and ID (which record)
  - Timestamp (when)
  - IP address (from where)
  - Changes (before/after values in JSONB)

**Technical Notes**:

```sql
-- Example: Log transaction modification
INSERT INTO audit_logs (user_id, action, entity_type, entity_id, branch_id, ip_address, changes)
VALUES (
  'user-uuid',
  'TRANSACTION_MODIFY',
  'Payment',
  'payment-uuid',
  'branch-uuid',
  '192.168.1.100',
  '{
    "field": "payment_method",
    "old_value": "Cash",
    "new_value": "GCash",
    "reason": "Patient requested change",
    "approved_by": "admin-uuid"
  }'::jsonb
);
```

---

## **Additional Recommended User Stories**

### **Patient Portal & Self-Service**

### **Story 24: Patient Views Own Records Online**

**As a** patient  
**I want to** view my vaccination history and upcoming appointments online  
**So that** I can track my treatment without calling the clinic

**Acceptance Criteria**:

- Patient creates account on patient portal
- Patient verifies identity (OTP via SMS)
- Patient logs in and sees dashboard:
  - Vaccination history with dates and vaccine brands
  - Upcoming appointments
  - Lab results (if available)
  - Transaction history
- Patient can download vaccination certificate (PDF)
- Patient can request appointment rescheduling
- Patient can update contact information

---

### **Story 25: Patient Books Appointment Online**

**As a** patient  
**I want to** book appointments online  
**So that** I don't have to call or visit the clinic

**Acceptance Criteria**:

- Patient logs into portal
- Patient clicks "Book Appointment"
- System shows available services and time slots
- Patient selects service, date, and time
- System creates pending appointment
- Clinic staff receives notification to confirm
- Patient receives SMS confirmation when approved

---

### **Inventory & Supply Chain**

### **Story 26: System Alerts for Low Stock**

**As the** system  
**I want to** automatically alert staff when inventory is low  
**So that** critical supplies don't run out

**Acceptance Criteria**:

- System checks inventory levels daily
- When quantity_on_hand < reorder_threshold:
  - System creates alert notification
  - System sends email to branch manager
  - Alert appears in dashboard
- Alert shows:
  - Item name
  - Current quantity
  - Reorder threshold
  - Recommended order quantity
  - Supplier information

---

### **Story 27: Track Vaccine Cold Chain**

**As a** nurse  
**I want to** track vaccine storage temperatures  
**So that** we ensure vaccine efficacy and DOH compliance

**Acceptance Criteria**:

- System integrates with temperature monitoring device
- System logs temperature readings every 15 minutes
- If temperature goes outside range (2-8°C):
  - System creates alert
  - System sends SMS to nurse on duty
  - System logs incident in audit_logs
- Nurse can view temperature history chart
- System generates cold chain compliance reports for DOH

---

### **Reporting & Analytics**

### **Story 28: Generate DOH Compliance Reports**

**As an** admin  
**I want to** generate DOH-required reports automatically  
**So that** we maintain regulatory compliance

**Acceptance Criteria**:

- Admin clicks "DOH Reports"
- System shows report types:
  - NaRIS (National Rabies Information System) export
  - PIDSR (Disease Surveillance) export
  - Vaccine utilization report
  - Adverse event reports
- Admin selects report type and date range
- System generates report in required format (CSV, XML, PDF)
- Admin can download or submit electronically to DOH

---

### **Story 29: Analyze Protocol Completion Rates**

**As an** admin  
**I want to** analyze protocol completion rates  
**So that** I can identify patients at risk of non-compliance

**Acceptance Criteria**:

- Admin clicks "Protocol Analytics"
- System shows:
  - Overall completion rate (e.g., 85%)
  - Completion rate by protocol type
  - Patients with incomplete protocols
  - Common drop-off points (e.g., most patients miss Day 14)
  - Reasons for non-completion (missed appointments, patient choice, etc.)
- Admin can filter by branch, date range, or protocol type
- System highlights patients needing follow-up outreach

---

### **Quality & Safety**

### **Story 30: Flag Potential Drug Interactions**

**As the** system  
**I want to** flag potential drug interactions  
**So that** patient safety is ensured

**Acceptance Criteria**:

- Nurse orders medication for patient
- System checks patient's current medications and allergies
- If potential interaction detected:
  - System shows warning dialog
  - System explains interaction (e.g., "Aspirin + Warfarin: Increased bleeding risk")
  - System requires nurse to acknowledge warning
  - System logs warning in audit_logs
- Nurse can proceed with caution or consult doctor

---

## **Summary of User Stories**

### **As a Nurse** (30 stories)

1. Create and view patients
2. Edit patient details
3. Add general remarks to patients
4. Log patient visits
5. View patient visit history
6. See upcoming appointments for branch
7. Create appointment details easily
8. See missed appointments and send reminders
9. Start encounter from appointment with pre-filled fields
10. Use common standing orders/bundles easily
11. Click human body map for bite location (rabies)
12. Create transactions from appointments easily
13. Generate daily branch report
14. Accept multiple payment methods
15. Process split payment
16. Pay for all standing order doses upfront
17. Apply senior citizen discount
18. Apply PWD discount
19. Apply HMO/corporate discount
20. Collect partial payment
21. Log payment with receipt
22. Handle cash change calculation
23. Void transaction
24. Process refund
25. View transaction history for patient
26. Time in and time out
27. Request overtime
28. Auto-reschedule when patient delayed
29. Request patient data from another branch
30. Request to edit transaction details

### **As an Admin** (4 stories)

31. Approve/deny data transfer requests
32. Approve/deny transaction modification requests
33. Edit anything and see everything
34. View comprehensive dashboards

### **As the System** (1 story)

35. Audit log important events (not too cluttered)

### **Additional Recommended** (7 stories)

36. Patient views own records online
37. Patient books appointment online
38. System alerts for low stock
39. Track vaccine cold chain
40. Generate DOH compliance reports
41. Analyze protocol completion rates
42. Flag potential drug interactions

**Total**: 42 user stories covering comprehensive clinic operations including detailed payment and transaction workflows

---

**Last Updated**: March 9, 2026  
**Status**: Ready for implementation planning
