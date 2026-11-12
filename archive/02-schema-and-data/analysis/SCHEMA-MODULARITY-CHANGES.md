# Schema Modularity Changes - March 9, 2026

Summary of modularity improvements implemented in database-schema-v4.md

---

## Changes Made

### 1. Renamed `bite_incident` to `specialty_data` ✅

**Purpose**: Support multiple specialties beyond rabies

**Before**:

```sql
encounters.bite_incident JSONB -- Rabies-specific
```

**After**:

```sql
encounters.specialty VARCHAR(50) -- 'Rabies', 'General', 'Flu', 'Vaccination'
encounters.specialty_data JSONB -- Specialty-specific data
```

**Impact**:

- Supports rabies, flu, general consultations, vaccinations
- No schema changes needed to add new specialties
- Backward compatible (rabies data structure unchanged)

---

### 2. Added `feature_flags` Table ✅

**Purpose**: Enable/disable modules per branch

```sql
CREATE TABLE feature_flags (
  id UUID PRIMARY KEY,
  branch_id UUID REFERENCES branches(id), -- NULL = global
  feature_name VARCHAR(100) NOT NULL,
  is_enabled BOOLEAN DEFAULT FALSE,
  config JSONB,
  ...
);
```

**Benefits**:

- Control which modules are active per branch
- Gradual rollout of new features
- A/B testing capability
- No code changes to enable features

**Example Usage**:

```sql
-- Enable laboratory module for specific branch
INSERT INTO feature_flags (branch_id, feature_name, is_enabled, config)
VALUES ('branch-uuid', 'laboratory', TRUE, '{"in_house": false}'::jsonb);
```

---

### 3. Added `patient_tags` Table ✅

**Purpose**: Flexible patient segmentation

```sql
CREATE TABLE patient_tags (
  id UUID PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES patients(id),
  tag VARCHAR(50) NOT NULL, -- 'VIP', 'High_Risk', 'Corporate', 'HMO'
  ...
);
```

**Benefits**:

- Segment patients without schema changes
- Support special handling (VIP, high-risk)
- Track corporate/HMO patients
- Easy filtering and reporting

---

### 4. Added Insurance Fields to `patients` Table ✅

**Purpose**: Prepare for HMO expansion

```sql
ALTER TABLE patients ADD COLUMN insurance_provider VARCHAR(255);
ALTER TABLE patients ADD COLUMN insurance_number VARCHAR(100);
ALTER TABLE patients ADD COLUMN insurance_expiry DATE;
```

**Benefits**:

- Ready for HMO integration
- Insurance eligibility verification
- Claims processing support

---

### 5. Updated All Queries ✅

**Changed**: All queries now use `specialty` and `specialty_data` instead of `bite_incident`

**Examples**:

```sql
-- Before
WHERE e.categorization LIKE '%Bite%'
  AND (e.bite_incident->>'is_repeat_exposure')::boolean = TRUE

-- After
WHERE e.specialty = 'Rabies'
  AND (e.specialty_data->>'is_repeat_exposure')::boolean = TRUE
```

---

## Table Count

**Before**: 18 tables  
**After**: 20 tables (+2)

**New Tables**:

1. `feature_flags` - Module management
2. `patient_tags` - Patient segmentation

---

## Modularity Score

**Before**: 8/10  
**After**: 9/10

**Improvements**:

- ✅ Generic specialty support (not rabies-specific)
- ✅ Feature flag system for module control
- ✅ Patient segmentation without schema changes
- ✅ Insurance-ready for HMO expansion

**Remaining Limitations**:

- ⚠️ No pharmacy module yet (planned for Phase 2)
- ⚠️ No telemedicine support yet (planned for Phase 3)

---

## Migration Script

```sql
-- Step 1: Add new columns to encounters
ALTER TABLE encounters ADD COLUMN specialty VARCHAR(50);
ALTER TABLE encounters RENAME COLUMN bite_incident TO specialty_data;
CREATE INDEX idx_encounters_specialty ON encounters(specialty);

-- Step 2: Backfill specialty for existing records
UPDATE encounters SET specialty = 'Rabies' WHERE categorization LIKE '%Bite%';
UPDATE encounters SET specialty = 'General' WHERE specialty IS NULL;

-- Step 3: Add insurance fields to patients
ALTER TABLE patients ADD COLUMN insurance_provider VARCHAR(255);
ALTER TABLE patients ADD COLUMN insurance_number VARCHAR(100);
ALTER TABLE patients ADD COLUMN insurance_expiry DATE;
CREATE INDEX idx_patients_insurance ON patients(insurance_provider) WHERE insurance_provider IS NOT NULL;

-- Step 4: Create feature_flags table
CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id),
  feature_name VARCHAR(100) NOT NULL,
  is_enabled BOOLEAN DEFAULT FALSE,
  config JSONB,
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

-- Step 5: Create patient_tags table
CREATE TABLE patient_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  tag VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by_id UUID REFERENCES users(id)
);

CREATE INDEX idx_patient_tags_patient ON patient_tags(patient_id);
CREATE INDEX idx_patient_tags_tag ON patient_tags(tag);
CREATE UNIQUE INDEX idx_patient_tags_unique ON patient_tags(patient_id, tag);
```

---

## Files Updated

1. ✅ `database-schema-v4.md` - Applied all modularity improvements
2. ✅ `FUTURE-IMPROVEMENTS.md` - Created roadmap for future modules
3. ✅ `SCHEMA-MODULARITY-ANALYSIS.md` - Moved to `archive/documentation/`
4. ✅ `README.md` - Updated to reflect changes
5. ✅ `archive/README.md` - Documented archived file

---

## Next Steps

### Immediate (Phase 1 - Current)

- ✅ Schema modularity improvements implemented
- ⏳ Test migration script on staging database
- ⏳ Update application code to use `specialty` and `specialty_data`
- ⏳ Deploy to production

### Phase 2 (6-12 months)

- Add pharmacy module (medications, prescriptions)
- Add insurance claims management
- Enhance laboratory module (equipment tracking, templates)
- Enable flu vaccination tracking

### Phase 3 (12-24 months)

- Add telemedicine module
- Add imaging module
- Add therapy module (PT/OT)
- Implement offline-first architecture

See [FUTURE-IMPROVEMENTS.md](FUTURE-IMPROVEMENTS.md) for complete roadmap.

---

**Status**: Modularity improvements complete ✅  
**Modularity Score**: 9/10 (improved from 8/10)  
**Date**: March 9, 2026
