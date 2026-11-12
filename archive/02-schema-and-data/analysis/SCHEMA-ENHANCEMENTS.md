# **Schema v4 Enhancements: Bite Incident Tracking**

## **Supporting Multiple Exposures & Patient History**

---

## **Problem Statement**

In a rabies clinic, patients can be bitten multiple times over their lifetime. Each bite incident is a separate clinical event that requires:

1. **Detailed incident documentation** (animal type, bite category, location)
2. **Animal observation tracking** (14-day follow-up to determine if PEP can be discontinued)
3. **Repeat exposure detection** (has patient been bitten before? did they complete previous PEP?)
4. **Historical context** (understanding patient's full bite history for risk assessment)

The original schema didn't adequately capture this complexity, treating each encounter as isolated.

---

## **Solution: JSONB Approach for Bite Incident Tracking**

Instead of creating a separate `bite_incidents` table, we store bite incident data as JSONB in the `encounters` table. This approach:

- Keeps the schema simple (18 tables instead of 19)
- Most queries are encounter-specific, not cross-encounter analytics
- PostgreSQL JSONB is queryable and indexable with GIN indexes
- Easier to extend without schema changes
- Follows "keep it simple, keep it modular" philosophy

### **1. Enhanced Patients Table**

**Added Fields**:

```sql
onboarding_channel VARCHAR(50) -- How patient found the clinic
date_first_visit DATE           -- Track patient lifetime with clinic
```

**Purpose**:

- Track marketing effectiveness (Walk-In, Referral, Online, Corporate, HMO, Government_Program)
- Identify long-term patients vs. one-time visitors
- Analyze patient acquisition channels

**Example**:

```sql
-- Patient first visited via government program in 2024
onboarding_channel = 'Government_Program'
date_first_visit = '2024-03-15'

-- Patient returns in 2026 for new bite (different incident)
-- System can see they're a returning patient with history
```

---

### **2. Enhanced Encounters Table**

**Added Fields**:

```sql
categorization VARCHAR(100)      -- Type of visit (Dog_Bite, Cat_Bite, Vaccination, etc.)
bite_incident JSONB              -- All bite-related data (see structure below)
clinical_notes JSONB             -- Flexible clinical data (vitals, SOAP, assessment)
```

**Purpose**:

- Categorize encounters by type
- Store bite incident details as structured JSONB
- Store clinical notes (vitals, SOAP) as JSONB
- Enable querying with GIN indexes on JSONB fields

**JSONB Structure for bite_incident**:

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
  "animal_observation_result": null,

  // Bite details
  "bite_category": "III",
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

**JSONB Structure for clinical_notes**:

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

**GIN Indexes for Querying**:

```sql
CREATE INDEX idx_encounters_bite_category ON encounters USING GIN ((bite_incident -> 'bite_category'));
CREATE INDEX idx_encounters_animal_type ON encounters USING GIN ((bite_incident -> 'animal_type'));
CREATE INDEX idx_encounters_incident_location ON encounters USING GIN ((bite_incident -> 'incident_city'));
```

---

### **3. Why JSONB Instead of Separate Table?**

**Advantages of JSONB Approach**:

- ✅ Simpler schema (18 tables instead of 19)
- ✅ Most queries are encounter-specific, not cross-encounter analytics
- ✅ PostgreSQL JSONB is queryable and indexable
- ✅ Easier to extend without schema changes
- ✅ Follows "keep it simple" philosophy
- ✅ All bite data stays with the encounter (no joins needed)

**When to Use Separate Table**:

- ❌ If you need complex cross-encounter analytics on bite data
- ❌ If you need foreign keys from bite incidents to other tables
- ❌ If bite data is frequently updated independently of encounters

**For SureVax CMS**: JSONB is the right choice because:

- Bite data is read with the encounter (no separate queries)
- Bite data is written once per encounter (no frequent updates)
- Cross-encounter queries are simple (patient bite history, location tracking)
- GIN indexes make JSONB queries fast

---

## **Use Cases**

### **Use Case 1: Patient with Multiple Bite Incidents**

**Scenario**: John Doe was bitten by a dog in 2024, completed PEP. Now bitten again in 2026.

**Data Structure**:

```sql
-- Patient record
patients:
  id: john-doe-uuid
  first_name: John
  last_name: Doe
  onboarding_channel: 'Walk-In'
  date_first_visit: '2024-05-10'

-- First bite incident (2024) - stored in encounter
encounters:
  id: encounter-1-uuid
  patient_id: john-doe-uuid
  encounter_type: 'Initial'
  categorization: 'Dog_Bite'
  started_at: '2024-05-10'
  bite_incident: {
    "incident_date": "2024-05-10",
    "animal_type": "Dog",
    "bite_category": "III",
    "bite_location": "Left leg",
    "animal_status": "Alive",
    "animal_observation_result": "Healthy",
    "is_repeat_exposure": false,
    "previous_pep_completed": null
  }

-- Patient completed PEP in 2024
patient_standing_orders:
  id: pso-1-uuid
  patient_id: john-doe-uuid
  template_id: 'RABIES-PEP-CAT3'
  start_date: '2024-05-10'
  status: 'Completed'

-- Second bite incident (2026) - new encounter
encounters:
  id: encounter-2-uuid
  patient_id: john-doe-uuid
  encounter_type: 'Initial'
  categorization: 'Dog_Bite'
  started_at: '2026-03-09'
  bite_incident: {
    "incident_date": "2026-03-09",
    "animal_type": "Dog",
    "bite_category": "II",
    "bite_location": "Right arm",
    "animal_status": "Unknown",
    "is_repeat_exposure": true,
    "previous_pep_completed": true,
    "previous_pep_date": "2024-05-24"
  }

-- New PEP protocol (2026) - Different schedule for previously vaccinated
patient_standing_orders:
  id: pso-2-uuid
  patient_id: john-doe-uuid
  template_id: 'RABIES-PEP-BOOSTER' -- Only 2 doses needed (Day 0, 3)
  start_date: '2026-03-09'
  status: 'Active'
```

**Clinical Decision Support**:

- System detects `bite_incident->>'is_repeat_exposure' = 'true'`
- System checks `bite_incident->>'previous_pep_completed' = 'true'`
- System recommends booster protocol (2 doses) instead of full PEP (4 doses)
- System shows nurse: "Patient previously completed PEP on 2024-05-24. Use booster protocol."

**Query to Check Repeat Exposure**:

```sql
SELECT
  e.started_at::date AS incident_date,
  e.bite_incident->>'animal_type' AS animal_type,
  e.bite_incident->>'bite_category' AS bite_category,
  (e.bite_incident->>'is_repeat_exposure')::boolean AS is_repeat_exposure,
  (e.bite_incident->>'previous_pep_completed')::boolean AS previous_pep_completed
FROM encounters e
WHERE e.patient_id = 'john-doe-uuid'
  AND e.categorization LIKE '%Bite%'
ORDER BY e.started_at DESC;
```

---

### **Use Case 2: Animal Observation Tracking**

**Scenario**: Patient bitten by owned dog. Dog is alive and under observation. If dog remains healthy for 14 days, PEP can be discontinued.

**Data Structure**:

```sql
encounters:
  id: encounter-uuid
  patient_id: patient-uuid
  categorization: 'Dog_Bite'
  started_at: '2026-03-09'
  bite_incident: {
    "incident_date": "2026-03-09",
    "animal_type": "Dog",
    "animal_ownership": "Owned",
    "animal_vaccination_status": "Vaccinated",
    "animal_status": "Alive",
    "animal_observation_start": "2026-03-09",
    "animal_observation_end": "2026-03-23",
    "animal_observation_result": null
  }

-- Day 14: Owner reports dog is healthy
UPDATE encounters
SET bite_incident = jsonb_set(
  bite_incident,
  '{animal_observation_result}',
  '"Healthy"'
)
WHERE id = 'encounter-uuid';

-- System recommendation: Can discontinue remaining PEP doses
-- Nurse sees: "Animal observed for 14 days and remains healthy. PEP can be discontinued."
```

**Query to Track Observation Status**:

```sql
SELECT
  p.first_name || ' ' || p.last_name AS patient_name,
  p.contact_number,
  e.bite_incident->>'animal_type' AS animal_type,
  (e.bite_incident->>'animal_observation_start')::date AS observation_start,
  (e.bite_incident->>'animal_observation_end')::date AS observation_end,
  e.bite_incident->>'animal_observation_result' AS observation_result,
  CASE
    WHEN e.bite_incident->>'animal_observation_result' = 'Healthy' THEN 'Can discontinue PEP'
    WHEN e.bite_incident->>'animal_observation_result' IS NULL
         AND (e.bite_incident->>'animal_observation_end')::date < CURRENT_DATE THEN 'Overdue for follow-up'
    WHEN e.bite_incident->>'animal_observation_result' IS NULL THEN 'Observation in progress'
    ELSE 'Continue PEP'
  END AS recommendation
FROM encounters e
JOIN patients p ON p.id = e.patient_id
WHERE e.categorization LIKE '%Bite%'
  AND (e.bite_incident->>'animal_observation_end')::date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY (e.bite_incident->>'animal_observation_end')::date;
```

---

### **Use Case 3: Epidemiological Tracking**

**Scenario**: Health department wants to track bite incidents by location to identify rabies hotspots.

**Query**:

```sql
SELECT
  e.bite_incident->>'incident_barangay' AS incident_barangay,
  e.bite_incident->>'incident_city' AS incident_city,
  COUNT(*) AS total_bites,
  SUM(CASE WHEN e.bite_incident->>'bite_category' = 'III' THEN 1 ELSE 0 END) AS category_3_bites,
  SUM(CASE WHEN e.bite_incident->>'animal_type' = 'Dog' THEN 1 ELSE 0 END) AS dog_bites,
  SUM(CASE WHEN e.bite_incident->>'animal_ownership' = 'Stray' THEN 1 ELSE 0 END) AS stray_animal_bites
FROM encounters e
WHERE e.categorization LIKE '%Bite%'
  AND e.started_at >= '2026-01-01'
GROUP BY e.bite_incident->>'incident_barangay', e.bite_incident->>'incident_city'
ORDER BY total_bites DESC;
```

**Output**:
| incident_barangay | incident_city | total_bites | category_3_bites | dog_bites | stray_animal_bites |
|-------------------|---------------|-------------|------------------|-----------|-------------------|
| Barangay 1 | Quezon City | 45 | 30 | 40 | 35 |
| Barangay 2 | Quezon City | 32 | 20 | 28 | 25 |

**Use**: Identify high-risk areas for targeted rabies control programs.

---

### **Use Case 4: Repeat Exposure Risk Analysis**

**Scenario**: Identify patients with multiple bite incidents who didn't complete PEP (high risk).

**Query**:

```sql
SELECT
  p.first_name || ' ' || p.last_name AS patient_name,
  p.contact_number,
  COUNT(e.id) AS total_bite_incidents,
  SUM(CASE WHEN (e.bite_incident->>'previous_pep_completed')::boolean = FALSE THEN 1 ELSE 0 END) AS incomplete_pep_count,
  MAX(e.started_at::date) AS last_bite_date
FROM patients p
JOIN encounters e ON e.patient_id = p.id
WHERE e.categorization LIKE '%Bite%'
  AND (e.bite_incident->>'is_repeat_exposure')::boolean = TRUE
GROUP BY p.id, p.first_name, p.last_name, p.contact_number
HAVING SUM(CASE WHEN (e.bite_incident->>'previous_pep_completed')::boolean = FALSE THEN 1 ELSE 0 END) > 0
ORDER BY incomplete_pep_count DESC, last_bite_date DESC;
```

**Output**:
| patient_name | contact_number | total_bite_incidents | incomplete_pep_count | last_bite_date |
|--------------|----------------|---------------------|---------------------|----------------|
| Jane Smith | 09171234567 | 3 | 2 | 2026-03-01 |
| Bob Johnson | 09189876543 | 2 | 1 | 2026-02-15 |

**Use**: Prioritize outreach to high-risk patients who didn't complete previous PEP.

---

## **Integration with Existing Schema**

### **Relationship Diagram**:

```
patients (1) ----< (many) encounters
                      |
                      | (contains JSONB)
                      |
                      v
                  bite_incident JSONB ----< (referenced by) clinical_orders
                      |                              |
                      |                              v
                      |                      patient_standing_orders
                      |
                      v
              (epidemiological tracking via JSONB queries)
```

### **Workflow**:

1. Patient arrives with dog bite
2. Nurse creates `encounter` with `categorization = 'Dog_Bite'`
3. Nurse populates `bite_incident` JSONB with detailed incident info
4. Doctor reviews, orders standing order protocol
5. System checks `bite_incident->>'is_repeat_exposure'`:
   - If 'false' → Full PEP (4 doses)
   - If 'true' and `previous_pep_completed = 'true'` → Booster (2 doses)
6. System generates `clinical_orders` from standing order template
7. Nurse administers Day 0 services
8. System tracks animal observation period via JSONB
9. If animal remains healthy after 14 days → System recommends discontinuing PEP

---

## **Benefits**

### **1. Complete Patient History**

- View all bite incidents for a patient across their lifetime via encounters
- Understand patterns (repeat exposures, high-risk behavior)
- Make informed clinical decisions based on history

### **2. Proper Repeat Exposure Handling**

- Automatically detect repeat exposures via JSONB queries
- Recommend appropriate protocol (booster vs. full PEP)
- Track PEP completion status

### **3. Animal Observation Tracking**

- Track 14-day observation period via JSONB
- Discontinue PEP if animal remains healthy (save costs, reduce unnecessary treatment)
- Follow WHO guidelines

### **4. Epidemiological Surveillance**

- Track bite incidents by location (barangay, city, province) via JSONB queries
- Identify rabies hotspots
- Support public health interventions
- Generate reports for DOH

### **5. Risk Stratification**

- Identify high-risk patients (multiple bites, incomplete PEP) via JSONB queries
- Prioritize outreach and follow-up
- Improve PEP completion rates

### **6. Schema Simplicity**

- Keep schema at 18 tables (not 19)
- All bite data stays with encounter (no joins needed)
- Easy to extend JSONB structure without schema changes
- GIN indexes make JSONB queries performant

---

## **Migration from Existing System**

### **Existing Fields → New Schema**:

**Patient Table**:

```sql
p_OnboardingChannel → patients.onboarding_channel
p_DateFirstVisit → patients.date_first_visit
```

**Encounter Table**:

```sql
p_Categorization → encounters.categorization
p_SourceOfConcern → encounters.bite_incident->>'source_of_concern'
p_PetStatus → encounters.bite_incident->>'animal_status'
```

**Migration Script**:

```sql
-- Migrate onboarding channel and first visit date
UPDATE patients p
SET
  onboarding_channel = (
    SELECT p_OnboardingChannel
    FROM Patient old
    WHERE CONCAT(old.p_FirstName, ' ', old.p_LastName) = CONCAT(p.first_name, ' ', p.last_name)
  ),
  date_first_visit = (
    SELECT p_DateFirstVisit
    FROM Patient old
    WHERE CONCAT(old.p_FirstName, ' ', old.p_LastName) = CONCAT(p.first_name, ' ', p.last_name)
  );

-- Migrate bite incident data into encounters JSONB
UPDATE encounters e
SET
  categorization = (
    SELECT p_Categorization
    FROM Patient old
    WHERE old."Row ID" = (SELECT "Row ID" FROM Patient WHERE CONCAT(p_FirstName, ' ', p_LastName) = (SELECT first_name || ' ' || last_name FROM patients WHERE id = e.patient_id))
  ),
  bite_incident = jsonb_build_object(
    'source_of_concern', (SELECT p_SourceOfConcern FROM Patient old WHERE old."Row ID" = (SELECT "Row ID" FROM Patient WHERE CONCAT(p_FirstName, ' ', p_LastName) = (SELECT first_name || ' ' || last_name FROM patients WHERE id = e.patient_id))),
    'animal_status', (SELECT p_PetStatus FROM Patient old WHERE old."Row ID" = (SELECT "Row ID" FROM Patient WHERE CONCAT(p_FirstName, ' ', p_LastName) = (SELECT first_name || ' ' || last_name FROM patients WHERE id = e.patient_id))),
    'bite_category', 'III', -- Default to Category III (most common)
    'is_repeat_exposure', false -- Will need manual review for repeat exposures
  )
WHERE e.categorization IN ('Dog_Bite', 'Cat_Bite', 'Rat_Bite', 'Monkey_Bite');
```

---

## **Summary**

**Approach**: JSONB in encounters table (not separate table)  
**New Tables**: 0 (no new tables added)  
**Enhanced Tables**: 2 (`patients`, `encounters`)  
**New Fields**: 3 fields (onboarding_channel, date_first_visit in patients; bite_incident JSONB in encounters)

**Key Improvements**:

- ✅ Track multiple bite incidents per patient (via encounters)
- ✅ Detect repeat exposures automatically (via JSONB queries)
- ✅ Track animal observation periods (via JSONB)
- ✅ Support epidemiological surveillance (via JSONB queries with GIN indexes)
- ✅ Enable risk stratification (via JSONB queries)
- ✅ Proper clinical decision support for repeat exposures
- ✅ Complete patient bite history (via encounters)
- ✅ Keep schema simple (18 tables, not 19)
- ✅ Easy to extend JSONB structure without schema changes
- ✅ Performant queries with GIN indexes

**Total Tables**: 18 (unchanged)
