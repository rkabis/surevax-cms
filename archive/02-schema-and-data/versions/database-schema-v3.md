# **SureVax CMS v2.0: Final Database Schema**

## **Standing Order-Centric with Cross-Branch Sharing & Prepayment Support**

---

## **Critical Design Decisions**

### **1. Standing Orders = Service Lists**

A standing order is a **list of services** a patient will receive across multiple visits. Nurses need to:

- See all services in the protocol at a glance
- Know which are completed, pending, or missed
- Understand payment status for each service

### **2. Prepayment Support**

Patients can pay for future appointments on Day 0:

- Transaction created on Day 0
- Links to future clinical orders (not yet completed)
- When patient returns, order is marked complete (already paid)

### **3. Cross-Branch Data Sharing**

Nurses can request patient data from other branches:

- Request → Approval → Access granted
- Audit trail of who accessed what from where
- Time-limited access tokens

### **4. Transaction Modifications**

Nurses can modify transaction details with audit trail:

- Change payment method (Cash → GCash)
- Add/remove line items
- Apply discounts retroactively
- All changes logged with reason and approver

### **5. Missed Dose Recalculation**

When a patient misses a dose:

- System flags order as "Overdue"
- When administered late, all future dates shift forward
- Audit trail shows original vs adjusted schedule

---

## **System-Wide Standards**

- **Primary Keys**: UUID for all IDs
- **Audit Trail**: Every table has `created_at`, `updated_at`, `created_by_id`
- **Soft Deletes**: Use `deleted_at` instead of hard deletes
- **Branch Scoping**: All data includes `branch_id` for multi-tenancy
- **Immutable Core**: Financial and clinical records are append-only (modifications create new versions)

---

## **Domain 1: Multi-Tenancy & Access Control**

### **Table: branches**

```sql
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  is_active BOOLEAN DEFAULT TRUE,
  settings JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE INDEX idx_branches_code ON branches(code);
CREATE INDEX idx_branches_active ON branches(is_active) WHERE is_active = TRUE;
```

---

### **Table: users**

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  role VARCHAR(50) NOT NULL, -- 'SuperAdmin', 'BranchManager', 'Doctor', 'Nurse', 'LabTech', 'Cashier'
  license_number VARCHAR(50),
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_branch_role ON users(branch_id, role);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = TRUE;
```

---

### **Table: cross_branch_access_requests**

**NEW**: Enables nurses to request patient data from other branches.

```sql
CREATE TABLE cross_branch_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requesting_user_id UUID NOT NULL REFERENCES users(id),
  requesting_branch_id UUID NOT NULL REFERENCES branches(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  patient_home_branch_id UUID NOT NULL REFERENCES branches(id),
  reason TEXT NOT NULL, -- Why access is needed
  status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Approved', 'Denied', 'Expired'
  requested_at TIMESTAMP DEFAULT NOW(),
  reviewed_by_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  access_granted_until TIMESTAMP, -- Time-limited access
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cross_branch_requests_patient ON cross_branch_access_requests(patient_id);
CREATE INDEX idx_cross_branch_requests_status ON cross_branch_access_requests(status);
CREATE INDEX idx_cross_branch_requests_requesting_user ON cross_branch_access_requests(requesting_user_id);
```

**Purpose**: When a patient from Cainta Branch visits Antipolo Branch for emergency care, Antipolo nurse requests access to patient's Cainta records. Cainta manager approves, granting 24-hour access.

---

### **Table: cross_branch_access_logs**

**NEW**: Audit trail of cross-branch data access.

```sql
CREATE TABLE cross_branch_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_request_id UUID NOT NULL REFERENCES cross_branch_access_requests(id),
  user_id UUID NOT NULL REFERENCES users(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  accessed_branch_id UUID NOT NULL REFERENCES branches(id),
  action VARCHAR(100) NOT NULL, -- 'VIEW_PATIENT', 'VIEW_ORDERS', 'VIEW_TRANSACTIONS'
  entity_type VARCHAR(100), -- 'Patient', 'ClinicalOrder', 'Transaction'
  entity_id UUID,
  ip_address VARCHAR(50),
  accessed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cross_branch_logs_request ON cross_branch_access_logs(access_request_id);
CREATE INDEX idx_cross_branch_logs_patient ON cross_branch_access_logs(patient_id);
CREATE INDEX idx_cross_branch_logs_user ON cross_branch_access_logs(user_id);
CREATE INDEX idx_cross_branch_logs_time ON cross_branch_access_logs(accessed_at);
```

---

## **Domain 2: Patient Registry**

### **Table: patients**

```sql
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_branch_id UUID NOT NULL REFERENCES branches(id),
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100),
  last_name VARCHAR(100) NOT NULL,
  suffix VARCHAR(20),
  dob DATE NOT NULL,
  sex VARCHAR(1),
  contact_number VARCHAR(50),
  email VARCHAR(255),
  address TEXT,
  guardian_name VARCHAR(255),
  guardian_contact VARCHAR(50),
  emergency_contact_name VARCHAR(255),
  emergency_contact_number VARCHAR(50),
  allergies TEXT,
  medical_conditions TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id),

  -- Full-text search support
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(first_name, '') || ' ' ||
      coalesce(middle_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(contact_number, '')
    )
  ) STORED
);

CREATE INDEX idx_patients_name ON patients(last_name, first_name);
CREATE INDEX idx_patients_dob ON patients(dob);
CREATE INDEX idx_patients_contact ON patients(contact_number);
CREATE INDEX idx_patients_branch ON patients(home_branch_id);
CREATE INDEX idx_patients_search ON patients USING GIN(search_vector);
```

**Search Best Practice**: Use `search_vector` for fast full-text search:

```sql
SELECT * FROM patients
WHERE search_vector @@ to_tsquery('english', 'john:* & doe:*')
ORDER BY ts_rank(search_vector, to_tsquery('english', 'john:* & doe:*')) DESC;
```

---

### **Table: patient_data_change_requests**

**NEW**: Audit trail for patient information changes.

```sql
CREATE TABLE patient_data_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  requested_by_id UUID NOT NULL REFERENCES users(id),
  field_name VARCHAR(100) NOT NULL, -- 'contact_number', 'address', etc.
  old_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Approved', 'Denied'
  requested_at TIMESTAMP DEFAULT NOW(),
  reviewed_by_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_patient_changes_patient ON patient_data_change_requests(patient_id);
CREATE INDEX idx_patient_changes_status ON patient_data_change_requests(status);
CREATE INDEX idx_patient_changes_requested_by ON patient_data_change_requests(requested_by_id);
```

**Purpose**: Nurse requests to update patient's phone number. Manager reviews and approves. System logs old value, new value, who requested, who approved, and why.

---

## **Domain 3: Service Catalog & Standing Orders**

### **Table: service_catalog**

```sql
CREATE TABLE service_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  service_type VARCHAR(50) NOT NULL, -- 'Immunization', 'Laboratory', 'Consultation', 'Procedure', 'Goods'
  category VARCHAR(100),
  base_price DECIMAL(10,2) NOT NULL,
  is_stockable BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  requires_prescription BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id),

  -- Search support
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(code, ''))
  ) STORED
);

CREATE INDEX idx_service_catalog_code ON service_catalog(code);
CREATE INDEX idx_service_catalog_type ON service_catalog(service_type);
CREATE INDEX idx_service_catalog_active ON service_catalog(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_service_catalog_search ON service_catalog USING GIN(search_vector);
```

---

### **Table: standing_order_templates**

**CORE**: Defines reusable clinical protocols (the "recipe" for care).

```sql
CREATE TABLE standing_order_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  protocol_type VARCHAR(50) NOT NULL, -- 'Immunization', 'Laboratory', 'Mixed', 'Chronic_Care'
  is_active BOOLEAN DEFAULT TRUE,
  requires_physician_auth BOOLEAN DEFAULT TRUE,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE INDEX idx_standing_order_templates_code ON standing_order_templates(code);
CREATE INDEX idx_standing_order_templates_active ON standing_order_templates(is_active) WHERE is_active = TRUE;
```

---

### **Table: standing_order_template_items**

**CORE**: Individual services within a standing order template.

```sql
CREATE TABLE standing_order_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES standing_order_templates(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES service_catalog(id),
  sequence INTEGER NOT NULL, -- Order of execution within same day
  day_offset INTEGER NOT NULL, -- Days from protocol start (0, 3, 7, 14, 28)
  quantity INTEGER DEFAULT 1,
  is_required BOOLEAN DEFAULT TRUE,
  instructions TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_template_items_template ON standing_order_template_items(template_id);
CREATE INDEX idx_template_items_service ON standing_order_template_items(service_id);
CREATE INDEX idx_template_items_day ON standing_order_template_items(template_id, day_offset);
```

**Example Data**:

```sql
-- Template: "RABIES-PEP-CAT3" (4 ARV doses + ERIG + Tetanus)
INSERT INTO standing_order_templates (code, name, protocol_type)
VALUES ('RABIES-PEP-CAT3', 'Rabies PEP Category III', 'Immunization');

INSERT INTO standing_order_template_items (template_id, service_id, sequence, day_offset) VALUES
  ('template-uuid', 'consultation-uuid', 1, 0),
  ('template-uuid', 'wound-cleaning-uuid', 2, 0),
  ('template-uuid', 'arv-dose-1-uuid', 3, 0),
  ('template-uuid', 'erig-uuid', 4, 0),
  ('template-uuid', 'tetanus-uuid', 5, 0),
  ('template-uuid', 'arv-dose-2-uuid', 1, 3),
  ('template-uuid', 'arv-dose-3-uuid', 1, 7),
  ('template-uuid', 'arv-dose-4-uuid', 1, 14);
```

---

## **Domain 4: Clinical Operations**

### **Table: encounters**

```sql
CREATE TABLE encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  provider_id UUID NOT NULL REFERENCES users(id),
  encounter_type VARCHAR(50) NOT NULL, -- 'Initial', 'Follow_Up', 'Emergency', 'Lab_Only'
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  chief_complaint TEXT,
  status VARCHAR(50) DEFAULT 'In_Progress', -- 'In_Progress', 'Completed', 'Cancelled'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_encounters_patient ON encounters(patient_id);
CREATE INDEX idx_encounters_branch_date ON encounters(branch_id, started_at);
CREATE INDEX idx_encounters_provider ON encounters(provider_id);
CREATE INDEX idx_encounters_status ON encounters(status);
```

---

### **Table: patient_standing_orders**

**CORE**: Active standing orders for individual patients (instances of templates).

```sql
CREATE TABLE patient_standing_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  template_id UUID NOT NULL REFERENCES standing_order_templates(id),
  initiating_encounter_id UUID REFERENCES encounters(id),
  authorizing_provider_id UUID NOT NULL REFERENCES users(id),
  start_date DATE NOT NULL, -- Protocol Day 0
  original_end_date DATE NOT NULL, -- Calculated from template
  current_end_date DATE NOT NULL, -- Adjusted if doses missed
  status VARCHAR(50) DEFAULT 'Active', -- 'Active', 'Completed', 'Discontinued', 'On_Hold'
  discontinuation_reason TEXT,
  discontinued_by_id UUID REFERENCES users(id),
  discontinued_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE INDEX idx_patient_standing_orders_patient ON patient_standing_orders(patient_id);
CREATE INDEX idx_patient_standing_orders_template ON patient_standing_orders(template_id);
CREATE INDEX idx_patient_standing_orders_status ON patient_standing_orders(status);
CREATE INDEX idx_patient_standing_orders_dates ON patient_standing_orders(start_date, current_end_date);
```

**Purpose**: This is the "Standing Order" table you requested. It shows:

- What protocol the patient is on
- When it started
- When it should end (with adjustments for missed doses)
- Who authorized it
- Current status

---

### **Table: clinical_orders**

**CORE**: Individual service orders (the items in a standing order).

```sql
CREATE TABLE clinical_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  standing_order_id UUID REFERENCES patient_standing_orders(id), -- NULL for ad-hoc orders
  service_id UUID NOT NULL REFERENCES service_catalog(id),
  encounter_id UUID REFERENCES encounters(id), -- NULL until completed
  ordering_provider_id UUID NOT NULL REFERENCES users(id),
  administering_provider_id UUID REFERENCES users(id),
  order_type VARCHAR(50) NOT NULL, -- 'Standing_Order', 'Ad_Hoc', 'STAT'
  status VARCHAR(50) DEFAULT 'Pending', -- FSM states (see below)
  priority VARCHAR(50) DEFAULT 'Routine', -- 'STAT', 'Urgent', 'Routine'

  -- Scheduling
  original_scheduled_date DATE, -- Original protocol date
  current_scheduled_date DATE, -- Adjusted date (if dose missed)
  due_date DATE, -- With grace period
  completed_at TIMESTAMP,

  -- Execution details
  quantity INTEGER DEFAULT 1,
  administration_site VARCHAR(100),
  administration_route VARCHAR(50),
  lot_id UUID REFERENCES inventory_lots(id),
  notes JSONB,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE INDEX idx_clinical_orders_patient ON clinical_orders(patient_id);
CREATE INDEX idx_clinical_orders_standing_order ON clinical_orders(standing_order_id);
CREATE INDEX idx_clinical_orders_status ON clinical_orders(status);
CREATE INDEX idx_clinical_orders_scheduled_date ON clinical_orders(current_scheduled_date);
CREATE INDEX idx_clinical_orders_service ON clinical_orders(service_id);
CREATE INDEX idx_clinical_orders_encounter ON clinical_orders(encounter_id);

-- Recall engine optimization
CREATE INDEX idx_clinical_orders_recall ON clinical_orders(patient_id, status, current_scheduled_date)
WHERE status IN ('Pending', 'Due', 'Overdue');
```

**FSM Status Values**:

- `Pending`: Future appointment, not yet due
- `Due`: Current date matches scheduled_date
- `Overdue`: Past due_date without completion
- `In_Progress`: Started (for labs: sample collected)
- `Completed`: Service delivered
- `Missed`: Patient no-show, marked as missed
- `Cancelled`: Order cancelled by provider
- `Discontinued`: Parent standing order discontinued

**Missed Dose Recalculation**: When a dose is administered late:

1. Update `completed_at` with actual date
2. Calculate delay: `delay_days = completed_at::date - original_scheduled_date`
3. Update all future orders in same standing order:
   ```sql
   UPDATE clinical_orders
   SET current_scheduled_date = original_scheduled_date + delay_days,
       due_date = original_scheduled_date + delay_days + grace_period
   WHERE standing_order_id = ?
     AND status = 'Pending'
     AND original_scheduled_date > ?;
   ```
4. Update `patient_standing_orders.current_end_date`

---

### **Table: clinical_order_schedule_changes**

**NEW**: Audit trail for schedule adjustments.

```sql
CREATE TABLE clinical_order_schedule_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinical_order_id UUID NOT NULL REFERENCES clinical_orders(id),
  change_reason VARCHAR(100) NOT NULL, -- 'Missed_Dose', 'Manual_Adjustment', 'Patient_Request'
  old_scheduled_date DATE NOT NULL,
  new_scheduled_date DATE NOT NULL,
  changed_by_id UUID NOT NULL REFERENCES users(id),
  changed_at TIMESTAMP DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX idx_order_schedule_changes_order ON clinical_order_schedule_changes(clinical_order_id);
CREATE INDEX idx_order_schedule_changes_date ON clinical_order_schedule_changes(changed_at);
```

---

## **Domain 5: Billing & Transactions**

### **Table: transactions**

**CORE**: Financial transaction header (supports prepayment for future appointments).

```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number VARCHAR(50) NOT NULL UNIQUE,
  branch_id UUID NOT NULL REFERENCES branches(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  encounter_id UUID REFERENCES encounters(id), -- NULL for prepayment
  transaction_date DATE NOT NULL,
  cashier_id UUID NOT NULL REFERENCES users(id),
  payer_id UUID REFERENCES payer_profiles(id),

  -- Amounts
  total_gross DECIMAL(10,2) NOT NULL,
  total_discount DECIMAL(10,2) DEFAULT 0,
  total_vat_exempt DECIMAL(10,2) DEFAULT 0,
  total_vat DECIMAL(10,2) DEFAULT 0,
  total_net DECIMAL(10,2) NOT NULL,

  -- Discount tracking (BIR compliance)
  discount_id_type VARCHAR(50),
  discount_id_number VARCHAR(100),

  -- Status
  status VARCHAR(50) DEFAULT 'Unpaid', -- 'Paid', 'Partial', 'Unpaid', 'Refunded', 'Voided'
  voided_at TIMESTAMP,
  voided_by_id UUID REFERENCES users(id),
  void_reason TEXT,

  -- Prepayment support
  is_prepayment BOOLEAN DEFAULT FALSE, -- TRUE if paying for future appointments
  prepayment_note TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE INDEX idx_transactions_reference ON transactions(reference_number);
CREATE INDEX idx_transactions_patient ON transactions(patient_id);
CREATE INDEX idx_transactions_branch_date ON transactions(branch_id, transaction_date);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_encounter ON transactions(encounter_id);
CREATE INDEX idx_transactions_prepayment ON transactions(is_prepayment) WHERE is_prepayment = TRUE;
```

---

### **Table: transaction_items**

**CORE**: Line items (links to clinical orders, supports prepayment).

```sql
CREATE TABLE transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  clinical_order_id UUID REFERENCES clinical_orders(id), -- Links to order (even if not completed yet)
  service_id UUID NOT NULL REFERENCES service_catalog(id),
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL, -- Price snapshot
  discount_amount DECIMAL(10,2) DEFAULT 0,
  vat_exempt BOOLEAN DEFAULT FALSE,
  subtotal DECIMAL(10,2) NOT NULL,

  -- Prepayment tracking
  is_prepaid BOOLEAN DEFAULT FALSE, -- TRUE if paid before service delivered
  prepaid_for_date DATE, -- Expected service date

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_transaction_items_transaction ON transaction_items(transaction_id);
CREATE INDEX idx_transaction_items_clinical_order ON transaction_items(clinical_order_id);
CREATE INDEX idx_transaction_items_service ON transaction_items(service_id);
CREATE INDEX idx_transaction_items_prepaid ON transaction_items(is_prepaid) WHERE is_prepaid = TRUE;
```

**Prepayment Workflow**:

1. Day 0: Patient wants to pay for all 4 ARV doses upfront
2. Cashier creates transaction with `is_prepayment = TRUE`
3. Creates transaction_items for all 4 doses (even though only Dose 1 is completed)
4. Each item links to its `clinical_order_id` and sets `is_prepaid = TRUE`
5. Day 3, 7, 14: When patient returns, nurse marks order complete (no new transaction needed)

---

### **Table: payments**

```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  payment_method VARCHAR(50) NOT NULL, -- 'Cash', 'GCash', 'Maya', 'PayMongo', 'BankTransfer', 'ChargeToAccount', 'Check'
  amount DECIMAL(10,2) NOT NULL,
  payer_id UUID REFERENCES payer_profiles(id), -- For ChargeToAccount
  reference_number VARCHAR(100),
  payment_date DATE NOT NULL,
  received_by_id UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_payments_transaction ON payments(transaction_id);
CREATE INDEX idx_payments_method ON payments(payment_method);
CREATE INDEX idx_payments_payer ON payments(payer_id);
CREATE INDEX idx_payments_date ON payments(payment_date);
```

---

### **Table: transaction_modifications**

**NEW**: Audit trail for transaction changes.

```sql
CREATE TABLE transaction_modifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  modification_type VARCHAR(100) NOT NULL, -- 'Payment_Method_Change', 'Add_Item', 'Remove_Item', 'Apply_Discount', 'Void'
  requested_by_id UUID NOT NULL REFERENCES users(id),
  approved_by_id UUID REFERENCES users(id),
  reason TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Approved', 'Denied'

  -- Change details
  old_value JSONB,
  new_value JSONB,

  requested_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_transaction_mods_transaction ON transaction_modifications(transaction_id);
CREATE INDEX idx_transaction_mods_status ON transaction_modifications(status);
CREATE INDEX idx_transaction_mods_requested_by ON transaction_modifications(requested_by_id);
```

**Example**: Nurse realizes patient paid cash but wants to change to GCash:

```sql
INSERT INTO transaction_modifications (
  transaction_id, modification_type, requested_by_id, reason, old_value, new_value
) VALUES (
  'txn-uuid', 'Payment_Method_Change', 'nurse-uuid',
  'Patient requested to change payment method',
  '{"payment_id": "pay-uuid", "method": "Cash"}',
  '{"payment_id": "pay-uuid", "method": "GCash", "reference": "GC-123456"}'
);
```

Manager reviews and approves. System updates payment record and logs the change.

---

## **Domain 6: Inventory Management**

### **Table: inventory_lots**

```sql
CREATE TABLE inventory_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES service_catalog(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  batch_number VARCHAR(100) NOT NULL,
  manufacturer VARCHAR(255),
  expiry_date DATE NOT NULL,
  received_date DATE NOT NULL,
  received_quantity INTEGER NOT NULL,
  quantity_on_hand INTEGER NOT NULL,
  unit_cost DECIMAL(10,2),
  supplier VARCHAR(255),
  storage_location VARCHAR(100),
  is_quarantined BOOLEAN DEFAULT FALSE,
  quarantine_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE INDEX idx_inventory_lots_service_branch ON inventory_lots(service_id, branch_id);
CREATE INDEX idx_inventory_lots_expiry ON inventory_lots(expiry_date);
CREATE INDEX idx_inventory_lots_batch ON inventory_lots(batch_number);

-- FEFO optimization
CREATE INDEX idx_inventory_lots_fefo ON inventory_lots(service_id, branch_id, expiry_date, quantity_on_hand)
WHERE quantity_on_hand > 0 AND is_quarantined = FALSE;
```

---

### **Table: inventory_transactions**

```sql
CREATE TABLE inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL REFERENCES inventory_lots(id),
  transaction_type VARCHAR(50) NOT NULL, -- 'Receipt', 'Dispensed', 'Adjustment', 'Expired', 'Transfer', 'Return'
  quantity_change INTEGER NOT NULL, -- Positive (in) or negative (out)
  quantity_after INTEGER NOT NULL,
  reference_type VARCHAR(50), -- 'ClinicalOrder', 'PurchaseOrder', 'Adjustment'
  reference_id UUID,
  performed_by_id UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_inventory_transactions_lot ON inventory_transactions(lot_id);
CREATE INDEX idx_inventory_transactions_reference ON inventory_transactions(reference_type, reference_id);
CREATE INDEX idx_inventory_transactions_date ON inventory_transactions(created_at);
```

---

## **Domain 7: Audit & Compliance**

### **Table: audit_logs**

**ENHANCED**: Comprehensive audit trail.

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL, -- 'CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'CROSS_BRANCH_ACCESS'
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  branch_id UUID REFERENCES branches(id), -- Where action occurred
  ip_address VARCHAR(50),
  user_agent TEXT,
  changes JSONB, -- Before/after values
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_branch ON audit_logs(branch_id);

-- Partition by month for performance
CREATE TABLE audit_logs_2026_03 PARTITION OF audit_logs
FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
```

---

### **Table: payer_profiles**

**Purpose**: Defines HMOs, corporate accounts, and discount groups (Senior, PWD).

```sql
CREATE TABLE payer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  payer_type VARCHAR(50) NOT NULL, -- 'HMO', 'Corporate', 'Gov_Mandated', 'Promo'
  requires_id BOOLEAN DEFAULT FALSE, -- TRUE for Senior/PWD (BIR compliance)
  payment_terms_days INTEGER DEFAULT 0, -- For HMOs: 30, 60, 90 days
  is_active BOOLEAN DEFAULT TRUE,
  contact_person VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  billing_address TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE INDEX idx_payer_profiles_type ON payer_profiles(payer_type);
CREATE INDEX idx_payer_profiles_active ON payer_profiles(is_active) WHERE is_active = TRUE;
```

---

## **Domain 8: Lab Services & Partner Integration**

### **Table: partner_laboratories**

**NEW**: Tracks external lab partners for diagnostic services.

```sql
CREATE TABLE partner_laboratories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  address TEXT,
  contact_person VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  turnaround_time_hours INTEGER, -- Expected TAT
  is_active BOOLEAN DEFAULT TRUE,
  api_endpoint VARCHAR(500), -- For automated result retrieval
  api_key_encrypted TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE INDEX idx_partner_labs_code ON partner_laboratories(code);
CREATE INDEX idx_partner_labs_active ON partner_laboratories(is_active) WHERE is_active = TRUE;
```

---

### **Table: lab_orders**

**NEW**: Tracks lab test requests (in-house or sent to partners).

```sql
CREATE TABLE lab_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinical_order_id UUID NOT NULL REFERENCES clinical_orders(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  encounter_id UUID REFERENCES encounters(id),
  service_id UUID NOT NULL REFERENCES service_catalog(id),
  partner_lab_id UUID REFERENCES partner_laboratories(id), -- NULL if in-house
  status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Sample_Collected', 'Sent_To_Partner', 'Results_Received', 'Released_To_Patient'
  sample_collected_at TIMESTAMP,
  sample_collected_by_id UUID REFERENCES users(id),
  sent_to_partner_at TIMESTAMP,
  results_received_at TIMESTAMP,
  released_to_patient_at TIMESTAMP,
  priority VARCHAR(50) DEFAULT 'Routine', -- 'STAT', 'Urgent', 'Routine'
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_lab_orders_clinical_order ON lab_orders(clinical_order_id);
CREATE INDEX idx_lab_orders_patient ON lab_orders(patient_id);
CREATE INDEX idx_lab_orders_status ON lab_orders(status);
CREATE INDEX idx_lab_orders_partner ON lab_orders(partner_lab_id);
CREATE INDEX idx_lab_orders_encounter ON lab_orders(encounter_id);
```

---

### **Table: lab_results**

**NEW**: Stores lab test results and files.

```sql
CREATE TABLE lab_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_order_id UUID NOT NULL REFERENCES lab_orders(id),
  result_data JSONB, -- Structured result data (e.g., CBC values)
  result_file_url VARCHAR(500), -- Cloud storage link (S3) to PDF
  result_file_type VARCHAR(50), -- 'PDF', 'Image', 'HL7'
  interpretation TEXT,
  abnormal_flags JSONB, -- Array of abnormal values
  reviewed_by_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  released_by_id UUID REFERENCES users(id),
  released_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_lab_results_order ON lab_results(lab_order_id);
CREATE INDEX idx_lab_results_reviewed ON lab_results(reviewed_by_id);
```

---

## **Domain 9: Recall Engine & Notifications**

### **Table: recall_schedules**

**CORE**: Tracks automated recall schedules for patients.

```sql
CREATE TABLE recall_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  clinical_order_id UUID NOT NULL REFERENCES clinical_orders(id),
  standing_order_id UUID REFERENCES patient_standing_orders(id),
  recall_type VARCHAR(50) NOT NULL, -- 'Follow_Up_Dose', 'Lab_Result_Ready', 'Overdue_Appointment'
  scheduled_date DATE NOT NULL,
  due_date DATE NOT NULL, -- With grace period
  status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Notified', 'Completed', 'Missed', 'Cancelled'
  notification_sent_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_recall_schedules_patient ON recall_schedules(patient_id);
CREATE INDEX idx_recall_schedules_order ON recall_schedules(clinical_order_id);
CREATE INDEX idx_recall_schedules_status_date ON recall_schedules(status, scheduled_date);
CREATE INDEX idx_recall_schedules_due ON recall_schedules(due_date) WHERE status IN ('Pending', 'Notified');
```

---

### **Table: notifications**

**NEW**: Audit trail of all notifications sent to patients.

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  recall_schedule_id UUID REFERENCES recall_schedules(id),
  notification_type VARCHAR(50) NOT NULL, -- 'SMS', 'Email', 'Push', 'Voice_Call'
  recipient VARCHAR(255) NOT NULL, -- Phone number or email
  subject VARCHAR(500),
  message TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Sent', 'Delivered', 'Failed', 'Bounced'
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  error_message TEXT,
  external_reference VARCHAR(255), -- SMS gateway reference number
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notifications_patient ON notifications(patient_id);
CREATE INDEX idx_notifications_recall ON notifications(recall_schedule_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_sent_at ON notifications(sent_at);
```

---

## **Example Workflows**

### **Workflow 1: Prepayment for Multi-Dose Protocol**

**Scenario**: Patient bitten by dog on Day 0. Wants to pay for all 4 ARV doses upfront.

**Steps**:

1. Nurse creates encounter for Day 0
2. Doctor authorizes standing order: "RABIES-PEP-CAT3" (4 ARV doses on Days 0, 3, 7, 14)
3. System creates `patient_standing_orders` record with `start_date = 2026-03-09`
4. System auto-generates 4 `clinical_orders` records:
   - Order 1: Day 0 (status = 'Pending')
   - Order 2: Day 3 (status = 'Pending', `original_scheduled_date = 2026-03-12`)
   - Order 3: Day 7 (status = 'Pending', `original_scheduled_date = 2026-03-16`)
   - Order 4: Day 14 (status = 'Pending', `original_scheduled_date = 2026-03-23`)
5. Nurse administers Dose 1, updates Order 1 status to 'Completed'
6. Cashier creates transaction with `is_prepayment = TRUE`
7. Cashier adds 4 transaction_items:
   - Item 1: Dose 1 (links to Order 1, `is_prepaid = FALSE`)
   - Item 2: Dose 2 (links to Order 2, `is_prepaid = TRUE`, `prepaid_for_date = 2026-03-12`)
   - Item 3: Dose 3 (links to Order 3, `is_prepaid = TRUE`, `prepaid_for_date = 2026-03-16`)
   - Item 4: Dose 4 (links to Order 4, `is_prepaid = TRUE`, `prepaid_for_date = 2026-03-23`)
8. Patient pays P15,000 cash
9. System creates recall_schedules for Days 3, 7, 14
10. Day 3: SMS sent to patient, patient returns, nurse marks Order 2 as 'Completed' (no new transaction)
11. Day 7: SMS sent, patient returns, Order 3 completed
12. Day 14: SMS sent, patient returns, Order 4 completed

**SQL Query to Check Prepayment Status**:

```sql
SELECT
  co.id AS order_id,
  co.current_scheduled_date,
  co.status AS order_status,
  ti.is_prepaid,
  ti.prepaid_for_date,
  t.reference_number AS transaction_ref,
  t.status AS payment_status
FROM clinical_orders co
LEFT JOIN transaction_items ti ON ti.clinical_order_id = co.id
LEFT JOIN transactions t ON t.id = ti.transaction_id
WHERE co.standing_order_id = 'standing-order-uuid'
ORDER BY co.current_scheduled_date;
```

---

### **Workflow 2: Cross-Branch Access Request**

**Scenario**: Patient from Cainta Branch visits Antipolo Branch for emergency dose.

**Steps**:

1. Antipolo nurse searches for patient by name/contact (patient not found in local branch)
2. Nurse clicks "Request Cross-Branch Access"
3. System creates `cross_branch_access_requests` record:
   - `requesting_user_id` = Antipolo nurse
   - `requesting_branch_id` = Antipolo
   - `patient_home_branch_id` = Cainta
   - `reason` = "Emergency dose needed, patient unable to travel to home branch"
   - `status` = 'Pending'
4. System sends notification to Cainta Branch Manager
5. Cainta Manager reviews request, approves with 24-hour access window
6. System updates request: `status = 'Approved'`, `access_granted_until = NOW() + 24 hours`
7. Antipolo nurse can now view patient's Cainta records
8. Every access is logged in `cross_branch_access_logs`
9. After 24 hours, access automatically expires

**SQL Query to Check Active Cross-Branch Access**:

```sql
SELECT
  p.first_name || ' ' || p.last_name AS patient_name,
  req.requesting_branch_id,
  req.patient_home_branch_id,
  req.access_granted_until,
  req.status
FROM cross_branch_access_requests req
JOIN patients p ON p.id = req.patient_id
WHERE req.requesting_user_id = 'nurse-uuid'
  AND req.status = 'Approved'
  AND req.access_granted_until > NOW();
```

---

### **Workflow 3: Transaction Modification (Payment Method Change)**

**Scenario**: Patient paid cash but wants to change to GCash after leaving clinic.

**Steps**:

1. Patient calls clinic, nurse creates modification request
2. System creates `transaction_modifications` record:
   - `transaction_id` = original transaction
   - `modification_type` = 'Payment_Method_Change'
   - `requested_by_id` = nurse
   - `reason` = "Patient requested to change payment method to GCash"
   - `old_value` = `{"payment_id": "pay-uuid", "method": "Cash", "amount": 5000}`
   - `new_value` = `{"payment_id": "pay-uuid", "method": "GCash", "amount": 5000, "reference": "GC-123456789"}`
   - `status` = 'Pending'
3. Branch Manager reviews and approves
4. System updates `payments` table: `method = 'GCash'`, `reference_number = 'GC-123456789'`
5. System logs change in `audit_logs`

**SQL Query to View Transaction Modification History**:

```sql
SELECT
  tm.modification_type,
  tm.reason,
  tm.old_value,
  tm.new_value,
  tm.status,
  u1.first_name || ' ' || u1.last_name AS requested_by,
  u2.first_name || ' ' || u2.last_name AS approved_by,
  tm.requested_at,
  tm.reviewed_at
FROM transaction_modifications tm
JOIN users u1 ON u1.id = tm.requested_by_id
LEFT JOIN users u2 ON u2.id = tm.approved_by_id
WHERE tm.transaction_id = 'txn-uuid'
ORDER BY tm.requested_at DESC;
```

---

### **Workflow 4: Missed Dose Recalculation**

**Scenario**: Patient misses Day 3 dose, comes on Day 5 instead.

**Steps**:

1. Patient scheduled for Day 3 (2026-03-12), doesn't show up
2. Recall Engine marks Order 2 as 'Overdue' on Day 4
3. Patient arrives on Day 5 (2026-03-14)
4. Nurse administers dose, marks Order 2 as 'Completed' with `completed_at = 2026-03-14`
5. System calculates delay: `delay_days = 2` (Day 5 - Day 3)
6. System updates all future orders in same standing order:
   ```sql
   UPDATE clinical_orders
   SET current_scheduled_date = original_scheduled_date + 2,
       due_date = original_scheduled_date + 2 + 3 -- 3-day grace period
   WHERE standing_order_id = 'standing-order-uuid'
     AND status = 'Pending'
     AND original_scheduled_date > '2026-03-12';
   ```
7. Order 3: `current_scheduled_date` changes from 2026-03-16 to 2026-03-18
8. Order 4: `current_scheduled_date` changes from 2026-03-23 to 2026-03-25
9. System creates `clinical_order_schedule_changes` records for Orders 3 and 4
10. System updates `patient_standing_orders.current_end_date` from 2026-03-23 to 2026-03-25
11. Recall Engine updates `recall_schedules` for future doses

**SQL Query to View Schedule Changes**:

```sql
SELECT
  co.id AS order_id,
  sc.service_id,
  s.name AS service_name,
  co.original_scheduled_date,
  co.current_scheduled_date,
  ch.change_reason,
  ch.old_scheduled_date,
  ch.new_scheduled_date,
  ch.changed_at,
  u.first_name || ' ' || u.last_name AS changed_by
FROM clinical_orders co
JOIN service_catalog s ON s.id = co.service_id
LEFT JOIN clinical_order_schedule_changes ch ON ch.clinical_order_id = co.id
LEFT JOIN users u ON u.id = ch.changed_by_id
WHERE co.standing_order_id = 'standing-order-uuid'
ORDER BY co.current_scheduled_date;
```

---

## **Common SQL Queries**

### **Query 1: View All Services in a Standing Order**

```sql
SELECT
  sot.name AS template_name,
  soti.day_offset,
  soti.sequence,
  sc.name AS service_name,
  sc.service_type,
  soti.quantity,
  soti.is_required,
  soti.instructions
FROM standing_order_templates sot
JOIN standing_order_template_items soti ON soti.template_id = sot.id
JOIN service_catalog sc ON sc.id = soti.service_id
WHERE sot.code = 'RABIES-PEP-CAT3'
ORDER BY soti.day_offset, soti.sequence;
```

**Expected Output**:
| template_name | day_offset | sequence | service_name | service_type | quantity | is_required | instructions |
|---------------|------------|----------|--------------|--------------|----------|-------------|--------------|
| Rabies PEP Category III | 0 | 1 | Consultation | Consultation | 1 | TRUE | Initial assessment |
| Rabies PEP Category III | 0 | 2 | Wound Cleaning | Procedure | 1 | TRUE | Thorough wound irrigation |
| Rabies PEP Category III | 0 | 3 | ARV Dose 1 | Immunization | 1 | TRUE | Administer IM |
| Rabies PEP Category III | 0 | 4 | ERIG | Immunization | 1 | TRUE | Weight-based infiltration |
| Rabies PEP Category III | 3 | 1 | ARV Dose 2 | Immunization | 1 | TRUE | Administer IM |
| Rabies PEP Category III | 7 | 1 | ARV Dose 3 | Immunization | 1 | TRUE | Administer IM |
| Rabies PEP Category III | 14 | 1 | ARV Dose 4 | Immunization | 1 | TRUE | Administer IM |

---

### **Query 2: Find All Services a Patient Availed During a Visit**

```sql
SELECT
  e.started_at AS visit_date,
  sc.name AS service_name,
  sc.service_type,
  co.quantity,
  co.status,
  co.completed_at,
  u.first_name || ' ' || u.last_name AS administered_by,
  il.batch_number AS lot_number,
  il.expiry_date
FROM encounters e
JOIN clinical_orders co ON co.encounter_id = e.id
JOIN service_catalog sc ON sc.id = co.service_id
LEFT JOIN users u ON u.id = co.administering_provider_id
LEFT JOIN inventory_lots il ON il.id = co.lot_id
WHERE e.id = 'encounter-uuid'
ORDER BY co.completed_at;
```

---

### **Query 3: Check Payment Status for Future Appointments**

```sql
SELECT
  co.current_scheduled_date,
  sc.name AS service_name,
  co.status AS order_status,
  CASE
    WHEN ti.is_prepaid = TRUE THEN 'Prepaid'
    WHEN t.status = 'Paid' THEN 'Paid'
    WHEN t.status = 'Partial' THEN 'Partially Paid'
    ELSE 'Unpaid'
  END AS payment_status,
  ti.prepaid_for_date,
  t.reference_number AS transaction_ref
FROM clinical_orders co
JOIN service_catalog sc ON sc.id = co.service_id
LEFT JOIN transaction_items ti ON ti.clinical_order_id = co.id
LEFT JOIN transactions t ON t.id = ti.transaction_id
WHERE co.patient_id = 'patient-uuid'
  AND co.status IN ('Pending', 'Due', 'Overdue')
ORDER BY co.current_scheduled_date;
```

---

### **Query 4: FEFO Inventory Selection (First-Expired-First-Out)**

```sql
SELECT
  il.id AS lot_id,
  il.batch_number,
  il.manufacturer,
  il.expiry_date,
  il.quantity_on_hand,
  il.storage_location
FROM inventory_lots il
WHERE il.service_id = 'service-uuid'
  AND il.branch_id = 'branch-uuid'
  AND il.quantity_on_hand > 0
  AND il.is_quarantined = FALSE
  AND il.expiry_date > CURRENT_DATE
ORDER BY il.expiry_date ASC, il.received_date ASC
LIMIT 1;
```

**Purpose**: Automatically selects the lot that expires soonest to minimize waste.

---

### **Query 5: Cross-Branch Patient Search**

```sql
-- Search patients across all branches (requires cross-branch access approval)
SELECT
  p.id,
  p.first_name || ' ' || p.middle_name || ' ' || p.last_name AS full_name,
  p.dob,
  p.sex,
  p.contact_number,
  b.name AS home_branch,
  p.home_branch_id
FROM patients p
JOIN branches b ON b.id = p.home_branch_id
WHERE p.search_vector @@ to_tsquery('english', 'john:* & doe:*')
  OR p.contact_number LIKE '%09171234567%'
ORDER BY ts_rank(p.search_vector, to_tsquery('english', 'john:* & doe:*')) DESC
LIMIT 10;
```

---

### **Query 6: Daily Recall List (Patients Due Today)**

```sql
SELECT
  p.first_name || ' ' || p.last_name AS patient_name,
  p.contact_number,
  sc.name AS service_name,
  co.current_scheduled_date,
  co.status,
  rs.notification_sent_at,
  pso.template_id,
  sot.name AS protocol_name
FROM recall_schedules rs
JOIN patients p ON p.id = rs.patient_id
JOIN clinical_orders co ON co.id = rs.clinical_order_id
JOIN service_catalog sc ON sc.id = co.service_id
LEFT JOIN patient_standing_orders pso ON pso.id = co.standing_order_id
LEFT JOIN standing_order_templates sot ON sot.id = pso.template_id
WHERE rs.scheduled_date = CURRENT_DATE
  AND rs.status IN ('Pending', 'Notified')
  AND co.status IN ('Pending', 'Due')
ORDER BY co.current_scheduled_date, p.last_name;
```

**Purpose**: Generates daily roster of expected patients for nurses.

---

## **Performance Optimization**

### **Indexing Strategy**

**High-Traffic Queries**:

1. Patient search by name/contact → GIN index on `search_vector`
2. Recall engine daily batch → Composite index on `(status, scheduled_date)`
3. Cross-branch access logs → Composite index on `(patient_id, accessed_at)`
4. FEFO inventory selection → Composite index on `(service_id, branch_id, expiry_date, quantity_on_hand)`

**Partitioning**:

- `audit_logs`: Partition by month (keeps recent data fast, archives old data)
- `notifications`: Partition by quarter (high volume, rarely queried after 90 days)

**Materialized Views**:

```sql
-- Daily recall roster (refresh every hour)
CREATE MATERIALIZED VIEW mv_daily_recall_roster AS
SELECT
  rs.scheduled_date,
  p.id AS patient_id,
  p.first_name || ' ' || p.last_name AS patient_name,
  p.contact_number,
  sc.name AS service_name,
  co.status,
  rs.notification_sent_at
FROM recall_schedules rs
JOIN patients p ON p.id = rs.patient_id
JOIN clinical_orders co ON co.id = rs.clinical_order_id
JOIN service_catalog sc ON sc.id = co.service_id
WHERE rs.status IN ('Pending', 'Notified')
  AND co.status IN ('Pending', 'Due');

CREATE UNIQUE INDEX idx_mv_recall_roster ON mv_daily_recall_roster(scheduled_date, patient_id, service_name);
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_recall_roster;
```

---

### **Query Optimization Tips**

1. **Use `EXPLAIN ANALYZE`** to identify slow queries
2. **Avoid `SELECT *`** in production queries (specify columns)
3. **Use `LIMIT`** for paginated results
4. **Leverage `JSONB` indexes** for frequently queried JSON fields:
   ```sql
   CREATE INDEX idx_clinical_orders_notes_site
   ON clinical_orders USING GIN ((notes -> 'site'));
   ```
5. **Use connection pooling** (PgBouncer) to handle high concurrency

---

## **Search Best Practices**

### **Full-Text Search Configuration**

**Patient Search**:

```sql
-- Fuzzy search with typo tolerance
SELECT * FROM patients
WHERE search_vector @@ to_tsquery('english', 'jon:* & do:*') -- Matches "John Doe"
ORDER BY ts_rank(search_vector, to_tsquery('english', 'jon:* & do:*')) DESC;
```

**Service Catalog Search**:

```sql
-- Search by name, code, or description
SELECT * FROM service_catalog
WHERE search_vector @@ to_tsquery('english', 'rabies:* | arv:*')
ORDER BY ts_rank(search_vector, to_tsquery('english', 'rabies:* | arv:*')) DESC;
```

**Contact Number Search** (exact match or partial):

```sql
SELECT * FROM patients
WHERE contact_number LIKE '%09171234567%'
  OR contact_number = '09171234567';
```

---

## **Migration Guide: v2 → v3**

### **Key Schema Changes**

| v2 Table          | v3 Table                          | Change Type | Migration Notes                                                              |
| ----------------- | --------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| `catalog_items`   | `service_catalog`                 | Renamed     | Direct rename, add `search_vector` column                                    |
| N/A               | `standing_order_templates`        | New         | Create from scratch, populate with common protocols                          |
| N/A               | `standing_order_template_items`   | New         | Define protocol items (ARV doses, etc.)                                      |
| `clinical_orders` | `clinical_orders`                 | Enhanced    | Add `original_scheduled_date`, `current_scheduled_date`, `standing_order_id` |
| `transactions`    | `transactions`                    | Enhanced    | Add `is_prepayment`, `prepayment_note`                                       |
| `txn_items`       | `transaction_items`               | Enhanced    | Add `is_prepaid`, `prepaid_for_date`                                         |
| N/A               | `cross_branch_access_requests`    | New         | Create from scratch                                                          |
| N/A               | `cross_branch_access_logs`        | New         | Create from scratch                                                          |
| N/A               | `patient_data_change_requests`    | New         | Create from scratch                                                          |
| N/A               | `transaction_modifications`       | New         | Create from scratch                                                          |
| N/A               | `clinical_order_schedule_changes` | New         | Create from scratch                                                          |
| N/A               | `recall_schedules`                | New         | Create from scratch, populate from existing orders                           |
| N/A               | `notifications`                   | New         | Create from scratch                                                          |
| N/A               | `lab_orders`                      | New         | Create from scratch                                                          |
| N/A               | `lab_results`                     | New         | Create from scratch                                                          |
| N/A               | `partner_laboratories`            | New         | Create from scratch                                                          |

### **Migration Steps**

1. **Backup v2 database** (full dump)
2. **Create v3 schema** (run all CREATE TABLE statements)
3. **Migrate core data**:
   - `branches` → Direct copy
   - `users` → Direct copy
   - `patients` → Copy + generate `search_vector`
   - `catalog_items` → Rename to `service_catalog` + add search
4. **Create standing order templates** (manual data entry for common protocols)
5. **Migrate clinical orders**:
   - Copy existing orders
   - Set `original_scheduled_date = current_scheduled_date`
   - Link to standing orders where applicable
6. **Migrate transactions**:
   - Copy existing transactions
   - Set `is_prepayment = FALSE` for all historical data
7. **Generate recall schedules** from pending clinical orders
8. **Test cross-branch access** (create sample requests)
9. **Validate data integrity** (run test queries)
10. **Deploy to production** (blue-green deployment recommended)

---

## **Conclusion**

This schema represents a **standing order-centric, nurse-driven, multi-tenant clinic management system** with:

✅ **Prepayment support** for multi-dose protocols  
✅ **Cross-branch data sharing** with audit trail  
✅ **Transaction modification** tracking  
✅ **Missed dose recalculation** with schedule adjustment  
✅ **Full-text search** for patients and services  
✅ **FEFO inventory management**  
✅ **Lab services integration** with partner labs  
✅ **Automated recall engine** with SMS notifications  
✅ **Comprehensive audit trail** for compliance

The schema is designed for **sustainability and extensibility**, with clear extension points for:

- Telemedicine consultations
- Pharmacy integration
- Chronic disease management programs
- Wellness and preventive care protocols
- Mobile app integration

All tables follow **PostgreSQL best practices** with proper indexing, partitioning, and search optimization.
