# **SureVax CMS v2.0: Database Schema**

## **Standing Order-Centric with Cross-Branch Sharing & Prepayment Support**

---

## **Design Philosophy**

**Keep it simple. Keep it modular.**

- Use generic audit logs instead of dedicated audit tables for every entity
- Leverage JSONB for flexible data that doesn't need querying
- Only create tables for entities that need complex queries or relationships
- Prefer application-level logic over database complexity where appropriate

---

## **Critical Design Decisions**

### **1. Standing Orders = Service Lists**

A standing order is a **list of services** a patient will receive across multiple visits.

### **2. Prepayment Support**

Patients can pay for future appointments on Day 0 via `is_prepaid` flag on transaction items.

### **3. Cross-Branch Data Sharing**

Simple request/approval flow tracked in audit logs, not dedicated tables.

### **4. Transaction Modifications**

Changes tracked in generic audit log with before/after JSONB.

### **5. Missed Dose Recalculation**

When a dose is late, update `current_scheduled_date` and log the change in audit.

---

## **System-Wide Standards**

- **Primary Keys**: UUID for all IDs
- **Audit Trail**: Every table has `created_at`, `updated_at`, `created_by_id`
- **Soft Deletes**: Use `deleted_at` instead of hard deletes
- **Branch Scoping**: All data includes `branch_id` for multi-tenancy
- **Audit Everything**: Use generic `audit_logs` table instead of dedicated audit tables

---

## **Core Tables**

### **1. Multi-Tenancy**

```sql
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  is_active BOOLEAN DEFAULT TRUE,
  settings JSONB, -- Operating hours, printer config, etc.
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

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

-- Time Tracking: Staff clock in/out
CREATE TABLE staff_time_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  clock_in_at TIMESTAMP NOT NULL DEFAULT NOW(),
  clock_out_at TIMESTAMP,
  total_hours DECIMAL(5,2), -- Calculated on clock out
  notes TEXT, -- Reason for late/early, breaks, etc.
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_staff_time_logs_user ON staff_time_logs(user_id);
CREATE INDEX idx_staff_time_logs_branch_date ON staff_time_logs(branch_id, clock_in_at);
CREATE INDEX idx_staff_time_logs_active ON staff_time_logs(user_id, clock_out_at) WHERE clock_out_at IS NULL;
```

---

### **2. Patient Registry**

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

  -- Onboarding tracking
  onboarding_channel VARCHAR(50), -- 'Walk-In', 'Referral', 'Online', 'Corporate', 'HMO', 'Government_Program'
  date_first_visit DATE,

  -- Insurance information (for HMO expansion)
  insurance_provider VARCHAR(255),
  insurance_number VARCHAR(100),
  insurance_expiry DATE,

  is_active BOOLEAN DEFAULT TRUE,
  deleted_at TIMESTAMP, -- Soft delete support
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id),

  -- Full-text search
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(first_name, '') || ' ' ||
      coalesce(middle_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(contact_number, '')
    )
  ) STORED
);

CREATE INDEX idx_patients_search ON patients USING GIN(search_vector);
CREATE INDEX idx_patients_branch ON patients(home_branch_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_patients_contact ON patients(contact_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_patients_onboarding ON patients(onboarding_channel);
CREATE INDEX idx_patients_insurance ON patients(insurance_provider) WHERE insurance_provider IS NOT NULL AND deleted_at IS NULL;
```

---

### **3. Service Catalog**

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
  deleted_at TIMESTAMP, -- Soft delete support
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id),

  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(code, ''))
  ) STORED
);

CREATE INDEX idx_service_catalog_search ON service_catalog USING GIN(search_vector);
CREATE INDEX idx_service_catalog_type ON service_catalog(service_type);
```

---

### **4. Standing Orders (The Core Abstraction)**

**Design Decision**: We keep templates separate because they're **reusable recipes**. When a doctor orders "Rabies PEP", the system auto-generates clinical_orders from the template. This is a one-time "stamping" operation.

```sql
-- Templates: Reusable protocols (e.g., "Rabies PEP Category III")
CREATE TABLE standing_order_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  protocol_type VARCHAR(50) NOT NULL, -- 'Immunization', 'Laboratory', 'Mixed', 'Chronic_Care'

  -- SIMPLIFIED: Store the protocol definition as JSONB instead of separate table
  protocol_items JSONB NOT NULL, -- Array of {service_id, day_offset, sequence, quantity, instructions}

  is_active BOOLEAN DEFAULT TRUE,
  requires_physician_auth BOOLEAN DEFAULT TRUE,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE INDEX idx_standing_order_templates_code ON standing_order_templates(code);
```

**Example protocol_items JSONB**:

```jsonb
[
  {"service_id": "uuid-consultation", "day_offset": 0, "sequence": 1, "quantity": 1, "instructions": "Initial assessment"},
  {"service_id": "uuid-wound-cleaning", "day_offset": 0, "sequence": 2, "quantity": 1, "instructions": "Thorough irrigation"},
  {"service_id": "uuid-arv-dose-1", "day_offset": 0, "sequence": 3, "quantity": 1, "instructions": "Administer IM"},
  {"service_id": "uuid-erig", "day_offset": 0, "sequence": 4, "quantity": 1, "instructions": "Weight-based infiltration"},
  {"service_id": "uuid-arv-dose-2", "day_offset": 3, "sequence": 1, "quantity": 1, "instructions": "Administer IM"},
  {"service_id": "uuid-arv-dose-3", "day_offset": 7, "sequence": 1, "quantity": 1, "instructions": "Administer IM"},
  {"service_id": "uuid-arv-dose-4", "day_offset": 14, "sequence": 1, "quantity": 1, "instructions": "Administer IM"}
]
```

```sql
-- Patient Standing Orders: Active protocols for patients
CREATE TABLE patient_standing_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  template_id UUID NOT NULL REFERENCES standing_order_templates(id),
  initiating_encounter_id UUID REFERENCES encounters(id),
  authorizing_provider_id UUID NOT NULL REFERENCES users(id),
  start_date DATE NOT NULL,
  original_end_date DATE NOT NULL,
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
CREATE INDEX idx_patient_standing_orders_status ON patient_standing_orders(status);
```

**How it works**:

1. Admin creates template with protocol_items JSONB
2. Doctor orders "Rabies PEP" for patient
3. System creates `patient_standing_orders` record
4. System reads `protocol_items` JSONB and auto-generates `clinical_orders` for each item
5. Each `clinical_order` links back to `patient_standing_orders.id`
6. Template can be updated without affecting existing patient orders

---

### **5. Clinical Operations**

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
  status VARCHAR(50) DEFAULT 'In_Progress',

  -- Categorization & Context
  categorization VARCHAR(100), -- 'Dog_Bite', 'Cat_Bite', 'Rat_Bite', 'Monkey_Bite', 'Vaccination', 'Lab_Test', 'Consultation', 'Follow_Up'

  -- Specialty-specific data (JSONB for flexibility)
  -- Renamed from bite_incident to support multiple specialties
  specialty VARCHAR(50), -- 'Rabies', 'General', 'Flu', 'Vaccination', 'Consultation'
  specialty_data JSONB, -- Specialty-specific data (see structure below)

  -- Clinical notes (JSONB for flexibility)
  clinical_notes JSONB, -- Vitals, SOAP notes, assessment, plan

  deleted_at TIMESTAMP, -- Soft delete support
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_encounters_patient ON encounters(patient_id);
CREATE INDEX idx_encounters_branch_date ON encounters(branch_id, started_at);
CREATE INDEX idx_encounters_provider ON encounters(provider_id);
CREATE INDEX idx_encounters_status ON encounters(status);
CREATE INDEX idx_encounters_categorization ON encounters(categorization);
CREATE INDEX idx_encounters_specialty ON encounters(specialty);

-- JSONB indexes for querying specialty-specific data
CREATE INDEX idx_encounters_bite_category ON encounters USING GIN ((specialty_data -> 'bite_category'));
CREATE INDEX idx_encounters_animal_type ON encounters USING GIN ((specialty_data -> 'animal_type'));
CREATE INDEX idx_encounters_incident_location ON encounters USING GIN ((specialty_data -> 'incident_city'));
```

**specialty_data JSONB Structure** (varies by specialty):

**For Rabies encounters** (specialty = 'Rabies'):

```jsonb
{
  "incident_date": "2026-03-09",
  "source_of_concern": "Stray dog bite on right arm, unprovoked attack while walking home",

  // Animal details
  "animal_type": "Dog",
  "animal_ownership": "Stray",
  "animal_vaccination_status": "Unknown",
  "animal_behavior": "Unprovoked",
  "animal_status": "Unknown",
  "animal_observation_start": "2026-03-09",
  "animal_observation_end": "2026-03-23",
  "animal_observation_result": null, // Updated after 14 days

  // Bite details
  "bite_category": "III", // WHO classification
  "bite_location": "Right forearm, 3cm laceration",
  "bite_severity": "Moderate",
  "wound_type": "Bite",

  // Location
  "incident_location": "Street corner near home",
  "incident_barangay": "Barangay 1",
  "incident_city": "Quezon City",
  "incident_province": "Metro Manila",

  // Repeat exposure tracking
  "is_repeat_exposure": false,
  "previous_pep_completed": null,
  "previous_pep_date": null
}
```

**For General/Flu/Vaccination encounters** (specialty = 'General', 'Flu', 'Vaccination'):

```jsonb
{
  "chief_complaint": "Fever and cough for 3 days",
  "symptoms": ["Fever", "Cough", "Fatigue"],
  "duration_days": 3,
  "severity": "Moderate",
  "vaccine_type": "Quadrivalent", // For flu vaccinations
  "high_risk_group": true,
  "risk_factors": ["Elderly", "Chronic_Disease"]
}
```

**clinical_notes JSONB Structure**:

```jsonb
{
  "vitals": {
    "bp_systolic": 120,
    "bp_diastolic": 80,
    "temperature_c": 37.2,
    "heart_rate": 72,
    "respiratory_rate": 16,
    "weight_kg": 65,
    "height_cm": 170
  },
  "soap": {
    "subjective": "Patient reports dog bite 2 hours ago while walking home",
    "objective": "3cm laceration on right forearm, bleeding controlled, wound edges clean",
    "assessment": "Category III dog bite, stray animal, unknown vaccination status",
    "plan": "Wound cleaning, ERIG infiltration, ARV PEP 4-dose series (Day 0, 3, 7, 14), TT booster"
  },
  "allergies_confirmed": ["None"],
  "medications_given": ["Paracetamol 500mg PO"],
  "discharge_instructions": "Return on Day 3 (March 12) for 2nd ARV dose. Watch for signs of infection. Keep wound clean and dry."
}
```

```sql
-- Clinical Orders: Individual service orders
CREATE TABLE clinical_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  standing_order_id UUID REFERENCES patient_standing_orders(id), -- NULL for ad-hoc
  service_id UUID NOT NULL REFERENCES service_catalog(id),
  encounter_id UUID REFERENCES encounters(id), -- NULL until completed
  ordering_provider_id UUID NOT NULL REFERENCES users(id),
  administering_provider_id UUID REFERENCES users(id),
  order_type VARCHAR(50) NOT NULL, -- 'Standing_Order', 'Ad_Hoc', 'STAT'
  status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Due', 'Overdue', 'In_Progress', 'Completed', 'Missed', 'Cancelled'
  priority VARCHAR(50) DEFAULT 'Routine',

  -- Scheduling
  original_scheduled_date DATE,
  current_scheduled_date DATE, -- Adjusted if missed
  due_date DATE, -- With grace period
  completed_at TIMESTAMP,

  -- Execution details
  quantity DECIMAL(10,2) DEFAULT 1, -- Changed to DECIMAL for fractional quantities (ID route)
  administration_site VARCHAR(100),
  administration_route VARCHAR(50),
  lot_id UUID REFERENCES inventory_lots(id),
  notes JSONB, -- Flexible execution details (see enhanced structure below)

  deleted_at TIMESTAMP, -- Soft delete support
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE INDEX idx_clinical_orders_patient ON clinical_orders(patient_id);
CREATE INDEX idx_clinical_orders_standing_order ON clinical_orders(standing_order_id);
CREATE INDEX idx_clinical_orders_status ON clinical_orders(status);
CREATE INDEX idx_clinical_orders_scheduled_date ON clinical_orders(current_scheduled_date);
CREATE INDEX idx_clinical_orders_recall ON clinical_orders(patient_id, status, current_scheduled_date)
WHERE status IN ('Pending', 'Due', 'Overdue');
```

**Enhanced clinical_orders.notes JSONB Structure** (for vaccine administration):

```jsonb
{
  "administration": {
    "route": "IM",
    "site": "Left deltoid",
    "volume_ml": 0.5,
    "needle_gauge": "23G",
    "needle_length": "1 inch"
  },
  "consent": {
    "vis_provided": true,
    "vis_date": "2026-03-09",
    "vis_version": "2024-08-15",
    "consent_obtained": true,
    "consent_by": "Patient",
    "consent_timestamp": "2026-03-09T10:15:00Z"
  },
  "adverse_events": {
    "immediate_reaction": false,
    "observation_period_minutes": 15,
    "reaction_type": null,
    "notes": "No adverse reaction observed"
  },
  "indication": "Post-Exposure Prophylaxis",
  "protocol": "PEP IM 4-dose",
  "dose_number": 1
}
```

---

### **6. Billing & Transactions**

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

  total_gross DECIMAL(10,2) NOT NULL,
  total_discount DECIMAL(10,2) DEFAULT 0,
  total_vat_exempt DECIMAL(10,2) DEFAULT 0,
  total_vat DECIMAL(10,2) DEFAULT 0,
  total_net DECIMAL(10,2) NOT NULL,

  discount_id_type VARCHAR(50), -- BIR compliance
  discount_id_number VARCHAR(100),

  status VARCHAR(50) DEFAULT 'Unpaid', -- 'Paid', 'Partial', 'Unpaid', 'Refunded', 'Voided'
  voided_at TIMESTAMP,
  voided_by_id UUID REFERENCES users(id),
  void_reason TEXT,

  is_prepayment BOOLEAN DEFAULT FALSE, -- TRUE if paying for future appointments
  prepayment_note TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE TABLE transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  clinical_order_id UUID REFERENCES clinical_orders(id), -- Links to order (even if not completed)
  service_id UUID NOT NULL REFERENCES service_catalog(id),
  quantity DECIMAL(10,2) DEFAULT 1, -- Changed to DECIMAL for fractional quantities
  unit_price DECIMAL(10,2) NOT NULL,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  vat_exempt BOOLEAN DEFAULT FALSE,
  subtotal DECIMAL(10,2) NOT NULL,

  is_prepaid BOOLEAN DEFAULT FALSE, -- TRUE if paid before service delivered
  prepaid_for_date DATE, -- Expected service date

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  payment_method VARCHAR(50) NOT NULL, -- 'Cash', 'GCash', 'Maya', 'PayMongo', 'BankTransfer', 'ChargeToAccount', 'Check'
  amount DECIMAL(10,2) NOT NULL,
  payer_id UUID REFERENCES payer_profiles(id),
  reference_number VARCHAR(100),
  payment_date DATE NOT NULL,
  received_by_id UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE payer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  payer_type VARCHAR(50) NOT NULL, -- 'HMO', 'Corporate', 'Gov_Mandated', 'Promo'
  requires_id BOOLEAN DEFAULT FALSE,
  payment_terms_days INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  contact_person VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  billing_address TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);
```

---

### **7. Inventory Management**

```sql
CREATE TABLE inventory_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES service_catalog(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  batch_number VARCHAR(100) NOT NULL,
  manufacturer VARCHAR(255),
  expiry_date DATE NOT NULL,
  received_date DATE NOT NULL,
  received_quantity DECIMAL(10,2) NOT NULL, -- Changed to DECIMAL for fractional quantities (ID route)
  quantity_on_hand DECIMAL(10,2) NOT NULL, -- Changed to DECIMAL for fractional quantities (ID route)
  unit_cost DECIMAL(10,2),
  supplier VARCHAR(255),
  storage_location VARCHAR(100),
  is_quarantined BOOLEAN DEFAULT FALSE,
  quarantine_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

-- FEFO optimization
CREATE INDEX idx_inventory_lots_fefo ON inventory_lots(service_id, branch_id, expiry_date, quantity_on_hand)
WHERE quantity_on_hand > 0 AND is_quarantined = FALSE;

CREATE TABLE inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id UUID NOT NULL REFERENCES inventory_lots(id),
  transaction_type VARCHAR(50) NOT NULL, -- 'Receipt', 'Dispensed', 'Adjustment', 'Expired', 'Transfer', 'Return'
  quantity_change DECIMAL(10,2) NOT NULL, -- Changed to DECIMAL for fractional quantities (ID route)
  quantity_after DECIMAL(10,2) NOT NULL, -- Changed to DECIMAL for fractional quantities (ID route)
  reference_type VARCHAR(50), -- 'ClinicalOrder', 'PurchaseOrder', 'Adjustment'
  reference_id UUID,
  performed_by_id UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

### **8. Lab Services (Optional - Only if offering lab services)**

```sql
CREATE TABLE partner_laboratories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  address TEXT,
  contact_person VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  turnaround_time_hours INTEGER,
  is_active BOOLEAN DEFAULT TRUE,
  api_config JSONB, -- Endpoint, auth, etc.
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE TABLE lab_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinical_order_id UUID NOT NULL REFERENCES clinical_orders(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  encounter_id UUID REFERENCES encounters(id),
  service_id UUID NOT NULL REFERENCES service_catalog(id),
  partner_lab_id UUID REFERENCES partner_laboratories(id), -- NULL if in-house
  status VARCHAR(50) DEFAULT 'Pending',
  sample_collected_at TIMESTAMP,
  sample_collected_by_id UUID REFERENCES users(id),
  sent_to_partner_at TIMESTAMP,
  results_received_at TIMESTAMP,
  released_to_patient_at TIMESTAMP,
  result_data JSONB, -- Structured results
  result_file_url VARCHAR(500), -- PDF link
  priority VARCHAR(50) DEFAULT 'Routine',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

### **9. Generic Audit Log (Replaces All Dedicated Audit Tables)**

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL, -- 'CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'CROSS_BRANCH_ACCESS', 'TRANSACTION_MODIFY', 'SCHEDULE_CHANGE'
  entity_type VARCHAR(100) NOT NULL, -- 'Patient', 'ClinicalOrder', 'Transaction', 'Payment', etc.
  entity_id UUID,
  branch_id UUID REFERENCES branches(id),
  ip_address VARCHAR(50),
  user_agent TEXT,
  changes JSONB, -- Before/after values, request details, approval info, etc.
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);

-- Partition by month for performance
CREATE TABLE audit_logs_2026_03 PARTITION OF audit_logs
FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
```

**What goes in audit_logs.changes (JSONB)**:

```jsonb
// Cross-branch access request
{
  "request_type": "cross_branch_access",
  "patient_id": "uuid",
  "patient_home_branch": "Cainta",
  "requesting_branch": "Antipolo",
  "reason": "Emergency dose needed",
  "status": "Approved",
  "approved_by": "uuid",
  "access_granted_until": "2026-03-10T18:00:00Z"
}

// Transaction modification
{
  "modification_type": "payment_method_change",
  "transaction_id": "uuid",
  "old_value": {"method": "Cash", "amount": 5000},
  "new_value": {"method": "GCash", "amount": 5000, "reference": "GC-123456"},
  "reason": "Patient requested change",
  "requested_by": "uuid",
  "approved_by": "uuid"
}

// Schedule change
{
  "change_type": "missed_dose_recalculation",
  "clinical_order_id": "uuid",
  "old_scheduled_date": "2026-03-12",
  "new_scheduled_date": "2026-03-14",
  "delay_days": 2,
  "reason": "Patient arrived late",
  "affected_orders": ["uuid1", "uuid2", "uuid3"]
}

// Patient data change
{
  "change_type": "patient_data_update",
  "patient_id": "uuid",
  "field": "contact_number",
  "old_value": "09171234567",
  "new_value": "09189876543",
  "reason": "Patient requested update",
  "requested_by": "uuid",
  "approved_by": "uuid"
}
```

---

### **10. Feature Flags (Module Management)**

```sql
CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id), -- NULL = global setting
  feature_name VARCHAR(100) NOT NULL, -- 'laboratory', 'pharmacy', 'telemedicine', 'imaging'
  is_enabled BOOLEAN DEFAULT FALSE,
  config JSONB, -- Feature-specific configuration
  enabled_at TIMESTAMP,
  enabled_by_id UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(branch_id, feature_name)
);

CREATE INDEX idx_feature_flags_branch ON feature_flags(branch_id);
CREATE INDEX idx_feature_flags_feature ON feature_flags(feature_name);
CREATE INDEX idx_feature_flags_enabled ON feature_flags(is_enabled);

COMMENT ON TABLE feature_flags IS 'Controls which optional modules are enabled per branch or globally';
COMMENT ON COLUMN feature_flags.config IS 'Feature-specific settings stored as JSONB (e.g., partner lab IDs, telemedicine platform config)';
```

**Example usage:**

```sql
-- Enable laboratory module for a specific branch
INSERT INTO feature_flags (branch_id, feature_name, is_enabled, config)
VALUES (
  'branch-uuid',
  'laboratory',
  TRUE,
  '{"in_house": false, "partner_labs": ["hi_precision", "quest"]}'::jsonb
);

-- Enable flu vaccination tracking globally
INSERT INTO feature_flags (branch_id, feature_name, is_enabled, config)
VALUES (
  NULL,
  'flu_vaccination',
  TRUE,
  '{"track_high_risk_groups": true, "require_risk_assessment": true}'::jsonb
);
```

---

### **11. Patient Tags (Segmentation)**

```sql
CREATE TABLE patient_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  tag VARCHAR(50) NOT NULL, -- 'VIP', 'High_Risk', 'Chronic', 'Corporate', 'HMO', 'Frequent_Visitor'
  created_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE INDEX idx_patient_tags_patient ON patient_tags(patient_id);
CREATE INDEX idx_patient_tags_tag ON patient_tags(tag);
CREATE UNIQUE INDEX idx_patient_tags_unique ON patient_tags(patient_id, tag);

COMMENT ON TABLE patient_tags IS 'Flexible tagging system for patient segmentation and special handling';
```

---

### **12. Notifications (Simple)**

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  clinical_order_id UUID REFERENCES clinical_orders(id), -- What they're being reminded about
  notification_type VARCHAR(50) NOT NULL, -- 'SMS', 'Email', 'Push'
  recipient VARCHAR(255) NOT NULL, -- Phone or email
  message TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Sent', 'Delivered', 'Failed'
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  error_message TEXT,
  external_reference VARCHAR(255), -- SMS gateway ref
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notifications_patient ON notifications(patient_id);
CREATE INDEX idx_notifications_status ON notifications(status);
```

---

## **What We Removed (Handled by audit_logs or application logic)**

❌ `cross_branch_access_requests` → Use audit_logs with action='CROSS_BRANCH_ACCESS'  
❌ `cross_branch_access_logs` → Use audit_logs  
❌ `patient_data_change_requests` → Use audit_logs with action='PATIENT_DATA_CHANGE'  
❌ `transaction_modifications` → Use audit_logs with action='TRANSACTION_MODIFY'  
❌ `clinical_order_schedule_changes` → Use audit_logs with action='SCHEDULE_CHANGE'  
❌ `recall_schedules` → Calculate on-the-fly from clinical_orders  
❌ `lab_results` → Merged into lab_orders (result_data JSONB)

---

## **Key Queries**

### **Daily Recall List (Calculate on-the-fly)**

```sql
SELECT
  p.first_name || ' ' || p.last_name AS patient_name,
  p.contact_number,
  sc.name AS service_name,
  co.current_scheduled_date,
  co.status
FROM clinical_orders co
JOIN patients p ON p.id = co.patient_id
JOIN service_catalog sc ON sc.id = co.service_id
WHERE co.current_scheduled_date = CURRENT_DATE
  AND co.status IN ('Pending', 'Due')
ORDER BY co.current_scheduled_date, p.last_name;
```

### **View Standing Order Progress**

```sql
-- FIXED: Extract from protocol_items JSONB instead of non-existent table
SELECT
  (item->>'day_offset')::INTEGER AS day_offset,
  (item->>'sequence')::INTEGER AS sequence,
  sc.name AS service_name,
  co.status,
  co.current_scheduled_date,
  co.completed_at,
  CASE
    WHEN ti.is_prepaid = TRUE THEN 'Prepaid'
    WHEN t.status = 'Paid' THEN 'Paid'
    ELSE 'Unpaid'
  END AS payment_status
FROM patient_standing_orders pso
JOIN standing_order_templates sot ON sot.id = pso.template_id
CROSS JOIN LATERAL jsonb_array_elements(sot.protocol_items) AS item
JOIN clinical_orders co ON co.standing_order_id = pso.id
  AND co.service_id = (item->>'service_id')::UUID
JOIN service_catalog sc ON sc.id = co.service_id
LEFT JOIN transaction_items ti ON ti.clinical_order_id = co.id
LEFT JOIN transactions t ON t.id = ti.transaction_id
WHERE pso.id = 'standing-order-uuid'
ORDER BY (item->>'day_offset')::INTEGER, (item->>'sequence')::INTEGER;
```

### **Cross-Branch Access Audit**

```sql
SELECT
  al.timestamp,
  u.first_name || ' ' || u.last_name AS user_name,
  al.action,
  al.changes->>'patient_home_branch' AS patient_branch,
  al.changes->>'requesting_branch' AS requesting_branch,
  al.changes->>'reason' AS reason,
  al.changes->>'status' AS status
FROM audit_logs al
JOIN users u ON u.id = al.user_id
WHERE al.action = 'CROSS_BRANCH_ACCESS'
  AND al.entity_id = 'patient-uuid'
ORDER BY al.timestamp DESC;
```

### **Patient Bite History (All Incidents)**

```sql
SELECT
  e.started_at::date AS incident_date,
  e.specialty_data->>'animal_type' AS animal_type,
  e.specialty_data->>'bite_category' AS bite_category,
  e.specialty_data->>'bite_location' AS bite_location,
  e.specialty_data->>'animal_status' AS animal_status,
  e.specialty_data->>'animal_observation_result' AS observation_result,
  pso.status AS pep_status,
  COUNT(co.id) FILTER (WHERE co.status = 'Completed') AS doses_completed,
  COUNT(co.id) AS total_doses
FROM encounters e
LEFT JOIN patient_standing_orders pso ON pso.initiating_encounter_id = e.id
LEFT JOIN clinical_orders co ON co.standing_order_id = pso.id
WHERE e.patient_id = 'patient-uuid'
  AND e.specialty = 'Rabies'
GROUP BY e.id, e.started_at, e.specialty_data, pso.status
ORDER BY e.started_at DESC;
```

### **Repeat Exposure Patients (Risk Analysis)**

```sql
SELECT
  p.first_name || ' ' || p.last_name AS patient_name,
  p.contact_number,
  COUNT(e.id) AS total_bite_incidents,
  MAX(e.started_at::date) AS last_bite_date,
  SUM(CASE WHEN (e.specialty_data->>'previous_pep_completed')::boolean = TRUE THEN 1 ELSE 0 END) AS completed_pep_count,
  SUM(CASE WHEN (e.specialty_data->>'previous_pep_completed')::boolean = FALSE THEN 1 ELSE 0 END) AS incomplete_pep_count
FROM patients p
JOIN encounters e ON e.patient_id = p.id
WHERE e.specialty = 'Rabies'
  AND (e.specialty_data->>'is_repeat_exposure')::boolean = TRUE
GROUP BY p.id, p.first_name, p.last_name, p.contact_number
HAVING COUNT(e.id) > 1
ORDER BY COUNT(e.id) DESC;
```

### **Animal Observation Tracking (14-Day Follow-Up)**

```sql
SELECT
  p.first_name || ' ' || p.last_name AS patient_name,
  p.contact_number,
  e.specialty_data->>'animal_type' AS animal_type,
  e.specialty_data->>'bite_category' AS bite_category,
  (e.specialty_data->>'animal_observation_start')::date AS observation_start,
  (e.specialty_data->>'animal_observation_end')::date AS observation_end,
  e.specialty_data->>'animal_observation_result' AS observation_result,
  CASE
    WHEN e.specialty_data->>'animal_observation_result' = 'Healthy' THEN 'Can discontinue PEP'
    WHEN e.specialty_data->>'animal_observation_result' IS NULL
         AND (e.specialty_data->>'animal_observation_end')::date < CURRENT_DATE THEN 'Overdue for follow-up'
    WHEN e.specialty_data->>'animal_observation_result' IS NULL THEN 'Observation in progress'
    ELSE 'Continue PEP'
  END AS recommendation
FROM encounters e
JOIN patients p ON p.id = e.patient_id
WHERE e.specialty = 'Rabies'
  AND (e.specialty_data->>'animal_observation_end')::date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY (e.specialty_data->>'animal_observation_end')::date;
```

### **Bite Incidents by Location (Epidemiological Tracking)**

```sql
SELECT
  e.specialty_data->>'incident_city' AS city,
  e.specialty_data->>'incident_barangay' AS barangay,
  COUNT(*) AS total_bites,
  SUM(CASE WHEN e.specialty_data->>'bite_category' = 'III' THEN 1 ELSE 0 END) AS category_3_bites,
  SUM(CASE WHEN e.specialty_data->>'animal_type' = 'Dog' THEN 1 ELSE 0 END) AS dog_bites,
  SUM(CASE WHEN e.specialty_data->>'animal_ownership' = 'Stray' THEN 1 ELSE 0 END) AS stray_animal_bites
FROM encounters e
WHERE e.specialty = 'Rabies'
  AND e.started_at >= '2026-01-01'
GROUP BY e.specialty_data->>'incident_city', e.specialty_data->>'incident_barangay'
ORDER BY total_bites DESC;
```

---

## **Summary**

**Total Tables**: 20 (up from 18, added feature_flags and patient_tags)

**Core Tables** (must have):

- branches, users, staff_time_logs
- patients, patient_tags
- service_catalog
- standing_order_templates, patient_standing_orders (template items stored as JSONB)
- encounters (with specialty and specialty_data JSONB), clinical_orders
- transactions, transaction_items, payments, payer_profiles
- inventory_lots, inventory_transactions
- feature_flags (module management)
- audit_logs, notifications

**Optional Tables** (only if needed):

- partner_laboratories, lab_orders (if offering lab services)

**Key Modularity Improvements**:

- ✅ Renamed `bite_incident` to `specialty_data` (more generic)
- ✅ Added `specialty` column to encounters ('Rabies', 'General', 'Flu', 'Vaccination')
- ✅ Added `feature_flags` table for module enable/disable per branch
- ✅ Added `patient_tags` table for flexible patient segmentation
- ✅ Added insurance fields to patients table (insurance_provider, insurance_number, insurance_expiry)
- ✅ Updated all queries to use specialty_data instead of bite_incident

**Removed Complexity**:

- ❌ standing_order_template_items → Stored as JSONB in standing_order_templates
- ❌ Dedicated audit tables for every entity → One audit_logs table
- ❌ recall_schedules → Calculate from clinical_orders
- ❌ lab_results → Use JSONB in lab_orders
- ❌ All approval workflows → Tracked in audit_logs

**Modularity**:

- Standing orders are the core abstraction
- Templates define the recipe (JSONB), clinical_orders are the instances
- Specialty-specific data stored in specialty_data JSONB (supports Rabies, Flu, General, etc.)
- Feature flags control which modules are enabled per branch
- Patient tags enable flexible segmentation without schema changes
- Everything else plugs into clinical_orders
- Audit logs handle all change tracking
- JSONB for flexible datata that doesn't need complex queries
