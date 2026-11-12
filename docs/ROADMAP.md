# Future Improvements & Module Expansion

Roadmap for expanding SureVax CMS from rabies clinic to full urgent care and beyond.

---

## Vision

**Current State**: Rabies Post-Exposure Prophylaxis (PEP) clinic with basic immunization tracking  
**Phase 2 (6-12 months)**: Urgent care center with flu vaccines, diagnostics, general consultations  
**Phase 3 (12-24 months)**: Full primary care with pharmacy, telemedicine, imaging  
**Phase 4 (24+ months)**: Multi-specialty franchise model with SaaS platform

---

## Module Expansion Roadmap

### Phase 2: Urgent Care Expansion (6-12 months)

#### 1. Pharmacy Module

**Purpose**: Medication dispensing, prescription tracking, controlled substance management

**New Tables**:

```sql
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

**Benefits**:

- Track medication inventory separately from vaccines
- E-prescribing capability
- Controlled substance tracking for DOH compliance
- Drug interaction checking
- Refill management

---

#### 2. Enhanced Laboratory Module

**Purpose**: In-house lab equipment tracking, test templates, quality control

**New Tables**:

```sql
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

**Benefits**:

- Equipment maintenance tracking
- Standardized test templates
- Normal range validation
- Quality control compliance

---

#### 3. Insurance Claims Management

**Purpose**: HMO billing, claim tracking, accounts receivable

**New Tables**:

```sql
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

**Benefits**:

- Track HMO claim lifecycle
- Accounts receivable aging reports
- Denial management
- Payment reconciliation

---

### Phase 3: Full Primary Care (12-24 months)

#### 4. Telemedicine Module

**Purpose**: Virtual consultations, video sessions, remote monitoring

**New Tables**:

```sql
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

**Benefits**:

- Expand reach to remote patients
- Reduce no-shows
- Follow-up consultations without clinic visit
- COVID-safe consultations

---

#### 5. Imaging Module

**Purpose**: X-ray, ultrasound, DICOM integration

**New Tables**:

```sql
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

CREATE INDEX idx_imaging_orders_patient ON imaging_orders(patient_id);
CREATE INDEX idx_imaging_orders_status ON imaging_orders(status);
CREATE INDEX idx_imaging_orders_scheduled ON imaging_orders(scheduled_date);
```

**Benefits**:

- In-house imaging capability
- PACS integration
- Radiologist workflow
- Image archival

---

#### 6. Therapy Module (Physical Therapy, Occupational Therapy)

**Purpose**: Rehabilitation services, therapy sessions, progress tracking

**New Tables**:

```sql
CREATE TABLE therapy_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  encounter_id UUID REFERENCES encounters(id),
  therapy_type VARCHAR(50) NOT NULL, -- 'Physical_Therapy', 'Occupational_Therapy', 'Speech_Therapy'
  diagnosis TEXT,
  goals TEXT,
  start_date DATE NOT NULL,
  end_date DATE,
  status VARCHAR(50) DEFAULT 'Active', -- 'Active', 'Completed', 'Discontinued'
  therapist_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE therapy_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES therapy_programs(id),
  session_date DATE NOT NULL,
  duration_minutes INTEGER,
  therapist_id UUID NOT NULL REFERENCES users(id),
  activities JSONB, -- Array of activities performed
  progress_notes TEXT,
  patient_response VARCHAR(50), -- 'Excellent', 'Good', 'Fair', 'Poor'
  next_session_plan TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Benefits**:

- Comprehensive rehabilitation tracking
- Progress monitoring
- Insurance documentation
- Outcome measurement

---

### Phase 4: Multi-Specialty & SaaS (24+ months)

#### 7. Referral Management

**Purpose**: Specialist referrals, care coordination, follow-up tracking

**New Tables**:

```sql
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  encounter_id UUID REFERENCES encounters(id),
  referring_provider_id UUID NOT NULL REFERENCES users(id),
  specialty VARCHAR(100) NOT NULL, -- 'Cardiology', 'Dermatology', 'Orthopedics'
  reason TEXT NOT NULL,
  urgency VARCHAR(50) DEFAULT 'Routine', -- 'Urgent', 'Routine', 'Follow_Up'
  referred_to_name VARCHAR(255),
  referred_to_contact VARCHAR(100),
  referral_date DATE NOT NULL,
  appointment_date DATE,
  status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Scheduled', 'Completed', 'Cancelled'
  feedback TEXT, -- From specialist
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Benefits**:

- Care coordination
- Specialist network management
- Follow-up tracking
- Outcome monitoring

---

#### 8. Chronic Disease Management

**Purpose**: Long-term condition tracking, care plans, monitoring

**New Tables**:

```sql
CREATE TABLE chronic_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  condition_name VARCHAR(255) NOT NULL, -- 'Diabetes', 'Hypertension', 'Asthma'
  icd10_code VARCHAR(20),
  diagnosis_date DATE,
  severity VARCHAR(50), -- 'Mild', 'Moderate', 'Severe'
  status VARCHAR(50) DEFAULT 'Active', -- 'Active', 'Controlled', 'Resolved'
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE care_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  condition_id UUID REFERENCES chronic_conditions(id),
  plan_name VARCHAR(255) NOT NULL,
  goals TEXT,
  interventions JSONB, -- Array of planned interventions
  start_date DATE NOT NULL,
  review_date DATE,
  status VARCHAR(50) DEFAULT 'Active',
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE care_plan_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id UUID NOT NULL REFERENCES care_plans(id),
  activity_type VARCHAR(100), -- 'Medication', 'Lab_Test', 'Lifestyle_Change', 'Follow_Up'
  description TEXT,
  frequency VARCHAR(100), -- 'Daily', 'Weekly', 'Monthly'
  due_date DATE,
  completed_date DATE,
  status VARCHAR(50) DEFAULT 'Pending',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Benefits**:

- Proactive chronic disease management
- Care plan adherence tracking
- Population health management
- Quality metrics reporting

---

#### 9. Multi-Tenant SaaS Features

**New Tables**:

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  subscription_tier VARCHAR(50), -- 'Basic', 'Professional', 'Enterprise'
  subscription_status VARCHAR(50) DEFAULT 'Active',
  max_branches INTEGER,
  max_users INTEGER,
  billing_email VARCHAR(255),
  billing_address TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add organization_id to branches table
ALTER TABLE branches ADD COLUMN organization_id UUID REFERENCES organizations(id);

CREATE TABLE usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  branch_id UUID REFERENCES branches(id),
  metric_type VARCHAR(100), -- 'Encounters', 'Transactions', 'Storage_GB', 'API_Calls'
  metric_value DECIMAL(10,2),
  recorded_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE subscription_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  invoice_number VARCHAR(100) UNIQUE,
  billing_period_start DATE,
  billing_period_end DATE,
  amount DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'Pending',
  due_date DATE,
  paid_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Benefits**:

- Multi-organization support
- Usage-based billing
- Subscription management
- White-label capability

---

## UI/UX Enhancements

### 1. Advanced Keyboard Shortcuts System

**Timeline**: Phase 2  
**Technology**: Command Palette or Sequence-Based Navigation

**Why Deferred:**
Browser shortcuts (Ctrl+N, Ctrl+T, Ctrl+D, etc.) conflict with native browser functions and behave inconsistently across:

- Different browsers (Chrome, Firefox, Safari)
- Different operating systems (Windows, macOS, Linux)
- Different keyboard layouts

**Proposed Solutions:**

#### Option A: Command Palette (Recommended)

- **Trigger**: `Ctrl+K` (Windows/Linux) or `Cmd+K` (macOS)
- **Behavior**: Opens searchable command palette
- **Examples**:
  - Type "new patient" → Enter
  - Type "scheduled orders" → Enter
  - Type "transaction" → Enter
- **Benefits**:
  - No browser conflicts
  - Discoverable (users can see all commands)
  - Searchable (fuzzy matching)
  - Works consistently everywhere

#### Option B: Sequence-Based Shortcuts

- **Pattern**: Press key sequence (like Vim or Gmail)
- **Examples**:
  - `g` then `p` = "Go to Patients"
  - `g` then `s` = "Go to Scheduled Orders"
  - `n` then `p` = "New Patient"
  - `n` then `t` = "New Transaction"
- **Benefits**:
  - No modifier keys needed
  - No browser conflicts
  - Fast for power users
  - Memorable mnemonics

#### Option C: Alt/Option Modifier

- **Pattern**: Use `Alt` (Windows) or `Option` (Mac) instead of `Ctrl`
- **Examples**:
  - `Alt+N` = New Patient
  - `Alt+T` = New Transaction
  - `Alt+S` = Scheduled Orders
- **Benefits**:
  - Familiar modifier key pattern
  - Less browser conflicts than Ctrl
- **Drawbacks**:
  - Still some browser conflicts
  - Accessibility menu conflicts on some systems

**Recommended Implementation:**
Combine Command Palette (primary) with sequence shortcuts (power users):

- `Ctrl+K` / `Cmd+K` opens command palette (everyone)
- `g`, `n`, `c` sequences for power users (optional)
- Visual hints show available shortcuts
- Help modal (`?` key) shows all shortcuts

**Features to Include:**

- Recent commands history
- Fuzzy search
- Keyboard navigation (↑↓ arrows)
- Visual shortcut hints in tooltips
- Customizable shortcuts (Phase 3)
- Shortcut cheat sheet (printable)

---

## Technology Improvements

### 1. Offline-First Architecture

**Timeline**: Phase 3  
**Technology**: IndexedDB, Service Workers, PWA

**Benefits**:

- Works without internet
- Sync when online
- Better user experience
- Critical for remote branches

---

### 2. Mobile Applications

**Timeline**: Phase 3  
**Technology**: React Native or Flutter

**Features**:

- Patient mobile app (view records, book appointments)
- Provider mobile app (view schedules, access records)
- Inventory mobile app (barcode scanning, stock checks)

---

### 3. Advanced Analytics & Reporting

**Timeline**: Phase 4  
**Technology**: Data warehouse, BI tools

**Features**:

- Population health analytics
- Financial dashboards
- Operational metrics
- Predictive analytics

---

### 4. AI/ML Features

**Timeline**: Phase 4  
**Technology**: TensorFlow, scikit-learn

**Features**:

- Appointment no-show prediction
- Inventory demand forecasting
- Clinical decision support
- Automated coding (ICD-10)

---

## Integration Opportunities

### 1. Philippine Health Systems

- **PhilHealth**: Claims submission, eligibility verification
- **DOH PIDSR**: Automated disease surveillance reporting
- **NaRIS**: Rabies case reporting
- **National Health Data Repository**: FHIR integration

### 2. Payment Gateways

- **GCash**: Digital wallet integration
- **Maya**: Digital wallet integration
- **PayMongo**: Credit card processing
- **Dragonpay**: Multi-channel payment aggregator

### 3. SMS Gateways

- **Semaphore**: SMS notifications
- **Twilio**: SMS and voice
- **Vonage**: SMS and WhatsApp

### 4. Laboratory Partners

- **Hi-Precision Diagnostics**: Lab order integration
- **Quest Diagnostics**: Lab order integration
- **HealthHub**: Lab order integration

---

## Infrastructure Scaling

### Current (Phase 1)

- Single PostgreSQL instance
- Monolithic application
- Manual backups

### Phase 2

- PostgreSQL with read replicas
- Redis caching
- Automated backups
- CDN for static assets

### Phase 3

- Database sharding by organization
- Microservices for heavy modules
- Message queue (RabbitMQ/Kafka)
- Elasticsearch for search

### Phase 4

- Multi-region deployment
- Auto-scaling
- Real-time data replication
- Advanced monitoring (Datadog, New Relic)

---

## Security Enhancements

### Phase 2

- Two-factor authentication (2FA)
- Role-based access control (RBAC) refinement
- API rate limiting
- Intrusion detection

### Phase 3

- Single Sign-On (SSO)
- Biometric authentication
- Advanced threat detection
- Penetration testing

### Phase 4

- Zero-trust architecture
- End-to-end encryption
- Blockchain for audit trails
- SOC 2 compliance

---

## Compliance & Certification

### Phase 2

- DOH SCIV certification (EMR standards)
- ISO 27001 (Information Security)

### Phase 3

- HIPAA compliance (for international expansion)
- ISO 9001 (Quality Management)

### Phase 4

- SOC 2 Type II
- GDPR compliance (for EU expansion)

---

## Success Metrics

### Phase 2

- 10+ branches using the system
- 1000+ patients per month
- 95% uptime
- <2 second page load times

### Phase 3

- 50+ branches
- 10,000+ patients per month
- 99% uptime
- Telemedicine adoption >20%

### Phase 4

- 100+ organizations
- 500+ branches
- 100,000+ patients per month
- 99.9% uptime
- International expansion (1+ countries)

---

## Next Steps

1. ✅ Complete Phase 1 (Rabies CMS MVP)
2. ⏳ Complete the single-clinic go-live gates and operational hardening owned by
   [`STATUS.md`](STATUS.md). Runtime Review Center Phase 1 is implemented in
   [PR #616](https://github.com/njvil/surevax-cms-revamp/pull/616), pending merge;
   its deliberately deferred merge/reconciliation slices remain in that living
   backlog rather than this long-term roadmap.
3. ⏳ Gather user feedback from initial deployment
4. ⏳ Prioritize Phase 2 features based on user needs
5. ⏳ Create detailed technical specs for pharmacy module
6. ⏳ Plan infrastructure scaling for multi-branch
7. ⏳ Establish partnerships with HMOs and labs
8. ⏳ Begin DOH SCIV certification process

---

**Last Updated**: August 23, 2026
**Document Owner**: Development Team  
**Review Frequency**: Quarterly
