# SureVax CMS v2.0: Schema Improvements & Enhancements

## Document Overview

This document outlines potential improvements and enhancements to the database schema v4 for SureVax CMS, a vaccination clinic management system that started as an animal bite treatment center and is evolving into a comprehensive clinic ERP with CRM and POS capabilities.

**Last Updated:** March 14, 2026  
**Schema Version:** v4 (with bug fixes applied)

---

## Bug Fixes Applied ✅

### 1. Fixed Fractional Inventory Quantities

**Issue:** Intradermal (ID) vaccine administration uses fractional vials (0.1ml per site, 1 vial = 10 doses), but inventory was INTEGER.

**Fixed:**

- `inventory_lots.quantity_on_hand`: INTEGER → DECIMAL(10,2)
- `inventory_lots.received_quantity`: INTEGER → DECIMAL(10,2)
- `inventory_transactions.quantity_change`: INTEGER → DECIMAL(10,2)
- `inventory_transactions.quantity_after`: INTEGER → DECIMAL(10,2)
- `transaction_items.quantity`: INTEGER → DECIMAL(10,2)
- `clinical_orders.quantity`: INTEGER → DECIMAL(10,2)

### 2. Fixed Standing Order Progress Query

**Issue:** Query referenced non-existent `standing_order_template_items` table (simplified to JSONB).

**Fixed:** Updated query to extract from `protocol_items` JSONB using `jsonb_array_elements()`.

### 3. Added Soft Delete Support

**Issue:** Schema mentioned soft deletes but didn't implement them.

**Fixed:** Added `deleted_at TIMESTAMP` to:

- `patients`
- `encounters`
- `clinical_orders`
- `service_catalog`

Updated indexes to exclude deleted records with `WHERE deleted_at IS NULL`.

### 4. Enhanced Vaccine Administration Tracking

**Issue:** Missing critical vaccine-specific fields (VIS, consent, adverse events).

**Fixed:** Enhanced `clinical_orders.notes` JSONB structure with:

- Administration details (route, site, volume, needle specs)
- Consent documentation (VIS provided, version, consent timestamp)
- Adverse event tracking (reaction type, observation period)

---

## Priority 1: Critical Enhancements (Must Have)

### 1.1 Cold Chain Monitoring

**Business Need:** Vaccines require strict temperature control. Regulatory compliance requires temperature logs.

**Implementation:**

```sql
CREATE TABLE cold_chain_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  storage_unit VARCHAR(100) NOT NULL, -- 'Refrigerator-1', 'Freezer-A'
  temperature_c DECIMAL(4,2) NOT NULL,
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  recorded_by_id UUID REFERENCES users(id),
  is_out_of_range BOOLEAN DEFAULT FALSE,
  alert_sent BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cold_chain_branch_date ON cold_chain_logs(branch_id, recorded_at);
CREATE INDEX idx_cold_chain_alerts ON cold_chain_logs(is_out_of_range, alert_sent)
  WHERE is_out_of_range = TRUE;

-- Add to branches.settings JSONB
{
  "cold_chain": {
    "refrigerator_min_c": 2,
    "refrigerator_max_c": 8,
    "freezer_min_c": -25,
    "freezer_max_c": -15,
    "alert_email": "manager@surevax.com",
    "alert_sms": "09171234567"
  }
}
```

**Benefits:**

- Regulatory compliance (DOH requirements)
- Vaccine efficacy assurance
- Automated alerts for temperature excursions
- Audit trail for inspections

---

### 1.2 Appointment Scheduling System

**Business Need:** Clinical orders track "when" but not "time slots". Need proper appointment booking.

**Implementation:**

```sql
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  provider_id UUID REFERENCES users(id),
  clinical_order_id UUID REFERENCES clinical_orders(id),
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  duration_minutes INTEGER DEFAULT 15,
  appointment_type VARCHAR(50) NOT NULL, -- 'Vaccination', 'Consultation', 'Follow_Up'
  status VARCHAR(50) DEFAULT 'Scheduled', -- 'Scheduled', 'Confirmed', 'Checked_In', 'Completed', 'No_Show', 'Cancelled'
  confirmation_sent_at TIMESTAMP,
  reminder_sent_at TIMESTAMP,
  checked_in_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_appointments_date ON appointments(branch_id, appointment_date, appointment_time);
CREATE INDEX idx_appointments_patient ON appointments(patient_id);
CREATE INDEX idx_appointments_provider ON appointments(provider_id, appointment_date);
CREATE UNIQUE INDEX idx_appointments_slot ON appointments(branch_id, provider_id, appointment_date, appointment_time)
  WHERE status NOT IN ('Cancelled', 'No_Show');
```

**Benefits:**

- Prevent double-booking
- Time slot management
- Automated reminders
- No-show tracking
- Provider schedule optimization

---

### 1.3 Diagnosis Management

**Business Need:** Expanding beyond vaccination to general diagnosis requires ICD-10 tracking.

**Implementation:**

```sql
CREATE TABLE diagnoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  icd10_code VARCHAR(10) NOT NULL,
  icd10_description TEXT NOT NULL,
  diagnosis_type VARCHAR(50) NOT NULL, -- 'Primary', 'Secondary', 'Differential'
  severity VARCHAR(50), -- 'Mild', 'Moderate', 'Severe'
  onset_date DATE,
  resolved_date DATE,
  is_chronic BOOLEAN DEFAULT FALSE,
  notes TEXT,
  diagnosed_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_diagnoses_encounter ON diagnoses(encounter_id);
CREATE INDEX idx_diagnoses_patient ON diagnoses(patient_id);
CREATE INDEX idx_diagnoses_icd10 ON diagnoses(icd10_code);
CREATE INDEX idx_diagnoses_chronic ON diagnoses(patient_id, is_chronic) WHERE is_chronic = TRUE;

-- ICD-10 reference table (optional, can use external API)
CREATE TABLE icd10_codes (
  code VARCHAR(10) PRIMARY KEY,
  description TEXT NOT NULL,
  category VARCHAR(100),
  is_notifiable BOOLEAN DEFAULT FALSE, -- For PIDSR reporting
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(code, '') || ' ' || coalesce(description, ''))
  ) STORED
);

CREATE INDEX idx_icd10_search ON icd10_codes USING GIN(search_vector);
```

**Benefits:**

- Proper disease tracking
- Insurance claim support
- Epidemiological reporting
- Chronic disease management
- PIDSR compliance

---

### 1.4 Prescription Management

**Business Need:** Diagnosis requires prescription capability.

**Implementation:**

```sql
CREATE TABLE prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES encounters(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  prescribed_by_id UUID NOT NULL REFERENCES users(id),
  prescription_date DATE NOT NULL,
  status VARCHAR(50) DEFAULT 'Active', -- 'Active', 'Completed', 'Cancelled', 'Expired'
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE prescription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id),
  medication_name VARCHAR(255) NOT NULL,
  generic_name VARCHAR(255),
  dosage VARCHAR(100) NOT NULL, -- '500mg'
  form VARCHAR(50), -- 'Tablet', 'Capsule', 'Syrup'
  route VARCHAR(50), -- 'Oral', 'Topical', 'IM'
  frequency VARCHAR(100) NOT NULL, -- 'Twice daily', 'Every 8 hours'
  duration_days INTEGER,
  quantity INTEGER NOT NULL,
  instructions TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_prescriptions_encounter ON prescriptions(encounter_id);
CREATE INDEX idx_prescriptions_patient ON prescriptions(patient_id);
CREATE INDEX idx_prescription_items_prescription ON prescription_items(prescription_id);
```

**Benefits:**

- Complete clinical workflow
- Medication history tracking
- Drug interaction checking (application layer)
- Prescription printing
- Pharmacy integration ready

---

## Priority 2: CRM Enhancements (High Value)

### 2.1 Patient Communication Preferences

**Business Need:** Respect patient preferences for SMS/email/call reminders.

**Implementation:**

```sql
ALTER TABLE patients ADD COLUMN communication_preferences JSONB DEFAULT '{
  "sms_enabled": true,
  "email_enabled": true,
  "call_enabled": true,
  "preferred_time": "morning",
  "preferred_language": "en",
  "opt_out_marketing": false
}'::jsonb;

CREATE INDEX idx_patients_comm_prefs ON patients USING GIN(communication_preferences);
```

---

### 2.2 Patient Lifecycle Tracking

**Business Need:** Track patient journey for retention and reactivation campaigns.

**Implementation:**

```sql
CREATE TABLE patient_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  event_type VARCHAR(50) NOT NULL, -- 'First_Visit', 'Completed_Protocol', 'Lapsed', 'Reactivated', 'Referred_Friend'
  event_date DATE NOT NULL,
  event_data JSONB, -- Additional context
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_lifecycle_patient ON patient_lifecycle_events(patient_id, event_date);
CREATE INDEX idx_lifecycle_type ON patient_lifecycle_events(event_type, event_date);
```

**Example Queries:**

```sql
-- Find lapsed patients (no visit in 6 months)
SELECT p.id, p.first_name, p.last_name, MAX(e.started_at) AS last_visit
FROM patients p
JOIN encounters e ON e.patient_id = p.id
GROUP BY p.id
HAVING MAX(e.started_at) < NOW() - INTERVAL '6 months';

-- Track protocol completion rate
SELECT
  COUNT(*) FILTER (WHERE event_type = 'Completed_Protocol') * 100.0 /
  COUNT(*) FILTER (WHERE event_type = 'First_Visit') AS completion_rate
FROM patient_lifecycle_events
WHERE event_date >= '2026-01-01';
```

---

### 2.3 Marketing Campaigns

**Business Need:** Targeted campaigns for flu season, birthday promos, reactivation.

**Implementation:**

```sql
CREATE TABLE marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  campaign_type VARCHAR(50) NOT NULL, -- 'Flu_Season', 'Rabies_Awareness', 'Birthday_Promo', 'Reactivation'
  target_segment JSONB, -- Patient criteria
  message_template TEXT,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE campaign_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES marketing_campaigns(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  sent_at TIMESTAMP,
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  converted_at TIMESTAMP, -- Booked appointment
  status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Sent', 'Delivered', 'Failed', 'Converted'
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_campaign_sends_campaign ON campaign_sends(campaign_id);
CREATE INDEX idx_campaign_sends_patient ON campaign_sends(patient_id);
CREATE INDEX idx_campaign_sends_status ON campaign_sends(status);
```

**Example target_segment JSONB:**

```jsonb
{
  "age_min": 60,
  "age_max": null,
  "tags": ["High_Risk"],
  "last_visit_before": "2025-09-01",
  "onboarding_channel": ["Walk-In", "Referral"],
  "exclude_tags": ["Deceased"]
}
```

---

### 2.4 Referral Tracking & Rewards

**Business Need:** Incentivize patient referrals to grow customer base.

**Implementation:**

```sql
ALTER TABLE patients ADD COLUMN referred_by_patient_id UUID REFERENCES patients(id);
ALTER TABLE patients ADD COLUMN referral_source VARCHAR(100); -- 'Google', 'Facebook', 'Walk-In', 'Doctor_Referral'
ALTER TABLE patients ADD COLUMN referral_notes TEXT;

CREATE TABLE referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referring_patient_id UUID NOT NULL REFERENCES patients(id),
  referred_patient_id UUID NOT NULL REFERENCES patients(id),
  reward_type VARCHAR(50), -- 'Discount', 'Free_Service', 'Cash', 'Points'
  reward_value DECIMAL(10,2),
  reward_status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Earned', 'Redeemed', 'Expired'
  earned_at TIMESTAMP,
  redeemed_at TIMESTAMP,
  expiry_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_referral_rewards_referring ON referral_rewards(referring_patient_id);
CREATE INDEX idx_referral_rewards_referred ON referral_rewards(referred_patient_id);
CREATE INDEX idx_referral_rewards_status ON referral_rewards(reward_status);
```

**Business Rules (Application Layer):**

- Reward earned when referred patient completes first paid visit
- Reward expires after 6 months if not redeemed
- Track referral conversion rate for marketing ROI

---

## Priority 3: POS Enhancements (Operational Efficiency)

### 3.1 Cash Drawer Management

**Business Need:** Track cash drawer sessions for accountability and reconciliation.

**Implementation:**

```sql
CREATE TABLE cash_drawer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  cashier_id UUID NOT NULL REFERENCES users(id),
  opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP,
  opening_balance DECIMAL(10,2) NOT NULL,
  closing_balance DECIMAL(10,2),
  expected_balance DECIMAL(10,2),
  variance DECIMAL(10,2), -- closing_balance - expected_balance
  variance_reason TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE cash_drawer_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES cash_drawer_sessions(id),
  transaction_type VARCHAR(50) NOT NULL, -- 'Sale', 'Refund', 'Payout', 'Deposit', 'Change_Fund'
  amount DECIMAL(10,2) NOT NULL,
  reference_id UUID, -- Links to transactions table
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cash_drawer_sessions_branch ON cash_drawer_sessions(branch_id, opened_at);
CREATE INDEX idx_cash_drawer_sessions_cashier ON cash_drawer_sessions(cashier_id);
CREATE INDEX idx_cash_drawer_transactions_session ON cash_drawer_transactions(session_id);
```

**Workflow:**

1. Cashier opens drawer with starting cash (e.g., P5,000)
2. All cash transactions link to session
3. End of shift: count cash, compare to expected
4. Record variance (over/short)

---

### 3.2 Dynamic Pricing Tiers

**Business Need:** Different prices for HMO, corporate, senior, PWD without duplicating service catalog.

**Implementation:**

```sql
ALTER TABLE service_catalog ADD COLUMN pricing_tiers JSONB DEFAULT '{
  "standard": null,
  "senior": null,
  "pwd": null,
  "hmo": {},
  "corporate": {}
}'::jsonb;

-- Example pricing_tiers JSONB
{
  "standard": 3000, // base_price
  "senior": 2142.86, // (3000 / 1.12) * 0.80
  "pwd": 2142.86,
  "hmo": {
    "maxicare": 3450, // 15% markup
    "philcare": 3300,
    "medicard": 3150
  },
  "corporate": {
    "abc_corp": 2700, // 10% discount
    "xyz_inc": 2850
  }
}
```

**Benefits:**

- Pre-calculated prices for speed
- Easy price updates
- Audit trail of price changes
- Support for complex pricing rules

---

### 3.3 Product Bundles with Dynamic Pricing

**Business Need:** "Rabies Package" should auto-calculate based on current component prices.

**Implementation:**

```sql
ALTER TABLE service_catalog ADD COLUMN bundle_items JSONB;
ALTER TABLE service_catalog ADD COLUMN bundle_discount_type VARCHAR(50); -- 'Percentage', 'Fixed_Amount', 'None'
ALTER TABLE service_catalog ADD COLUMN bundle_discount_value DECIMAL(10,2);

-- Example bundle_items JSONB
{
  "items": [
    {"service_id": "uuid-consultation", "quantity": 1},
    {"service_id": "uuid-wound-cleaning", "quantity": 1},
    {"service_id": "uuid-arv-dose", "quantity": 4},
    {"service_id": "uuid-erig", "quantity": 1}
  ],
  "auto_calculate_price": true
}
```

**Calculation Logic (Application Layer):**

```javascript
function calculateBundlePrice(bundle) {
  let total = 0
  for (const item of bundle.items) {
    const service = getService(item.service_id)
    total += service.base_price * item.quantity
  }

  if (bundle.discount_type === 'Percentage') {
    total *= 1 - bundle.discount_value / 100
  } else if (bundle.discount_type === 'Fixed_Amount') {
    total -= bundle.discount_value
  }

  return total
}
```

---

### 3.4 Loyalty Points System

**Business Need:** Reward frequent patients to increase retention.

**Implementation:**

```sql
CREATE TABLE loyalty_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  transaction_id UUID REFERENCES transactions(id),
  points_earned INTEGER DEFAULT 0,
  points_redeemed INTEGER DEFAULT 0,
  points_balance INTEGER NOT NULL,
  transaction_type VARCHAR(50) NOT NULL, -- 'Earned', 'Redeemed', 'Expired', 'Adjusted'
  expiry_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_loyalty_points_patient ON loyalty_points(patient_id);
CREATE INDEX idx_loyalty_points_expiry ON loyalty_points(expiry_date) WHERE points_balance > 0;

-- Patient points summary view
CREATE VIEW patient_points_summary AS
SELECT
  patient_id,
  SUM(points_earned) AS total_earned,
  SUM(points_redeemed) AS total_redeemed,
  SUM(points_balance) AS current_balance
FROM loyalty_points
GROUP BY patient_id;
```

**Business Rules:**

- Earn 1 point per P100 spent
- 100 points = P100 discount
- Points expire after 1 year
- Cannot redeem on discounted items

---

## Priority 4: Operational Features (Workflow Optimization)

### 4.1 Queue Management System

**Business Need:** Manage patient flow during busy hours.

**Implementation:**

```sql
CREATE TABLE queue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  appointment_id UUID REFERENCES appointments(id),
  queue_number VARCHAR(20) NOT NULL, -- 'A001', 'B015'
  queue_type VARCHAR(50) NOT NULL, -- 'Walk-In', 'Appointment', 'Priority'
  status VARCHAR(50) DEFAULT 'Waiting', -- 'Waiting', 'Called', 'In_Service', 'Completed', 'Left'
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  called_at TIMESTAMP,
  service_started_at TIMESTAMP,
  service_ended_at TIMESTAMP,
  serving_provider_id UUID REFERENCES users(id),
  estimated_wait_minutes INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_queue_branch_status ON queue_entries(branch_id, status, joined_at);
CREATE INDEX idx_queue_patient ON queue_entries(patient_id);

-- Queue display view
CREATE VIEW current_queue AS
SELECT
  qe.queue_number,
  p.first_name || ' ' || p.last_name AS patient_name,
  qe.queue_type,
  qe.status,
  EXTRACT(EPOCH FROM (NOW() - qe.joined_at)) / 60 AS wait_minutes,
  qe.estimated_wait_minutes
FROM queue_entries qe
JOIN patients p ON p.id = qe.patient_id
WHERE qe.status IN ('Waiting', 'Called', 'In_Service')
  AND qe.joined_at::date = CURRENT_DATE
ORDER BY qe.joined_at;
```

**Features:**

- Digital queue display
- SMS notification when turn is near
- Priority queue for emergencies
- Average wait time analytics

---

### 4.2 Product Recall Management

**Business Need:** Rapid response to vaccine/medication recalls.

**Implementation:**

```sql
CREATE TABLE product_recalls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recall_type VARCHAR(50) NOT NULL, -- 'Vaccine', 'Medication', 'Supply'
  affected_product_id UUID REFERENCES service_catalog(id),
  affected_lot_numbers TEXT[], -- Array of batch numbers
  recall_reason TEXT NOT NULL,
  severity VARCHAR(50) NOT NULL, -- 'Critical', 'Major', 'Minor'
  recall_date DATE NOT NULL,
  manufacturer VARCHAR(255),
  regulatory_reference VARCHAR(100), -- FDA recall number
  action_required TEXT,
  status VARCHAR(50) DEFAULT 'Active', -- 'Active', 'In_Progress', 'Completed'
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE recall_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recall_id UUID NOT NULL REFERENCES product_recalls(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  clinical_order_id UUID NOT NULL REFERENCES clinical_orders(id),
  notification_sent_at TIMESTAMP,
  notification_method VARCHAR(50), -- 'SMS', 'Email', 'Call'
  patient_contacted BOOLEAN DEFAULT FALSE,
  patient_response TEXT,
  follow_up_required BOOLEAN DEFAULT TRUE,
  follow_up_completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_product_recalls_status ON product_recalls(status);
CREATE INDEX idx_recall_notifications_recall ON recall_notifications(recall_id);
CREATE INDEX idx_recall_notifications_patient ON recall_notifications(patient_id);
```

**Workflow:**

1. Recall announced → Create product_recalls record
2. Query affected patients via lot_id in clinical_orders
3. Auto-generate recall_notifications for each patient
4. Track notification delivery and patient contact
5. Mark recall as completed when all patients contacted

---

### 4.3 Staff Performance Tracking

**Business Need:** Monitor productivity and quality metrics.

**Implementation:**

```sql
CREATE TABLE staff_performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  metric_date DATE NOT NULL,

  -- Productivity metrics
  patients_served INTEGER DEFAULT 0,
  services_administered INTEGER DEFAULT 0,
  transactions_processed INTEGER DEFAULT 0,
  total_revenue DECIMAL(10,2) DEFAULT 0,

  -- Quality metrics
  patient_complaints INTEGER DEFAULT 0,
  medication_errors INTEGER DEFAULT 0,
  documentation_errors INTEGER DEFAULT 0,

  -- Time metrics
  average_service_time_minutes DECIMAL(5,2),
  total_hours_worked DECIMAL(5,2),

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_staff_performance_user_date ON staff_performance_metrics(user_id, metric_date);
CREATE INDEX idx_staff_performance_branch_date ON staff_performance_metrics(branch_id, metric_date);
```

**Auto-calculated daily via scheduled job:**

```sql
INSERT INTO staff_performance_metrics (user_id, branch_id, metric_date, patients_served, services_administered, total_revenue)
SELECT
  e.provider_id,
  e.branch_id,
  e.started_at::date,
  COUNT(DISTINCT e.patient_id),
  COUNT(co.id),
  COALESCE(SUM(t.total_net), 0)
FROM encounters e
LEFT JOIN clinical_orders co ON co.encounter_id = e.id AND co.status = 'Completed'
LEFT JOIN transactions t ON t.encounter_id = e.id
WHERE e.started_at::date = CURRENT_DATE - INTERVAL '1 day'
GROUP BY e.provider_id, e.branch_id, e.started_at::date;
```

---

### 4.4 Equipment & Asset Management

**Business Need:** Track medical equipment, maintenance, calibration.

**Implementation:**

```sql
CREATE TABLE equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  equipment_type VARCHAR(100) NOT NULL, -- 'Refrigerator', 'Freezer', 'Autoclave', 'BP_Monitor'
  brand VARCHAR(100),
  model VARCHAR(100),
  serial_number VARCHAR(100),
  purchase_date DATE,
  warranty_expiry DATE,
  status VARCHAR(50) DEFAULT 'Active', -- 'Active', 'Maintenance', 'Broken', 'Retired'
  location VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE equipment_maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id UUID NOT NULL REFERENCES equipment(id),
  maintenance_type VARCHAR(50) NOT NULL, -- 'Preventive', 'Corrective', 'Calibration'
  scheduled_date DATE NOT NULL,
  completed_date DATE,
  performed_by VARCHAR(255), -- Technician name
  cost DECIMAL(10,2),
  findings TEXT,
  next_maintenance_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_equipment_branch ON equipment(branch_id);
CREATE INDEX idx_equipment_maintenance_equipment ON equipment_maintenance(equipment_id);
CREATE INDEX idx_equipment_maintenance_scheduled ON equipment_maintenance(scheduled_date)
  WHERE completed_date IS NULL;
```

---

## Priority 5: Compliance & Reporting (Regulatory)

### 5.1 Data Retention Policies

**Business Need:** Automated compliance with DOH retention requirements.

**Implementation:**

```sql
CREATE TABLE data_retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(100) NOT NULL, -- 'Encounter', 'Transaction', 'LabOrder'
  retention_years INTEGER NOT NULL,
  archive_after_years INTEGER,
  delete_after_years INTEGER,
  policy_type VARCHAR(50), -- 'Legal', 'Regulatory', 'Business'
  regulation_reference VARCHAR(255), -- 'DOH AO 2022-0007'
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Example policies
INSERT INTO data_retention_policies (entity_type, retention_years, archive_after_years, delete_after_years, policy_type, regulation_reference)
VALUES
  ('Encounter', 10, 5, 10, 'Regulatory', 'DOH AO 2022-0007 - Outpatient records'),
  ('Transaction', 7, 3, 7, 'Legal', 'BIR - Financial records'),
  ('LabOrder', 5, 2, 5, 'Regulatory', 'DOH AO 2022-0007 - Laboratory records');
```

---

### 5.2 Consent Management

**Business Need:** Track patient consent for procedures, data sharing, marketing.

**Implementation:**

```sql
CREATE TABLE consent_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  consent_type VARCHAR(50) NOT NULL, -- 'Treatment', 'Data_Sharing', 'Marketing', 'Research'
  consent_given BOOLEAN NOT NULL,
  consent_date DATE NOT NULL,
  consent_method VARCHAR(50), -- 'Written', 'Verbal', 'Electronic'
  witness_id UUID REFERENCES users(id),
  document_url VARCHAR(500), -- Scanned consent form
  expiry_date DATE,
  revoked_at TIMESTAMP,
  revoked_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_consent_forms_patient ON consent_forms(patient_id);
CREATE INDEX idx_consent_forms_type ON consent_forms(consent_type);
CREATE INDEX idx_consent_forms_active ON consent_forms(patient_id, consent_type)
  WHERE consent_given = TRUE AND revoked_at IS NULL;
```

**Use Cases:**

- Vaccine administration consent
- Data sharing with partner labs
- Marketing communications opt-in
- Research participation
- Telemedicine consent

---

### 5.3 Adverse Event Reporting

**Business Need:** Track and report vaccine adverse events to DOH.

**Implementation:**

```sql
CREATE TABLE adverse_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  clinical_order_id UUID NOT NULL REFERENCES clinical_orders(id),
  encounter_id UUID REFERENCES encounters(id),
  event_date TIMESTAMP NOT NULL,
  event_type VARCHAR(50) NOT NULL, -- 'Immediate', 'Delayed', 'Serious'
  severity VARCHAR(50) NOT NULL, -- 'Mild', 'Moderate', 'Severe', 'Life_Threatening'

  -- Event details
  symptoms TEXT NOT NULL,
  onset_time_minutes INTEGER, -- Time after administration
  duration_minutes INTEGER,
  treatment_given TEXT,
  outcome VARCHAR(50), -- 'Recovered', 'Recovering', 'Not_Recovered', 'Fatal'

  -- Reporting
  reported_to_doh BOOLEAN DEFAULT FALSE,
  doh_report_date DATE,
  doh_reference_number VARCHAR(100),

  -- Investigation
  investigation_required BOOLEAN DEFAULT FALSE,
  investigation_findings TEXT,
  preventive_actions TEXT,

  reported_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_adverse_events_patient ON adverse_events(patient_id);
CREATE INDEX idx_adverse_events_clinical_order ON adverse_events(clinical_order_id);
CREATE INDEX idx_adverse_events_severity ON adverse_events(severity);
CREATE INDEX idx_adverse_events_doh_reporting ON adverse_events(reported_to_doh, event_date);
```

**Workflow:**

1. Staff reports adverse event
2. System flags for investigation if severe
3. Auto-generate DOH report for serious events
4. Track outcome and preventive measures
5. Link to lot number for pattern detection

---

### 5.4 System Configuration Management

**Business Need:** Centralized configuration without code changes.

**Implementation:**

```sql
CREATE TABLE system_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id), -- NULL for global
  config_key VARCHAR(100) NOT NULL,
  config_value JSONB NOT NULL,
  description TEXT,
  is_sensitive BOOLEAN DEFAULT FALSE, -- Encrypt in application
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by_id UUID REFERENCES users(id),
  UNIQUE(branch_id, config_key)
);

CREATE INDEX idx_system_config_branch ON system_config(branch_id);
CREATE INDEX idx_system_config_key ON system_config(config_key);
```

**Example Configurations:**

```sql
-- Global settings
INSERT INTO system_config (branch_id, config_key, config_value, description)
VALUES
  (NULL, 'grace_period_days', '3', 'Days before appointment marked overdue'),
  (NULL, 'sms_provider', '{"provider": "Semaphore", "api_key": "xxx"}', 'SMS gateway config'),
  (NULL, 'loyalty_points_ratio', '{"spend": 100, "points": 1}', 'Points earning ratio'),
  (NULL, 'working_hours', '{"monday": {"open": "08:00", "close": "17:00"}}', 'Default working hours');

-- Branch-specific settings
INSERT INTO system_config (branch_id, config_key, config_value, description)
VALUES
  ('branch-uuid', 'receipt_footer', '"Thank you for choosing SureVax Cainta!"', 'Receipt footer text'),
  ('branch-uuid', 'appointment_slot_duration', '15', 'Default appointment duration in minutes');
```

---

## Priority 6: Analytics & Business Intelligence

### 6.1 Pre-calculated Metrics Tables

**Business Need:** Fast dashboard loading without complex queries.

**Implementation:**

```sql
CREATE TABLE daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  metric_date DATE NOT NULL,

  -- Patient metrics
  new_patients INTEGER DEFAULT 0,
  returning_patients INTEGER DEFAULT 0,
  total_encounters INTEGER DEFAULT 0,

  -- Revenue metrics
  total_revenue DECIMAL(10,2) DEFAULT 0,
  total_discounts DECIMAL(10,2) DEFAULT 0,
  net_revenue DECIMAL(10,2) DEFAULT 0,

  -- Service metrics
  vaccinations_administered INTEGER DEFAULT 0,
  consultations INTEGER DEFAULT 0,
  lab_tests INTEGER DEFAULT 0,

  -- Operational metrics
  average_wait_time_minutes DECIMAL(5,2),
  no_show_count INTEGER DEFAULT 0,
  cancellation_count INTEGER DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(branch_id, metric_date)
);

CREATE INDEX idx_daily_metrics_branch_date ON daily_metrics(branch_id, metric_date);

-- Monthly rollup
CREATE TABLE monthly_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  metric_year INTEGER NOT NULL,
  metric_month INTEGER NOT NULL,

  total_revenue DECIMAL(10,2) DEFAULT 0,
  total_patients INTEGER DEFAULT 0,
  total_encounters INTEGER DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(branch_id, metric_year, metric_month)
);
```

**Scheduled Job:** Calculate daily metrics at midnight.

---

### 6.2 Patient Cohort Analysis

**Business Need:** Track patient groups for outcomes research and quality improvement.

**Implementation:**

```sql
CREATE TABLE patient_cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  cohort_type VARCHAR(50) NOT NULL, -- 'Clinical_Trial', 'Quality_Improvement', 'Research', 'Marketing'
  inclusion_criteria JSONB NOT NULL,
  exclusion_criteria JSONB,
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE cohort_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id UUID NOT NULL REFERENCES patient_cohorts(id),
  patient_id UUID NOT NULL REFERENCES patients(id),
  enrolled_date DATE NOT NULL,
  status VARCHAR(50) DEFAULT 'Active', -- 'Active', 'Completed', 'Withdrawn', 'Lost_To_Follow_Up'
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(cohort_id, patient_id)
);

CREATE INDEX idx_cohort_members_cohort ON cohort_members(cohort_id);
CREATE INDEX idx_cohort_members_patient ON cohort_members(patient_id);
```

**Example Cohorts:**

- "Rabies PEP Completion Study 2026" - Track protocol completion rates
- "High-Risk Flu Vaccination Campaign" - Target elderly patients
- "Repeat Bite Victims" - Monitor for behavioral patterns

---

## Implementation Roadmap

### Phase 1: Critical Fixes (Week 1-2)

- ✅ Fractional inventory quantities
- ✅ Standing order query fix
- ✅ Soft delete support
- ✅ Enhanced vaccine tracking
- 🔲 Cold chain monitoring
- 🔲 Appointment scheduling

### Phase 2: Core ERP Features (Month 1-2)

- 🔲 Diagnosis management
- 🔲 Prescription management
- 🔲 Cash drawer management
- 🔲 Queue management
- 🔲 Product recall workflow

### Phase 3: CRM Features (Month 2-3)

- 🔲 Communication preferences
- 🔲 Lifecycle tracking
- 🔲 Marketing campaigns
- 🔲 Referral rewards
- 🔲 Loyalty points

### Phase 4: Advanced Features (Month 3-6)

- 🔲 Dynamic pricing tiers
- 🔲 Staff performance tracking
- 🔲 Equipment management
- 🔲 Adverse event reporting
- 🔲 Analytics dashboards

### Phase 5: Compliance & Optimization (Month 6+)

- 🔲 Data retention automation
- 🔲 Consent management
- 🔲 Cohort analysis
- 🔲 Advanced reporting
- 🔲 API integrations

---

## Migration Considerations

### Backward Compatibility

All enhancements are additive - no breaking changes to existing schema.

### Data Migration Scripts

For each new table, provide:

1. CREATE TABLE statement
2. Initial data seeding (if applicable)
3. Backfill script for historical data
4. Rollback script

### Performance Impact

- New indexes may slow down writes slightly
- Pre-calculated metrics reduce query load
- JSONB columns are flexible but harder to query
- Consider partitioning for audit_logs, daily_metrics

### Testing Strategy

1. Unit tests for each new table
2. Integration tests for cross-table queries
3. Performance tests with production-like data volume
4. User acceptance testing for each feature

---

## Estimated Storage Requirements

Based on 10,000 patients, 50,000 encounters/year:

| Table               | Rows/Year | Size/Row  | Total Size |
| ------------------- | --------- | --------- | ---------- |
| cold_chain_logs     | 36,500    | 200 bytes | 7 MB       |
| appointments        | 50,000    | 300 bytes | 15 MB      |
| diagnoses           | 50,000    | 250 bytes | 12 MB      |
| prescriptions       | 30,000    | 200 bytes | 6 MB       |
| prescription_items  | 90,000    | 250 bytes | 22 MB      |
| marketing_campaigns | 50        | 500 bytes | 25 KB      |
| campaign_sends      | 100,000   | 200 bytes | 20 MB      |
| queue_entries       | 50,000    | 300 bytes | 15 MB      |
| adverse_events      | 500       | 500 bytes | 250 KB     |
| daily_metrics       | 365       | 300 bytes | 110 KB     |

**Total Additional Storage:** ~100 MB/year (negligible)

---

## Security Considerations

### Sensitive Data

- Encrypt `system_config` entries with `is_sensitive = TRUE`
- Mask patient contact info in logs
- Restrict access to adverse_events table
- Audit all consent form access

### Access Control

- Role-based permissions for each new table
- Branch-level data isolation maintained
- Audit all configuration changes
- Require manager approval for recalls

### Data Privacy

- GDPR/DPA compliance for marketing campaigns
- Opt-out mechanism for all communications
- Right to be forgotten implementation
- Data export for patient requests

---

## Performance Optimization Tips

### Indexing Strategy

- Index all foreign keys
- Composite indexes for common queries
- Partial indexes for filtered queries
- GIN indexes for JSONB columns

### Query Optimization

- Use materialized views for complex reports
- Pre-calculate metrics in scheduled jobs
- Partition large tables by date
- Archive old data to separate tables

### Caching Strategy

- Cache system_config in application memory
- Cache service_catalog pricing
- Cache patient communication preferences
- Invalidate cache on updates

---

## Monitoring & Alerts

### Key Metrics to Track

- Cold chain temperature excursions
- Inventory low stock alerts
- Appointment no-show rate
- Cash drawer variances
- Adverse event frequency
- System performance (query times)

### Alert Thresholds

- Temperature out of range: Immediate
- Inventory < 10 units: Daily
- No-show rate > 20%: Weekly
- Cash variance > P500: Immediate
- Serious adverse event: Immediate

---

## Conclusion

This schema enhancement plan transforms SureVax from a basic vaccination clinic system into a comprehensive ERP with:

✅ **Complete Clinical Workflow** - Diagnosis, prescription, adverse events  
✅ **Robust CRM** - Lifecycle tracking, campaigns, referrals, loyalty  
✅ **Professional POS** - Cash management, dynamic pricing, bundles  
✅ **Operational Excellence** - Queue management, staff tracking, equipment  
✅ **Regulatory Compliance** - Consent, retention, adverse events, reporting  
✅ **Business Intelligence** - Pre-calculated metrics, cohort analysis, dashboards

**Next Steps:**

1. Review and prioritize enhancements with stakeholders
2. Create detailed technical specifications for Phase 1
3. Set up development/staging environment
4. Begin implementation with critical fixes
5. Iterate based on user feedback

**Estimated Timeline:** 6 months for full implementation  
**Estimated Effort:** 2-3 full-stack developers  
**Risk Level:** Low (additive changes, no breaking modifications)

---

**Document Version:** 1.0  
**Last Updated:** March 14, 2026  
**Author:** SureVax Development Team  
**Status:** Draft for Review
