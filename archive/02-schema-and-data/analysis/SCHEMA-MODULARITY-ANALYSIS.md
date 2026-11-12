# Database Schema Modularity Analysis & Recommendations

Analysis of SureVax CMS v2.0 schema for future expansion from rabies clinic to full urgent care center.

---

## Current Schema Assessment

**Current State**: 18 tables, rabies-focused
**Future Vision**: Urgent care center with flu vaccines, diagnostics, general consultations
**Expansion Path**: 3-5 branches → 10+ branches → franchise model → SaaS platform

---

## Modularity Score: 8/10 ⭐

**Strengths:**

- ✅ Generic `service_catalog` (not vaccine-specific)
- ✅ Standing orders abstraction (works for any protocol)
- ✅ Multi-tenancy built-in (`branch_id` everywhere)
- ✅ Generic `audit_logs` (not entity-specific)
- ✅ JSONB for flexible data (bite_incident, clinical_notes)
- ✅ Separate `clinical_orders` from `encounters` (good separation)

**Weaknesses:**

- ⚠️ Bite incident data in encounters (rabies-specific)
- ⚠️ No module/feature flag system
- ⚠️ Lab services optional but not fully modular
- ⚠️ No telemedicine support

---

## Module Breakdown (Current Schema)

### Core Modules (Always Required)

#### 1. **Multi-Tenancy Module**

**Tables**: `branches`, `users`, `staff_time_logs`
**Purpose**: Foundation for all other modules
**Status**: ✅ Well-designed, scalable

**Expansion Readiness**: 10/10

- Can support unlimited branches
- Role-based access control ready
- Staff time tracking works for any specialty

---

#### 2. **Patient Management Module**

**Tables**: `patients`
**Purpose**: Central patient registry
**Status**: ✅ Generic, not disease-specific

**Expansion Readiness**: 9/10

- Full-text search ready
- Guardian info for pediatrics
- Emergency contacts
- Allergies and medical conditions

**Recommendations:**

```sql
-- Add insurance information (for future HMO expansion)
ALTER TABLE patients ADD COLUMN insurance_provider VARCHAR(255);
ALTER TABLE patients ADD COLUMN insurance_number VARCHAR(100);
ALTER TABLE patients ADD COLUMN insurance_expiry DATE;

-- Add patient tags for segmentation
CREATE TABLE patient_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  tag VARCHAR(50) NOT NULL, -- 'VIP', 'Chronic', 'High-Risk', 'Corporate'
  created_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);
CREATE INDEX idx_patient_tags_patient ON patient_tags(patient_id);
CREATE INDEX idx_patient_tags_tag ON patient_tags(tag);
```

---

#### 3. **Service Catalog Module**

**Tables**: `service_catalog`
**Purpose**: Unified catalog for all services
**Status**: ✅ Excellent design, fully generic

**Expansion Readiness**: 10/10

- Already supports: Immunization, Laboratory, Consultation, Procedure, Goods
- Can add: Telemedicine, Therapy, Imaging, Surgery
- Full-text search ready
- Pricing flexibility

**No changes needed** - this is perfect for expansion!

---

#### 4. **Clinical Operations Module**

**Tables**: `encounters`, `clinical_orders`, `standing_order_templates`, `patient_standing_orders`
**Purpose**: Core clinical workflow
**Status**: ⚠️ Mostly generic, but bite_incident is rabies-specific

**Expansion Readiness**: 7/10

**Issue**: `bite_incident` JSONB in encounters is rabies-specific

**Solution**: Make encounters fully generic with specialty-specific data

```sql
-- Rename bite_incident to specialty_data (more generic)
ALTER TABLE encounters RENAME COLUMN bite_incident TO specialty_data;

-- Add specialty type to encounters
ALTER TABLE encounters ADD COLUMN specialty VARCHAR(50);
-- 'Rabies', 'General', 'Pediatrics', 'Flu', 'COVID', 'Telemedicine'

CREATE INDEX idx_encounters_specialty ON encounters(specialty);

-- Update comments
COMMENT ON COLUMN encounters.specialty_data IS
'Specialty-specific data stored as JSONB.
For Rabies: bite incident details
For Flu: exposure history, symptoms
For General: chief complaint details
For Telemedicine: video session info';
```

**Example specialty_data structures:**

```jsonb
// Rabies (current bite_incident structure)
{
  "incident_date": "2026-03-09",
  "animal_type": "Dog",
  "bite_category": "III",
  ...
}

// Flu Vaccination
{
  "vaccine_type": "Quadrivalent",
  "high_risk_group": true,
  "risk_factors": ["Elderly", "Chronic_Disease"],
  "previous_flu_vaccines": [
    {"date": "2025-10-01", "type": "Trivalent"}
  ]
}

// General Consultation
{
  "chief_complaint": "Fever and cough for 3 days",
  "symptoms": ["Fever", "Cough", "Fatigue"],
  "duration_days": 3,
  "severity": "Moderate"
}

// Telemedicine
{
  "session_type": "Video",
  "platform": "Zoom",
  "session_id": "123-456-789",
  "duration_minutes": 15,
  "connection_quality": "Good"
}
```

---

#### 5. **Billing Module**

**Tables**: `transactions`, `transaction_items`, `payments`, `payer_profiles`
**Purpose**: Financial transactions
**Status**: ✅ Fully generic

**Expansion Readiness**: 10/10

- Works for any service type
- Split payment support
- HMO/insurance ready via `payer_profiles`
- Prepayment support

**Recommendations for HMO expansion:**

```sql
-- Add claim tracking
CREATE TABLE insurance_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  payer_id UUID NOT NULL REFERENCES payer_profiles(id),
  claim_number VARCHAR(100) UNIQUE,
  claim_date DATE NOT NULL,
  claim_amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(50) DEFAULT 'Submitted', -- 'Submitted', 'Approved', 'Denied', 'Paid'
  denial_reason TEXT,
  paid_amount DECIMAL(10,2),
  paid_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_insurance_claims_transaction ON insurance_claims(transaction_id);
CREATE INDEX idx_insurance_claims_payer ON insurance_claims(payer_id);
CREATE INDEX idx_insurance_claims_status ON insurance_claims(status);
```

---

### Optional Modules (Add as Needed)

#### 6. **Laboratory Module** (Currently Optional)

**Tables**: `partner_laboratories`, `lab_orders`
**Purpose**: Lab test management
**Status**: ✅ Good foundation

**Expansion Readiness**: 8/10

**Recommendations for in-house lab:**

```sql
-- Add lab equipment tracking
CREATE TABLE lab_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  equipment_name VARCHAR(255) NOT NULL,
  equipment_type VARCHAR(100), -- 'Analyzer', 'Microscope', 'Centrifuge'
  manufacturer VARCHAR(255),
  model VARCHAR(100),
  serial_number VARCHAR(100),
  purchase_date DATE,
  warranty_expiry DATE,
  last_calibration_date DATE,
  next_calibration_date DATE,
  status VARCHAR(50) DEFAULT 'Active', -- 'Active', 'Maintenance', 'Retired'
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add lab test templates (for standardization)
CREATE TABLE lab_test_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES service_catalog(id),
  test_name VARCHAR(255) NOT NULL,
  test_code VARCHAR(50) UNIQUE,
  specimen_type VARCHAR(100), -- 'Blood', 'Urine', 'Swab'
  normal_range_min DECIMAL(10,2),
  normal_range_max DECIMAL(10,2),
  unit VARCHAR(50),
  turnaround_time_hours INTEGER,
  instructions TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

#### 7. **Pharmacy Module** (NEW - Needed for Expansion)

**Tables**: Currently using `inventory_lots` (generic)
**Purpose**: Medication dispensing and tracking
**Status**: ⚠️ Needs expansion for full pharmacy

**Expansion Readiness**: 6/10

**Recommendations:**

```sql
-- Add medication-specific tracking
CREATE TABLE medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES service_catalog(id),
  generic_name VARCHAR(255) NOT NULL,
  brand_name VARCHAR(255),
  drug_class VARCHAR(100), -- 'Antibiotic', 'Analgesic', 'Antiviral'
  dosage_form VARCHAR(50), -- 'Tablet', 'Capsule', 'Syrup', 'Injection'
  strength VARCHAR(50), -- '500mg', '10ml'
  route VARCHAR(50), -- 'Oral', 'IV', 'IM', 'Topical'
  requires_prescription BOOLEAN DEFAULT TRUE,
  controlled_substance BOOLEAN DEFAULT FALSE,
  storage_requirements TEXT,
  side_effects TEXT,
  contraindications TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add prescription tracking
CREATE TABLE prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  prescribing_provider_id UUID NOT NULL REFERENCES users(id),
  prescription_date DATE NOT NULL,
  status VARCHAR(50) DEFAULT 'Active', -- 'Active', 'Completed', 'Cancelled'
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE prescription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id),
  medication_id UUID NOT NULL REFERENCES medications(id),
  dosage VARCHAR(100), -- '500mg twice daily'
  quantity INTEGER,
  refills INTEGER DEFAULT 0,
  instructions TEXT,
  dispensed_quantity INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

#### 8. **Telemedicine Module** (NEW - Future)

**Tables**: None yet
**Purpose**: Virtual consultations
**Status**: ⚠️ Not implemented

**Expansion Readiness**: 0/10 (needs design)

**Recommendations:**

```sql
-- Add telemedicine sessions
CREATE TABLE telemedicine_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  provider_id UUID NOT NULL REFERENCES users(id),
  session_type VARCHAR(50) NOT NULL, -- 'Video', 'Audio', 'Chat'
  platform VARCHAR(50), -- 'Zoom', 'Google Meet', 'Custom'
  session_url VARCHAR(500),
  session_id VARCHAR(255),
  scheduled_start TIMESTAMP NOT NULL,
  actual_start TIMESTAMP,
  actual_end TIMESTAMP,
  duration_minutes INTEGER,
  status VARCHAR(50) DEFAULT 'Scheduled', -- 'Scheduled', 'In_Progress', 'Completed', 'Cancelled', 'No_Show'
  connection_quality VARCHAR(50), -- 'Excellent', 'Good', 'Fair', 'Poor'
  recording_url VARCHAR(500),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_telemedicine_sessions_encounter ON telemedicine_sessions(encounter_id);
CREATE INDEX idx_telemedicine_sessions_patient ON telemedicine_sessions(patient_id);
CREATE INDEX idx_telemedicine_sessions_provider ON telemedicine_sessions(provider_id);
CREATE INDEX idx_telemedicine_sessions_status ON telemedicine_sessions(status);
```

---

#### 9. **Imaging Module** (NEW - Future)

**Tables**: None yet
**Purpose**: X-ray, ultrasound, etc.
**Status**: ⚠️ Not implemented

**Expansion Readiness**: 0/10 (needs design)

**Recommendations:**

```sql
-- Add imaging orders
CREATE TABLE imaging_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinical_order_id UUID NOT NULL REFERENCES clinical_orders(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  encounter_id UUID REFERENCES encounters(id),
  service_id UUID NOT NULL REFERENCES service_catalog(id),
  imaging_type VARCHAR(100) NOT NULL, -- 'X-Ray', 'Ultrasound', 'CT', 'MRI'
  body_part VARCHAR(100),
  indication TEXT,
  status VARCHAR(50) DEFAULT 'Pending',
  scheduled_date TIMESTAMP,
  performed_date TIMESTAMP,
  performed_by_id UUID REFERENCES users(id),
  radiologist_id UUID REFERENCES users(id),
  findings TEXT,
  impression TEXT,
  image_urls JSONB, -- Array of image URLs
  dicom_study_id VARCHAR(255),
  priority VARCHAR(50) DEFAULT 'Routine',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## Module Dependency Map

```
┌─────────────────────────────────────────────────────┐
│              Core Platform (Always On)              │
│  • Multi-Tenancy                                    │
│  • Patient Management                               │
│  • Service Catalog                                  │
│  • Clinical Operations (Encounters, Orders)         │
│  • Billing                                          │
│  • Audit Logs                                       │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│           Optional Modules (Enable as Needed)       │
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐│
│  │ Laboratory   │  │ Pharmacy     │  │ Inventory ││
│  │ (In-house or │  │ (Dispensing) │  │ (Stock)   ││
│  │  Partner)    │  │              │  │           ││
│  └──────────────┘  └──────────────┘  └───────────┘│
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐│
│  │ Telemedicine │  │ Imaging      │  │ Therapy   ││
│  │ (Video)      │  │ (X-ray, US)  │  │ (PT, OT)  ││
│  └──────────────┘  └──────────────┘  └───────────┘│
└─────────────────────────────────────────────────────┘
```

---

## Feature Flag System (Recommended)

Add a feature flag system to enable/disable modules per branch:

```sql
CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id), -- NULL = global
  feature_name VARCHAR(100) NOT NULL, -- 'laboratory', 'pharmacy', 'telemedicine'
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
```

**Example usage:**

```sql
-- Enable laboratory module for Holy Spirit branch
INSERT INTO feature_flags (branch_id, feature_name, is_enabled, config)
VALUES (
  'holy-spirit-branch-uuid',
  'laboratory',
  TRUE,
  '{"in_house": true, "partner_labs": ["hi_precision", "quest"]}'::jsonb
);

-- Enable telemedicine globally
INSERT INTO feature_flags (branch_id, feature_name, is_enabled, config)
VALUES (
  NULL,
  'telemedicine',
  TRUE,
  '{"platform": "zoom", "max_duration_minutes": 30}'::jsonb
);
```

---

## Specialty-Specific Tables (Recommended Pattern)

Instead of cramming everything into JSONB, create specialty-specific tables that reference encounters:

```sql
-- Rabies-specific data (move from encounters.specialty_data)
CREATE TABLE rabies_exposures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id) UNIQUE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  incident_date DATE NOT NULL,
  animal_type VARCHAR(50),
  animal_ownership VARCHAR(50),
  bite_category VARCHAR(10),
  bite_location TEXT,
  animal_status VARCHAR(50),
  animal_observation_start DATE,
  animal_observation_end DATE,
  animal_observation_result VARCHAR(50),
  is_repeat_exposure BOOLEAN DEFAULT FALSE,
  previous_pep_completed BOOLEAN,
  previous_pep_date DATE,
  incident_barangay VARCHAR(100),
  incident_city VARCHAR(100),
  incident_province VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Flu-specific data
CREATE TABLE flu_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id) UNIQUE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  vaccine_type VARCHAR(100), -- 'Trivalent', 'Quadrivalent'
  high_risk_group BOOLEAN DEFAULT FALSE,
  risk_factors JSONB, -- Array of risk factors
  previous_flu_vaccines JSONB, -- Array of previous vaccines
  symptoms JSONB, -- If presenting with flu symptoms
  rapid_test_result VARCHAR(50), -- 'Positive', 'Negative', 'Not_Done'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- COVID-specific data
CREATE TABLE covid_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id) UNIQUE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  test_type VARCHAR(50), -- 'RT-PCR', 'Antigen', 'Antibody'
  test_result VARCHAR(50),
  test_date DATE,
  vaccination_status VARCHAR(50),
  vaccine_doses INTEGER,
  last_vaccine_date DATE,
  exposure_history JSONB,
  symptoms JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Benefits:**

- ✅ Queryable (no JSONB operators needed)
- ✅ Indexed (better performance)
- ✅ Type-safe (database enforces structure)
- ✅ Optional (only create if specialty is enabled)
- ✅ Backward compatible (encounters.specialty_data still available)

---

## Migration Path

### Phase 1: Current (Rabies Focus)

- ✅ 18 tables
- ✅ Rabies-specific features
- ✅ Multi-branch ready

### Phase 2: Urgent Care Expansion (3-6 months)

- Add `specialty` column to encounters
- Rename `bite_incident` to `specialty_data`
- Add `flu_assessments` table
- Add `feature_flags` table
- Enable laboratory module
- Add `medications` and `prescriptions` tables

### Phase 3: Full Clinic (6-12 months)

- Add `telemedicine_sessions` table
- Add `imaging_orders` table
- Add `insurance_claims` table
- Add `patient_tags` table
- Enable all optional modules

### Phase 4: Franchise/SaaS (12+ months)

- Multi-tenant optimization
- API rate limiting
- Usage-based billing
- White-label support
- Advanced analytics

---

## Recommended Schema Changes (Priority Order)

### High Priority (Do Now)

1. ✅ Rename `bite_incident` to `specialty_data`
2. ✅ Add `specialty` column to encounters
3. ✅ Add `feature_flags` table
4. ✅ Add `patient_tags` table

### Medium Priority (Next 3 Months)

5. ⏳ Add `medications` and `prescriptions` tables
6. ⏳ Add `flu_assessments` table
7. ⏳ Add `insurance_claims` table
8. ⏳ Expand `lab_orders` with templates

### Low Priority (6+ Months)

9. ⏳ Add `telemedicine_sessions` table
10. ⏳ Add `imaging_orders` table
11. ⏳ Add `therapy_sessions` table (PT/OT)
12. ⏳ Add `referrals` table (to specialists)

---

## Conclusion

**Current Modularity Score: 8/10** ⭐

Your schema is already well-designed for expansion! The main improvements needed are:

1. **Make encounters generic** (rename bite_incident to specialty_data)
2. **Add feature flags** (enable/disable modules per branch)
3. **Add specialty-specific tables** (better than JSONB for complex data)
4. **Plan for pharmacy module** (needed for urgent care)
5. **Plan for telemedicine** (future growth opportunity)

The foundation is solid. With these changes, you'll have a truly modular system that can grow from rabies clinic → urgent care → full primary care → SaaS platform.

---

**Next Steps:**

1. Review this analysis with team
2. Prioritize schema changes
3. Create migration scripts
4. Update documentation
5. Plan feature rollout timeline
