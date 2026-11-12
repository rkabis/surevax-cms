# **SureVax CMS v2.0: Redesigned Database Schema**

## **Standing Order-Centric Architecture for Sustainable Clinic Operations**

---

## **Executive Summary**

This schema redesign fundamentally shifts the system architecture to treat **Standing Orders** as the primary abstraction for service delivery. Rather than treating bundles as simple groupings of catalog items, standing orders become first-class clinical protocols that define:

1. **What services** a patient receives (immunizations, lab tests, consultations)
2. **When they receive them** (Day 0, 3, 7, 14, 28 schedules)
3. **How they're authorized** (physician-initiated protocols that nurses can execute)
4. **How they're tracked** (FSM-based state management across multiple visits)

This approach supports:

- **Multi-dose immunization protocols** (4 ARV doses, 2 tetanus shots)
- **Lab-to-lab diagnostic services** (sample drop-off, external processing, result delivery)
- **Mixed service protocols** (combining vaccines, lab tests, and consultations)
- **Future expansion** into chronic disease management, wellness programs, and preventive care

---

## **Architectural Principles**

### **1. Standing Orders as Clinical Protocols**

Standing orders are physician-authorized treatment plans that span multiple visits. They define the complete care pathway for a patient condition.

### **2. Separation of Authorization from Execution**

A physician authorizes a standing order once (Day 0). Nurses execute individual components across multiple visits without re-authorization.

### **3. Service Polymorphism**

All billable items (vaccines, lab tests, consultations) inherit from a common service catalog, enabling uniform pricing, inventory, and billing.

### **4. Lab Service Abstraction**

Lab tests are treated as services with distinct lifecycle states (ordered → sample collected → sent to partner → results received → completed).

### **5. Temporal Decoupling**

Clinical orders exist independently of encounters, allowing future appointments to be pre-created and tracked by the recall engine.

---

## **System-Wide Standards**

- **Primary Keys**: UUID for global uniqueness and offline-sync readiness
- **Audit Trail**: Every table implicitly includes `created_at`, `updated_at`, `created_by_id`
- **Soft Deletes**: Use `is_active` or `deleted_at` flags instead of hard deletes
- **Branch Isolation**: All data scoped by `branch_id` for multi-tenancy
- **Immutable Ledgers**: Financial and inventory transactions are append-only

---

## **Domain 1: Multi-Tenancy & Access Control**

### **Table: branches**

Physical clinic locations with strict data isolation.

| Column        | Type         | Constraints      | Purpose                                      |
| ------------- | ------------ | ---------------- | -------------------------------------------- |
| id            | UUID         | PK               | Unique branch identifier                     |
| name          | VARCHAR(255) | NOT NULL         | Display name (e.g., "Cainta Branch")         |
| code          | VARCHAR(10)  | NOT NULL, UNIQUE | Short code for transaction IDs (e.g., "CNT") |
| address       | TEXT         |                  | Physical address                             |
| contact_email | VARCHAR(255) |                  | Branch email                                 |
| contact_phone | VARCHAR(50)  |                  | Branch phone                                 |
| is_active     | BOOLEAN      | DEFAULT TRUE     | Soft delete flag                             |
| settings      | JSONB        |                  | Branch-specific configuration                |

**Indexes**: `idx_branches_code`, `idx_branches_active`

---

### **Table: users**

Staff members with role-based access control.

| Column         | Type         | Constraints      | Purpose                                                                                |
| -------------- | ------------ | ---------------- | -------------------------------------------------------------------------------------- |
| id             | UUID         | PK               | Unique user identifier                                                                 |
| branch_id      | UUID         | FK → branches.id | Assigned branch (RBAC anchor)                                                          |
| email          | VARCHAR(255) | NOT NULL, UNIQUE | Login credential                                                                       |
| password_hash  | VARCHAR(255) | NOT NULL         | Bcrypt hashed password                                                                 |
| first_name     | VARCHAR(100) | NOT NULL         |                                                                                        |
| last_name      | VARCHAR(100) | NOT NULL         |                                                                                        |
| role           | ENUM         | NOT NULL         | 'SuperAdmin', 'BranchManager', 'Doctor', 'Nurse', 'LabTech', 'Cashier', 'Receptionist' |
| license_number | VARCHAR(50)  |                  | Professional license (for doctors/nurses)                                              |
| is_active      | BOOLEAN      | DEFAULT TRUE     | Account status                                                                         |
| last_login_at  | TIMESTAMP    |                  | Last successful login                                                                  |

**Indexes**: `idx_users_email`, `idx_users_branch_role`, `idx_users_active`

---

## **Domain 2: Patient Registry**

### **Table: patients**

Master patient index with demographics and medical history.

| Column                   | Type         | Constraints      | Purpose                             |
| ------------------------ | ------------ | ---------------- | ----------------------------------- |
| id                       | UUID         | PK               | Unique patient identifier           |
| home_branch_id           | UUID         | FK → branches.id | Primary registration branch         |
| first_name               | VARCHAR(100) | NOT NULL         |                                     |
| middle_name              | VARCHAR(100) |                  |                                     |
| last_name                | VARCHAR(100) | NOT NULL         |                                     |
| suffix                   | VARCHAR(20)  |                  | Jr., Sr., III, etc.                 |
| dob                      | DATE         | NOT NULL         | Date of birth (for age calculation) |
| sex                      | VARCHAR(1)   |                  | 'M', 'F', 'O'                       |
| contact_number           | VARCHAR(50)  |                  | Primary phone (for SMS recalls)     |
| email                    | VARCHAR(255) |                  | Email address                       |
| address                  | TEXT         |                  | Residential address                 |
| guardian_name            | VARCHAR(255) |                  | Required for minors                 |
| guardian_contact         | VARCHAR(50)  |                  | Guardian phone                      |
| emergency_contact_name   | VARCHAR(255) |                  | Emergency contact person            |
| emergency_contact_number | VARCHAR(50)  |                  | Emergency phone                     |
| allergies                | TEXT         |                  | Known allergies (searchable)        |
| medical_conditions       | TEXT         |                  | Chronic conditions                  |
| is_active                | BOOLEAN      | DEFAULT TRUE     | Soft delete flag                    |

**Indexes**: `idx_patients_name`, `idx_patients_dob`, `idx_patients_contact`, `idx_patients_branch`

---

### **Table: patient_accounts**

Separate authentication for patient portal access.

| Column         | Type         | Constraints              | Purpose                       |
| -------------- | ------------ | ------------------------ | ----------------------------- |
| id             | UUID         | PK                       |                               |
| patient_id     | UUID         | FK → patients.id, UNIQUE | 1-to-1 link to medical record |
| email          | VARCHAR(255) | UNIQUE, NOT NULL         | Portal login                  |
| password_hash  | VARCHAR(255) | NOT NULL                 | Bcrypt hashed                 |
| email_verified | BOOLEAN      | DEFAULT FALSE            | Email verification status     |
| is_active      | BOOLEAN      | DEFAULT TRUE             | Account status                |

**Indexes**: `idx_patient_accounts_email`

---

## **Domain 3: Service Catalog & Standing Order Templates**

### **Table: service_catalog**

Polymorphic base table for all orderable services (vaccines, lab tests, consultations, goods).

| Column                | Type          | Constraints      | Purpose                                                            |
| --------------------- | ------------- | ---------------- | ------------------------------------------------------------------ |
| id                    | UUID          | PK               | Unique service identifier                                          |
| code                  | VARCHAR(50)   | UNIQUE, NOT NULL | Internal service code (e.g., "ARV-SPEEDA")                         |
| name                  | VARCHAR(255)  | NOT NULL         | Display name                                                       |
| description           | TEXT          |                  | Detailed description                                               |
| service_type          | ENUM          | NOT NULL         | 'Immunization', 'Laboratory', 'Consultation', 'Procedure', 'Goods' |
| category              | VARCHAR(100)  |                  | Grouping (e.g., "Rabies PEP", "Hematology")                        |
| base_price            | DECIMAL(10,2) | NOT NULL         | Default price                                                      |
| is_stockable          | BOOLEAN       | DEFAULT FALSE    | Requires inventory tracking                                        |
| is_active             | BOOLEAN       | DEFAULT TRUE     | Available for ordering                                             |
| requires_prescription | BOOLEAN       | DEFAULT FALSE    | Needs doctor authorization                                         |

**Indexes**: `idx_service_catalog_code`, `idx_service_catalog_type`, `idx_service_catalog_active`

---

### **Table: service_immunizations**

Extended attributes for vaccine services (Class-Table Inheritance pattern).

| Column              | Type         | Constraints                 | Purpose                                                |
| ------------------- | ------------ | --------------------------- | ------------------------------------------------------ |
| service_id          | UUID         | PK, FK → service_catalog.id | Links to base service                                  |
| cvx_code            | VARCHAR(20)  |                             | CDC vaccine code                                       |
| target_disease      | VARCHAR(100) |                             | Disease prevented                                      |
| dose_volume_ml      | DECIMAL(5,2) |                             | Standard dose volume                                   |
| route               | ENUM         |                             | 'Intradermal', 'Intramuscular', 'Subcutaneous', 'Oral' |
| administration_site | VARCHAR(100) |                             | Typical site (e.g., "Deltoid")                         |
| min_age_months      | INTEGER      |                             | Minimum patient age                                    |
| max_age_months      | INTEGER      |                             | Maximum patient age (NULL = no limit)                  |

**Indexes**: `idx_service_immunizations_cvx`

---

### **Table: service_laboratory**

Extended attributes for lab test services.

| Column                | Type         | Constraints                 | Purpose                   |
| --------------------- | ------------ | --------------------------- | ------------------------- |
| service_id            | UUID         | PK, FK → service_catalog.id | Links to base service     |
| loinc_code            | VARCHAR(20)  |                             | Standard lab test code    |
| specimen_type         | VARCHAR(100) |                             | Blood, Urine, Stool, etc. |
| specimen_volume_ml    | DECIMAL(5,2) |                             | Required volume           |
| specimen_container    | VARCHAR(100) |                             | Container type            |
| turnaround_time_hours | INTEGER      |                             | Expected TAT              |
| requires_fasting      | BOOLEAN      | DEFAULT FALSE               | Fasting requirement       |
| test_method           | VARCHAR(255) |                             | Testing methodology       |
| reference_range       | TEXT         |                             | Normal values             |

**Indexes**: `idx_service_laboratory_loinc`, `idx_service_laboratory_specimen`

---

### **Table: service_goods**

Extended attributes for retail goods and supplies.

| Column           | Type        | Constraints                 | Purpose                 |
| ---------------- | ----------- | --------------------------- | ----------------------- |
| service_id       | UUID        | PK, FK → service_catalog.id | Links to base service   |
| sku              | VARCHAR(50) | UNIQUE                      | Stock keeping unit      |
| upc_barcode      | VARCHAR(50) |                             | Universal product code  |
| unit_of_measure  | VARCHAR(20) |                             | Each, Box, Bottle, etc. |
| reorder_level    | INTEGER     |                             | Minimum stock threshold |
| reorder_quantity | INTEGER     |                             | Standard reorder amount |

**Indexes**: `idx_service_goods_sku`, `idx_service_goods_upc`

---

### **Table: standing_order_templates**

**CORE ABSTRACTION**: Reusable clinical protocols that define multi-service, multi-visit care pathways.

| Column                  | Type         | Constraints      | Purpose                                               |
| ----------------------- | ------------ | ---------------- | ----------------------------------------------------- |
| id                      | UUID         | PK               | Unique template identifier                            |
| code                    | VARCHAR(50)  | UNIQUE, NOT NULL | Template code (e.g., "RABIES-PEP-CAT3")               |
| name                    | VARCHAR(255) | NOT NULL         | Display name (e.g., "Rabies PEP Category III")        |
| description             | TEXT         |                  | Clinical indication and usage                         |
| protocol_type           | ENUM         | NOT NULL         | 'Immunization', 'Laboratory', 'Mixed', 'Chronic_Care' |
| is_active               | BOOLEAN      | DEFAULT TRUE     | Available for use                                     |
| requires_physician_auth | BOOLEAN      | DEFAULT TRUE     | Needs doctor to initiate                              |
| version                 | INTEGER      | DEFAULT 1        | Version control for protocol updates                  |

**Purpose**: Templates define the "recipe" for care. When a doctor diagnoses a patient with a dog bite (Category III), they activate the "RABIES-PEP-CAT3" template, which automatically generates all required orders across multiple visits.

**Indexes**: `idx_standing_order_templates_code`, `idx_standing_order_templates_active`

---

### **Table: standing_order_template_items**

Defines the individual services within a standing order template and their timing.

| Column       | Type    | Constraints                      | Purpose                                    |
| ------------ | ------- | -------------------------------- | ------------------------------------------ |
| id           | UUID    | PK                               |                                            |
| template_id  | UUID    | FK → standing_order_templates.id | Parent template                            |
| service_id   | UUID    | FK → service_catalog.id          | Service to be delivered                    |
| sequence     | INTEGER | NOT NULL                         | Order of execution                         |
| day_offset   | INTEGER | NOT NULL                         | Days from protocol start (0, 3, 7, 14, 28) |
| quantity     | INTEGER | DEFAULT 1                        | Number of units                            |
| is_required  | BOOLEAN | DEFAULT TRUE                     | Mandatory vs optional                      |
| instructions | TEXT    |                                  | Special instructions for staff             |

**Example**: The "RABIES-PEP-CAT3" template contains:

- Item 1: Consultation (Day 0, sequence 1)
- Item 2: Wound Cleaning (Day 0, sequence 2)
- Item 3: ARV Dose 1 (Day 0, sequence 3)
- Item 4: ERIG (Day 0, sequence 4)
- Item 5: Tetanus Toxoid (Day 0, sequence 5)
- Item 6: ARV Dose 2 (Day 3, sequence 1)
- Item 7: ARV Dose 3 (Day 7, sequence 1)
- Item 8: ARV Dose 4 (Day 14, sequence 1)

**Indexes**: `idx_template_items_template`, `idx_template_items_service`, `idx_template_items_day`

---

### **Table: standing_order_template_lab_panels**

Groups multiple lab tests into panels (e.g., "Complete Blood Count" includes WBC, RBC, Hemoglobin, etc.).

| Column      | Type         | Constraints                      | Purpose               |
| ----------- | ------------ | -------------------------------- | --------------------- |
| id          | UUID         | PK                               |                       |
| template_id | UUID         | FK → standing_order_templates.id | Parent template       |
| panel_name  | VARCHAR(255) | NOT NULL                         | Panel display name    |
| sequence    | INTEGER      | NOT NULL                         | Order within template |
| day_offset  | INTEGER      | NOT NULL                         | When to perform       |

**Indexes**: `idx_template_lab_panels_template`

---

### **Table: standing_order_template_lab_tests**

Individual tests within a lab panel.

| Column      | Type    | Constraints                                | Purpose          |
| ----------- | ------- | ------------------------------------------ | ---------------- |
| id          | UUID    | PK                                         |                  |
| panel_id    | UUID    | FK → standing_order_template_lab_panels.id | Parent panel     |
| service_id  | UUID    | FK → service_catalog.id                    | Lab test service |
| is_required | BOOLEAN | DEFAULT TRUE                               | Mandatory test   |

**Indexes**: `idx_template_lab_tests_panel`, `idx_template_lab_tests_service`

---

## **Domain 4: Clinical Operations**

### **Table: encounters**

Individual patient visits to the clinic.

| Column          | Type      | Constraints                | Purpose                                         |
| --------------- | --------- | -------------------------- | ----------------------------------------------- |
| id              | UUID      | PK                         | Unique encounter identifier                     |
| patient_id      | UUID      | FK → patients.id, NOT NULL | Patient being seen                              |
| branch_id       | UUID      | FK → branches.id, NOT NULL | Visit location                                  |
| provider_id     | UUID      | FK → users.id, NOT NULL    | Attending physician/nurse                       |
| encounter_type  | ENUM      | NOT NULL                   | 'Initial', 'Follow_Up', 'Emergency', 'Lab_Only' |
| started_at      | TIMESTAMP | DEFAULT NOW()              | Check-in time                                   |
| ended_at        | TIMESTAMP |                            | Check-out time                                  |
| chief_complaint | TEXT      |                            | Reason for visit                                |
| status          | ENUM      | DEFAULT 'In_Progress'      | 'In_Progress', 'Completed', 'Cancelled'         |

**Indexes**: `idx_encounters_patient`, `idx_encounters_branch_date`, `idx_encounters_provider`

---

### **Table: clinical_notes**

SOAP notes, vitals, and clinical documentation.

| Column           | Type         | Constraints                  | Purpose                                          |
| ---------------- | ------------ | ---------------------------- | ------------------------------------------------ |
| id               | UUID         | PK                           |                                                  |
| encounter_id     | UUID         | FK → encounters.id, NOT NULL | Parent encounter                                 |
| author_id        | UUID         | FK → users.id, NOT NULL      | Note author                                      |
| note_type        | ENUM         | NOT NULL                     | 'Triage_Vitals', 'SOAP', 'Progress', 'Discharge' |
| systolic_bp      | INTEGER      |                              | Blood pressure (systolic)                        |
| diastolic_bp     | INTEGER      |                              | Blood pressure (diastolic)                       |
| heart_rate       | INTEGER      |                              | Beats per minute                                 |
| respiratory_rate | INTEGER      |                              | Breaths per minute                               |
| temperature_c    | DECIMAL(4,1) |                              | Temperature in Celsius                           |
| weight_kg        | DECIMAL(5,2) |                              | Weight in kilograms                              |
| height_cm        | DECIMAL(5,2) |                              | Height in centimeters                            |
| subjective       | TEXT         |                              | Patient's description                            |
| objective        | TEXT         |                              | Clinical findings                                |
| assessment       | TEXT         |                              | Diagnosis/impression                             |
| plan             | TEXT         |                              | Treatment plan                                   |
| content          | JSONB        |                              | Additional structured data                       |
| is_amended       | BOOLEAN      | DEFAULT FALSE                | Edit flag for compliance                         |
| amended_at       | TIMESTAMP    |                              | When amended                                     |
| amended_by_id    | UUID         | FK → users.id                | Who amended                                      |

**Indexes**: `idx_clinical_notes_encounter`, `idx_clinical_notes_author`, `idx_clinical_notes_type`

---

### **Table: patient_standing_orders**

**CORE TABLE**: Active standing orders for individual patients (instances of templates).

| Column                  | Type      | Constraints                      | Purpose                                          |
| ----------------------- | --------- | -------------------------------- | ------------------------------------------------ |
| id                      | UUID      | PK                               | Unique standing order instance                   |
| patient_id              | UUID      | FK → patients.id, NOT NULL       | Patient receiving care                           |
| template_id             | UUID      | FK → standing_order_templates.id | Protocol being followed                          |
| initiating_encounter_id | UUID      | FK → encounters.id               | Day 0 encounter                                  |
| authorizing_provider_id | UUID      | FK → users.id, NOT NULL          | Doctor who authorized                            |
| start_date              | DATE      | NOT NULL                         | Protocol start date (Day 0)                      |
| status                  | ENUM      | DEFAULT 'Active'                 | 'Active', 'Completed', 'Discontinued', 'On_Hold' |
| discontinuation_reason  | TEXT      |                                  | Why stopped (if discontinued)                    |
| discontinued_by_id      | UUID      | FK → users.id                    | Who discontinued                                 |
| discontinued_at         | TIMESTAMP |                                  | When discontinued                                |
| notes                   | TEXT      |                                  | Special instructions                             |

**Purpose**: When a doctor sees a dog bite patient on March 1, they create a `patient_standing_order` linked to the "RABIES-PEP-CAT3" template. This generates all future clinical orders automatically.

**Indexes**: `idx_patient_standing_orders_patient`, `idx_patient_standing_orders_template`, `idx_patient_standing_orders_status`

---

### **Table: clinical_orders**

**RECALL ENGINE CORE**: Individual service orders generated from standing orders or ad-hoc requests.

| Column                    | Type         | Constraints                       | Purpose                                    |
| ------------------------- | ------------ | --------------------------------- | ------------------------------------------ |
| id                        | UUID         | PK                                | Unique order identifier                    |
| patient_id                | UUID         | FK → patients.id, NOT NULL        | Patient                                    |
| standing_order_id         | UUID         | FK → patient_standing_orders.id   | Parent protocol (NULL for ad-hoc)          |
| service_id                | UUID         | FK → service_catalog.id, NOT NULL | Service ordered                            |
| encounter_id              | UUID         | FK → encounters.id                | Encounter when completed (NULL if pending) |
| ordering_provider_id      | UUID         | FK → users.id, NOT NULL           | Who ordered                                |
| administering_provider_id | UUID         | FK → users.id                     | Who administered (NULL if pending)         |
| order_type                | ENUM         | NOT NULL                          | 'Standing_Order', 'Ad_Hoc', 'STAT'         |
| status                    | ENUM         | DEFAULT 'Pending'                 | FSM states (see below)                     |
| priority                  | ENUM         | DEFAULT 'Routine'                 | 'STAT', 'Urgent', 'Routine'                |
| scheduled_date            | DATE         |                                   | Ideal date (protocol-driven)               |
| due_date                  | DATE         |                                   | Calculated due date (with grace period)    |
| completed_at              | TIMESTAMP    |                                   | Actual completion time                     |
| quantity                  | INTEGER      | DEFAULT 1                         | Number of units                            |
| administration_site       | VARCHAR(100) |                                   | For injections (e.g., "Left Deltoid")      |
| administration_route      | VARCHAR(50)  |                                   | For medications (e.g., "IM", "ID")         |
| lot_id                    | UUID         | FK → inventory_lots.id            | Inventory traceability                     |
| notes                     | JSONB        |                                   | Execution details                          |

**FSM Status Values**:

- `Pending`: Future appointment, not yet due
- `Due`: Current date matches scheduled_date
- `Overdue`: Past due_date without completion
- `In_Progress`: Sample collected (for labs) or started
- `Completed`: Service delivered
- `Missed`: Patient no-show, marked as missed
- `Cancelled`: Order cancelled by provider
- `Discontinued`: Parent standing order discontinued

**Indexes**: `idx_clinical_orders_patient`, `idx_clinical_orders_standing_order`, `idx_clinical_orders_status`, `idx_clinical_orders_scheduled_date`, `idx_clinical_orders_service`

---

### **Table: lab_orders**

Extended tracking for laboratory orders (Class-Table Inheritance).

| Column                   | Type         | Constraints                  | Purpose                     |
| ------------------------ | ------------ | ---------------------------- | --------------------------- |
| clinical_order_id        | UUID         | PK, FK → clinical_orders.id  | Links to base order         |
| panel_name               | VARCHAR(255) |                              | Panel name if part of panel |
| specimen_collected_at    | TIMESTAMP    |                              | When sample taken           |
| specimen_collected_by_id | UUID         | FK → users.id                | Who collected               |
| specimen_barcode         | VARCHAR(100) |                              | Tracking barcode            |
| sent_to_partner_at       | TIMESTAMP    |                              | When sent to external lab   |
| partner_lab_id           | UUID         | FK → partner_laboratories.id | External lab                |
| partner_reference_no     | VARCHAR(100) |                              | Lab's tracking number       |
| results_received_at      | TIMESTAMP    |                              | When results arrived        |
| results_released_at      | TIMESTAMP    |                              | When released to patient    |
| results_released_by_id   | UUID         | FK → users.id                | Who released                |
| critical_flag            | BOOLEAN      | DEFAULT FALSE                | Abnormal/critical result    |

**Indexes**: `idx_lab_orders_specimen_barcode`, `idx_lab_orders_partner`, `idx_lab_orders_status`

---

### **Table: lab_results**

Individual test results within a lab order.

| Column          | Type         | Constraints                       | Purpose                   |
| --------------- | ------------ | --------------------------------- | ------------------------- |
| id              | UUID         | PK                                |                           |
| lab_order_id    | UUID         | FK → lab_orders.clinical_order_id | Parent lab order          |
| test_service_id | UUID         | FK → service_catalog.id           | Specific test             |
| result_value    | VARCHAR(255) |                                   | Numeric or text result    |
| result_unit     | VARCHAR(50)  |                                   | Unit of measure           |
| reference_range | VARCHAR(100) |                                   | Normal range              |
| is_abnormal     | BOOLEAN      | DEFAULT FALSE                     | Outside normal range      |
| interpretation  | TEXT         |                                   | Clinical interpretation   |
| file_url        | VARCHAR(500) |                                   | Cloud storage link to PDF |

**Indexes**: `idx_lab_results_lab_order`, `idx_lab_results_test`

---

### **Table: partner_laboratories**

External labs for lab-to-lab services.

| Column                | Type         | Constraints  | Purpose                                     |
| --------------------- | ------------ | ------------ | ------------------------------------------- |
| id                    | UUID         | PK           |                                             |
| name                  | VARCHAR(255) | NOT NULL     | Lab name (e.g., "Hi-Precision Diagnostics") |
| code                  | VARCHAR(50)  | UNIQUE       | Short code                                  |
| contact_person        | VARCHAR(255) |              | Primary contact                             |
| contact_email         | VARCHAR(255) |              | Email                                       |
| contact_phone         | VARCHAR(50)  |              | Phone                                       |
| address               | TEXT         |              | Physical address                            |
| api_endpoint          | VARCHAR(500) |              | API URL for integration                     |
| api_key_encrypted     | VARCHAR(500) |              | Encrypted API credentials                   |
| turnaround_time_hours | INTEGER      |              | Standard TAT                                |
| is_active             | BOOLEAN      | DEFAULT TRUE | Active partnership                          |

**Indexes**: `idx_partner_laboratories_code`, `idx_partner_laboratories_active`

---

### **Table: animal_bite_assessments**

Specialized data for ABTC/NaRIS reporting (extends encounters).

| Column                     | Type         | Constraints            | Purpose                                     |
| -------------------------- | ------------ | ---------------------- | ------------------------------------------- |
| encounter_id               | UUID         | PK, FK → encounters.id | Links to encounter                          |
| who_category               | ENUM         | NOT NULL               | 'Category_I', 'Category_II', 'Category_III' |
| bite_date                  | DATE         | NOT NULL               | When bite occurred                          |
| bite_location_body         | VARCHAR(255) |                        | Anatomical location                         |
| wound_type                 | ENUM         |                        | 'None', 'Scratch', 'Bite', 'Lick'           |
| wound_depth                | ENUM         |                        | 'Superficial', 'Deep'                       |
| animal_type                | VARCHAR(100) |                        | Dog, Cat, Bat, etc.                         |
| animal_status              | ENUM         |                        | 'Alive', 'Dead', 'Unknown'                  |
| animal_vaccinated          | BOOLEAN      |                        | Known vaccination status                    |
| animal_observation_start   | DATE         |                        | 14-day observation start                    |
| animal_observation_end     | DATE         |                        | 14-day observation end                      |
| animal_observation_outcome | ENUM         |                        | 'Healthy', 'Sick', 'Dead', 'Lost'           |
| provoked                   | BOOLEAN      |                        | Was animal provoked                         |
| location_incident          | TEXT         |                        | Where bite occurred                         |

**Indexes**: `idx_animal_bite_assessments_who_category`, `idx_animal_bite_assessments_bite_date`

---

## **Domain 5: Inventory Management**

### **Table: inventory_lots**

Batch/lot tracking for stockable items with FEFO support.

| Column            | Type          | Constraints                       | Purpose                    |
| ----------------- | ------------- | --------------------------------- | -------------------------- |
| id                | UUID          | PK                                |                            |
| service_id        | UUID          | FK → service_catalog.id, NOT NULL | Stockable service          |
| branch_id         | UUID          | FK → branches.id, NOT NULL        | Storage location           |
| batch_number      | VARCHAR(100)  | NOT NULL                          | Manufacturer lot number    |
| manufacturer      | VARCHAR(255)  |                                   | Manufacturer name          |
| expiry_date       | DATE          | NOT NULL                          | Expiration date (FEFO key) |
| received_date     | DATE          | NOT NULL                          | When received              |
| received_quantity | INTEGER       | NOT NULL                          | Initial quantity           |
| quantity_on_hand  | INTEGER       | NOT NULL                          | Current quantity           |
| unit_cost         | DECIMAL(10,2) |                                   | Cost per unit              |
| supplier          | VARCHAR(255)  |                                   | Supplier name              |
| storage_location  | VARCHAR(100)  |                                   | Shelf/bin location         |
| is_quarantined    | BOOLEAN       | DEFAULT FALSE                     | Hold for quality issues    |
| quarantine_reason | TEXT          |                                   | Why quarantined            |

**Indexes**: `idx_inventory_lots_service_branch`, `idx_inventory_lots_expiry`, `idx_inventory_lots_batch`

---

### **Table: inventory_transactions**

Immutable audit trail of all inventory movements.

| Column           | Type        | Constraints                      | Purpose                                                               |
| ---------------- | ----------- | -------------------------------- | --------------------------------------------------------------------- |
| id               | UUID        | PK                               |                                                                       |
| lot_id           | UUID        | FK → inventory_lots.id, NOT NULL | Affected lot                                                          |
| transaction_type | ENUM        | NOT NULL                         | 'Receipt', 'Dispensed', 'Adjustment', 'Expired', 'Transfer', 'Return' |
| quantity_change  | INTEGER     | NOT NULL                         | Positive (in) or negative (out)                                       |
| quantity_after   | INTEGER     | NOT NULL                         | Balance after transaction                                             |
| reference_type   | VARCHAR(50) |                                  | 'ClinicalOrder', 'PurchaseOrder', 'Adjustment'                        |
| reference_id     | UUID        |                                  | Polymorphic FK to reference                                           |
| performed_by_id  | UUID        | FK → users.id, NOT NULL          | Who performed                                                         |
| notes            | TEXT        |                                  | Transaction notes                                                     |

**Indexes**: `idx_inventory_transactions_lot`, `idx_inventory_transactions_reference`, `idx_inventory_transactions_date`

---

## **Domain 6: Pricing & Billing**

### **Table: payer_profiles**

Insurance companies, HMOs, corporate accounts, and discount groups.

| Column                   | Type         | Constraints   | Purpose                                                  |
| ------------------------ | ------------ | ------------- | -------------------------------------------------------- |
| id                       | UUID         | PK            |                                                          |
| name                     | VARCHAR(255) | NOT NULL      | Payer name                                               |
| code                     | VARCHAR(50)  | UNIQUE        | Short code                                               |
| payer_type               | ENUM         | NOT NULL      | 'HMO', 'Corporate', 'Government_Mandated', 'Promotional' |
| requires_id_verification | BOOLEAN      | DEFAULT FALSE | Must capture ID number                                   |
| payment_terms_days       | INTEGER      |               | Net payment terms                                        |
| contact_person           | VARCHAR(255) |               | Account manager                                          |
| contact_email            | VARCHAR(255) |               | Email                                                    |
| contact_phone            | VARCHAR(50)  |               | Phone                                                    |
| is_active                | BOOLEAN      | DEFAULT TRUE  | Active status                                            |

**Indexes**: `idx_payer_profiles_code`, `idx_payer_profiles_type`, `idx_payer_profiles_active`

---

### **Table: price_tiers**

Rate cards for different payer types.

| Column         | Type         | Constraints                      | Purpose                                 |
| -------------- | ------------ | -------------------------------- | --------------------------------------- |
| id             | UUID         | PK                               |                                         |
| payer_id       | UUID         | FK → payer_profiles.id, NOT NULL | Associated payer                        |
| name           | VARCHAR(255) | NOT NULL                         | Tier name (e.g., "Maxicare 2026 Rates") |
| effective_from | DATE         | NOT NULL                         | Start date                              |
| effective_to   | DATE         |                                  | End date (NULL = indefinite)            |
| is_active      | BOOLEAN      | DEFAULT TRUE                     | Active status                           |

**Indexes**: `idx_price_tiers_payer`, `idx_price_tiers_effective`

---

### **Table: tier_prices**

Service-specific pricing overrides within a tier.

| Column              | Type          | Constraints                       | Purpose                          |
| ------------------- | ------------- | --------------------------------- | -------------------------------- |
| id                  | UUID          | PK                                |                                  |
| tier_id             | UUID          | FK → price_tiers.id, NOT NULL     | Parent tier                      |
| service_id          | UUID          | FK → service_catalog.id, NOT NULL | Service                          |
| custom_price        | DECIMAL(10,2) |                                   | Override price (NULL = use base) |
| discount_percentage | DECIMAL(5,2)  |                                   | Discount % (NULL = no discount)  |

**Unique Constraint**: `(tier_id, service_id)`

**Indexes**: `idx_tier_prices_tier`, `idx_tier_prices_service`

---

### **Table: transactions**

Financial transaction header (invoice/receipt).

| Column             | Type          | Constraints                | Purpose                                           |
| ------------------ | ------------- | -------------------------- | ------------------------------------------------- |
| id                 | UUID          | PK                         |                                                   |
| reference_number   | VARCHAR(50)   | UNIQUE, NOT NULL           | Human-readable ID (e.g., "CNT-2026-00123")        |
| branch_id          | UUID          | FK → branches.id, NOT NULL | Transaction location                              |
| patient_id         | UUID          | FK → patients.id, NOT NULL | Patient                                           |
| encounter_id       | UUID          | FK → encounters.id         | Associated encounter (NULL for retail)            |
| transaction_date   | DATE          | NOT NULL                   | Transaction date                                  |
| cashier_id         | UUID          | FK → users.id, NOT NULL    | Who processed                                     |
| payer_id           | UUID          | FK → payer_profiles.id     | Primary payer (NULL = self-pay)                   |
| total_gross        | DECIMAL(10,2) | NOT NULL                   | Before discounts                                  |
| total_discount     | DECIMAL(10,2) | DEFAULT 0                  | Total discounts applied                           |
| total_vat_exempt   | DECIMAL(10,2) | DEFAULT 0                  | VAT-exempt amount                                 |
| total_vat          | DECIMAL(10,2) | DEFAULT 0                  | VAT amount                                        |
| total_net          | DECIMAL(10,2) | NOT NULL                   | Final amount due                                  |
| discount_id_type   | VARCHAR(50)   |                            | 'OSCA', 'PWD', 'Promo'                            |
| discount_id_number | VARCHAR(100)  |                            | ID number for BIR compliance                      |
| status             | ENUM          | DEFAULT 'Unpaid'           | 'Paid', 'Partial', 'Unpaid', 'Refunded', 'Voided' |
| voided_at          | TIMESTAMP     |                            | When voided                                       |
| voided_by_id       | UUID          | FK → users.id              | Who voided                                        |
| void_reason        | TEXT          |                            | Why voided                                        |

**Indexes**: `idx_transactions_reference`, `idx_transactions_patient`, `idx_transactions_branch_date`, `idx_transactions_status`

---

### **Table: transaction_items**

Line items within a transaction.

| Column            | Type          | Constraints                       | Purpose                   |
| ----------------- | ------------- | --------------------------------- | ------------------------- |
| id                | UUID          | PK                                |                           |
| transaction_id    | UUID          | FK → transactions.id, NOT NULL    | Parent transaction        |
| clinical_order_id | UUID          | FK → clinical_orders.id           | Links to clinical order   |
| service_id        | UUID          | FK → service_catalog.id, NOT NULL | Service sold              |
| quantity          | INTEGER       | DEFAULT 1                         | Number of units           |
| unit_price        | DECIMAL(10,2) | NOT NULL                          | Price per unit (snapshot) |
| discount_amount   | DECIMAL(10,2) | DEFAULT 0                         | Discount applied          |
| vat_exempt        | BOOLEAN       | DEFAULT FALSE                     | VAT exemption flag        |
| subtotal          | DECIMAL(10,2) | NOT NULL                          | Line total                |

**Indexes**: `idx_transaction_items_transaction`, `idx_transaction_items_clinical_order`, `idx_transaction_items_service`

---

### **Table: payments**

Payment records (supports split payments).

| Column           | Type          | Constraints                    | Purpose                                                                         |
| ---------------- | ------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| id               | UUID          | PK                             |                                                                                 |
| transaction_id   | UUID          | FK → transactions.id, NOT NULL | Parent transaction                                                              |
| payment_method   | ENUM          | NOT NULL                       | 'Cash', 'GCash', 'Maya', 'PayMongo', 'BankTransfer', 'ChargeToAccount', 'Check' |
| amount           | DECIMAL(10,2) | NOT NULL                       | Payment amount                                                                  |
| payer_id         | UUID          | FK → payer_profiles.id         | For ChargeToAccount                                                             |
| reference_number | VARCHAR(100)  |                                | External reference (e.g., GCash ref)                                            |
| payment_date     | DATE          | NOT NULL                       | When paid                                                                       |
| received_by_id   | UUID          | FK → users.id, NOT NULL        | Who received                                                                    |
| notes            | TEXT          |                                | Payment notes                                                                   |

**Indexes**: `idx_payments_transaction`, `idx_payments_method`, `idx_payments_payer`

---

## **Domain 7: Recall Engine & Notifications**

### **Table: recall_schedules**

Tracks expected patient returns for the recall engine.

| Column            | Type      | Constraints                       | Purpose                                                     |
| ----------------- | --------- | --------------------------------- | ----------------------------------------------------------- |
| id                | UUID      | PK                                |                                                             |
| patient_id        | UUID      | FK → patients.id, NOT NULL        | Patient                                                     |
| standing_order_id | UUID      | FK → patient_standing_orders.id   | Associated protocol                                         |
| clinical_order_id | UUID      | FK → clinical_orders.id, NOT NULL | Specific order due                                          |
| scheduled_date    | DATE      | NOT NULL                          | Expected date                                               |
| recall_status     | ENUM      | DEFAULT 'Scheduled'               | 'Scheduled', 'Reminded', 'Completed', 'Missed', 'Cancelled' |
| reminder_sent_at  | TIMESTAMP |                                   | When SMS sent                                               |
| reminder_count    | INTEGER   | DEFAULT 0                         | Number of reminders sent                                    |

**Indexes**: `idx_recall_schedules_patient`, `idx_recall_schedules_date`, `idx_recall_schedules_status`

---

### **Table: notifications**

Audit log of all notifications sent to patients.

| Column            | Type         | Constraints                | Purpose                                             |
| ----------------- | ------------ | -------------------------- | --------------------------------------------------- |
| id                | UUID         | PK                         |                                                     |
| patient_id        | UUID         | FK → patients.id, NOT NULL | Recipient                                           |
| notification_type | ENUM         | NOT NULL                   | 'SMS', 'Email', 'Push'                              |
| channel           | VARCHAR(50)  |                            | 'Twilio', 'Semaphore', 'SendGrid'                   |
| recipient         | VARCHAR(255) | NOT NULL                   | Phone or email                                      |
| subject           | VARCHAR(255) |                            | Email subject                                       |
| message           | TEXT         | NOT NULL                   | Message content                                     |
| status            | ENUM         | DEFAULT 'Pending'          | 'Pending', 'Sent', 'Delivered', 'Failed', 'Bounced' |
| sent_at           | TIMESTAMP    |                            | When sent                                           |
| delivered_at      | TIMESTAMP    |                            | When delivered                                      |
| error_message     | TEXT         |                            | Failure reason                                      |
| reference_type    | VARCHAR(50)  |                            | 'RecallSchedule', 'LabResult', 'Appointment'        |
| reference_id      | UUID         |                            | Polymorphic FK                                      |

**Indexes**: `idx_notifications_patient`, `idx_notifications_status`, `idx_notifications_sent_at`

---

## **Domain 8: Audit & Compliance**

### **Table: audit_logs**

Immutable audit trail for all sensitive operations.

| Column      | Type         | Constraints   | Purpose                                                 |
| ----------- | ------------ | ------------- | ------------------------------------------------------- |
| id          | UUID         | PK            |                                                         |
| user_id     | UUID         | FK → users.id | Who performed action                                    |
| action      | VARCHAR(100) | NOT NULL      | 'CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT' |
| entity_type | VARCHAR(100) | NOT NULL      | Table name                                              |
| entity_id   | UUID         |               | Record ID                                               |
| ip_address  | VARCHAR(50)  |               | Client IP                                               |
| user_agent  | TEXT         |               | Browser/client info                                     |
| changes     | JSONB        |               | Before/after values                                     |
| timestamp   | TIMESTAMP    | DEFAULT NOW() | When occurred                                           |

**Indexes**: `idx_audit_logs_user`, `idx_audit_logs_entity`, `idx_audit_logs_timestamp`

---

### **Table: data_retention_policies**

Configurable retention periods for different data types.

| Column          | Type         | Constraints      | Purpose                |
| --------------- | ------------ | ---------------- | ---------------------- |
| id              | UUID         | PK               |                        |
| entity_type     | VARCHAR(100) | UNIQUE, NOT NULL | Table/data type        |
| retention_years | INTEGER      | NOT NULL         | Years to retain        |
| description     | TEXT         |                  | Policy description     |
| legal_basis     | TEXT         |                  | Regulatory requirement |

**Example Data**:

- `outpatient_records`: 10 years
- `inpatient_records`: 15 years
- `medico_legal_records`: 25 years
- `laboratory_records`: 2 years
- `audit_logs`: 7 years

---

### **Table: data_breach_incidents**

Security incident tracking for NPC compliance.

| Column                 | Type      | Constraints    | Purpose                                             |
| ---------------------- | --------- | -------------- | --------------------------------------------------- |
| id                     | UUID      | PK             |                                                     |
| incident_type          | ENUM      | NOT NULL       | 'Confidentiality', 'Integrity', 'Availability'      |
| discovered_at          | TIMESTAMP | NOT NULL       | When discovered                                     |
| reported_to_npc_at     | TIMESTAMP |                | When reported (72-hour requirement)                 |
| affected_records_count | INTEGER   |                | Number of records affected                          |
| description            | TEXT      | NOT NULL       | Incident details                                    |
| root_cause             | TEXT      |                | Analysis                                            |
| remediation_actions    | TEXT      |                | Steps taken                                         |
| status                 | ENUM      | DEFAULT 'Open' | 'Open', 'Under_Investigation', 'Resolved', 'Closed' |
| assigned_to_id         | UUID      | FK → users.id  | SIRT member                                         |

**Indexes**: `idx_data_breach_incidents_discovered`, `idx_data_breach_incidents_status`

---

## **Domain 9: Shift Management & Operations**

### **Table: staff_shifts**

Time clock for nurse shift tracking.

| Column      | Type         | Constraints                | Purpose                                      |
| ----------- | ------------ | -------------------------- | -------------------------------------------- |
| id          | UUID         | PK                         |                                              |
| user_id     | UUID         | FK → users.id, NOT NULL    | Staff member                                 |
| branch_id   | UUID         | FK → branches.id, NOT NULL | Work location                                |
| clock_in    | TIMESTAMP    | NOT NULL                   | Start time                                   |
| clock_out   | TIMESTAMP    |                            | End time                                     |
| total_hours | DECIMAL(5,2) |                            | Calculated hours                             |
| shift_type  | ENUM         |                            | 'Morning', 'Afternoon', 'Night', 'Graveyard' |
| notes       | TEXT         |                            | Shift notes                                  |

**Indexes**: `idx_staff_shifts_user`, `idx_staff_shifts_branch_date`

---

### **Table: daily_reports**

End-of-day financial summaries.

| Column                | Type          | Constraints                | Purpose             |
| --------------------- | ------------- | -------------------------- | ------------------- |
| id                    | UUID          | PK                         |                     |
| branch_id             | UUID          | FK → branches.id, NOT NULL | Branch              |
| report_date           | DATE          | NOT NULL                   | Business date       |
| total_transactions    | INTEGER       | NOT NULL                   | Transaction count   |
| total_patients_served | INTEGER       | NOT NULL                   | Unique patients     |
| total_gross_sales     | DECIMAL(10,2) | NOT NULL                   | Before discounts    |
| total_discounts       | DECIMAL(10,2) | NOT NULL                   | Discounts given     |
| total_net_sales       | DECIMAL(10,2) | NOT NULL                   | After discounts     |
| cash_collected        | DECIMAL(10,2) | NOT NULL                   | Cash payments       |
| digital_collected     | DECIMAL(10,2) | NOT NULL                   | GCash/Maya/PayMongo |
| charge_to_account     | DECIMAL(10,2) | NOT NULL                   | HMO/Corporate       |
| generated_by_id       | UUID          | FK → users.id, NOT NULL    | Who generated       |
| generated_at          | TIMESTAMP     | DEFAULT NOW()              | When generated      |

**Unique Constraint**: `(branch_id, report_date)`

**Indexes**: `idx_daily_reports_branch_date`

---

## **Key Design Patterns & Rationale**

### **1. Standing Orders as First-Class Citizens**

**Problem**: Original schema treated bundles as simple groupings. This doesn't capture the temporal, multi-visit nature of clinical protocols.

**Solution**:

- `standing_order_templates` define reusable protocols
- `patient_standing_orders` are active instances for specific patients
- `clinical_orders` are individual services generated from standing orders
- This three-tier hierarchy separates protocol definition, patient enrollment, and service execution

**Benefits**:

- Physicians authorize once, nurses execute multiple times
- Protocols can be versioned and updated without affecting active patients
- Clear audit trail from template → patient enrollment → individual services
- Supports complex multi-visit, multi-service care pathways

---

### **2. Service Polymorphism via Class-Table Inheritance**

**Problem**: Vaccines, lab tests, and goods have different attributes but need uniform billing/inventory.

**Solution**:

- `service_catalog` is the polymorphic base (common attributes)
- `service_immunizations`, `service_laboratory`, `service_goods` extend with specific attributes
- All services share the same pricing, inventory, and billing infrastructure

**Benefits**:

- Type-safe: Database enforces NOT NULL constraints on type-specific fields
- Extensible: Add new service types without modifying existing tables
- Uniform: All services use the same `clinical_orders` and `transaction_items` tables
- FHIR-aligned: Maps directly to FHIR PlanDefinition → ActivityDefinition pattern

---

### **3. Lab-to-Lab Service Architecture**

**Problem**: Need to support sample drop-off, external processing, and result delivery.

**Solution**:

- `clinical_orders` with `service_type = 'Laboratory'` are base orders
- `lab_orders` extends with specimen tracking and partner lab routing
- `lab_results` stores individual test results within a panel
- `partner_laboratories` manages external lab relationships

**Workflow**:

1. Patient drops off sample → `clinical_orders.status = 'In_Progress'`
2. Sample collected → `lab_orders.specimen_collected_at` recorded
3. Sent to partner → `lab_orders.sent_to_partner_at`, `partner_lab_id` set
4. Results received → `lab_orders.results_received_at`, `lab_results` populated
5. Released to patient → `lab_orders.results_released_at`, `clinical_orders.status = 'Completed'`

**Benefits**:

- Clear state machine for lab order lifecycle
- Supports both in-house and external lab processing
- Traceability via specimen barcodes and partner reference numbers
- Critical result flagging for urgent follow-up

---

### **4. Temporal Decoupling of Orders and Encounters**

**Problem**: Future appointments don't have encounters yet, but need to exist in the system.

**Solution**:

- `clinical_orders.encounter_id` is nullable
- Pending orders exist without encounters
- When patient arrives, encounter is created and linked to the order
- Recall engine queries orders by `scheduled_date`, not encounter date

**Benefits**:

- Future appointments visible in "Expected Patients" roster
- SMS reminders sent before encounter exists
- No orphaned data when patients no-show
- Clean separation of clinical intent (order) from clinical execution (encounter)

---

### **5. Financial Transaction Immutability**

**Problem**: Need to support refunds, voids, and adjustments without losing audit trail.

**Solution**:

- Transactions are never deleted or updated
- Voids are marked with `voided_at`, `voided_by_id`, `void_reason`
- Refunds create new transactions with negative amounts
- `transaction_items.unit_price` is a snapshot (never changes even if catalog price updates)

**Benefits**:

- Complete audit trail for BIR compliance
- Historical reports remain accurate
- No cascading updates when prices change
- Clear distinction between business logic (void) and data corruption (delete)

---

### **6. FEFO Inventory Management**

**Problem**: Need to use oldest stock first to minimize waste.

**Solution**:

- `inventory_lots.expiry_date` is indexed
- Query: `SELECT * FROM inventory_lots WHERE service_id = ? AND quantity_on_hand > 0 ORDER BY expiry_date ASC LIMIT 1`
- Hard-stop: Reject orders if `expiry_date < CURRENT_DATE`
- `inventory_transactions` provides immutable audit trail

**Benefits**:

- Automatic FEFO compliance
- Prevents expired medication administration
- Traceability for product recalls via `lot_id` in `clinical_orders`
- Real-time stock visibility

---

### **7. Multi-Tenant Branch Isolation**

**Problem**: Strict data separation between branches for security and compliance.

**Solution**:

- All core tables include `branch_id`
- Application middleware automatically filters queries by user's assigned branch
- SuperAdmin role bypasses filter for cross-branch reporting
- Database-level RLS policies can be added for defense-in-depth

**Benefits**:

- Prevents accidental cross-branch data leakage
- Supports franchise/multi-location model
- Enables branch-specific pricing and inventory
- Simplifies compliance audits (data physically separated)

---

## **Example Workflows**

### **Workflow 1: Rabies PEP Standing Order (4 ARV Doses)**

**Day 0 - Initial Visit**:

1. Patient presents with dog bite
2. Doctor creates `encounter` (Initial visit)
3. Doctor creates `animal_bite_assessment` (Category III)
4. Doctor activates standing order:
   ```sql
   INSERT INTO patient_standing_orders (
     patient_id, template_id, initiating_encounter_id,
     authorizing_provider_id, start_date, status
   ) VALUES (
     'patient-uuid', 'RABIES-PEP-CAT3-template-uuid',
     'encounter-uuid', 'doctor-uuid', '2026-03-01', 'Active'
   );
   ```
5. System auto-generates 8 `clinical_orders`:
   - Day 0: Consultation, Wound Cleaning, ARV Dose 1, ERIG, Tetanus
   - Day 3: ARV Dose 2 (status='Pending', scheduled_date='2026-03-04')
   - Day 7: ARV Dose 3 (status='Pending', scheduled_date='2026-03-08')
   - Day 14: ARV Dose 4 (status='Pending', scheduled_date='2026-03-15')
6. Nurse administers Day 0 services:
   - Updates `clinical_orders.status = 'Completed'`
   - Links to `inventory_lots` for ARV and Tetanus
   - Creates `inventory_transactions` for deductions
7. Cashier creates `transaction` and `transaction_items`
8. Patient pays, `payments` recorded

**Day 3 - Follow-up Visit**:

1. Recall engine identifies due order (scheduled_date = today)
2. SMS sent to patient: "Your ARV Dose 2 is due today at Cainta Branch"
3. Patient arrives, receptionist creates new `encounter` (Follow_Up)
4. Nurse finds pending order, links to encounter
5. Nurse administers ARV Dose 2 (standing order, no doctor needed)
6. System updates `clinical_orders.status = 'Completed'`, `completed_at = NOW()`
7. Inventory deducted, transaction created

**Day 7, 14**: Same as Day 3

**Result**:

- 1 standing order → 8 clinical orders → 4 encounters → 4 transactions
- Complete audit trail from authorization to execution
- No manual date calculations
- Automatic SMS reminders

---

### **Workflow 2: Lab-to-Lab Complete Blood Count**

**Sample Drop-off**:

1. Patient walks in with lab request from external doctor
2. Receptionist creates `encounter` (Lab_Only)
3. Receptionist creates `clinical_order`:
   - `service_id` = "Complete Blood Count" (from catalog)
   - `order_type` = 'Ad_Hoc'
   - `status` = 'Pending'
4. Lab tech collects sample:
   - Updates `clinical_orders.status = 'In_Progress'`
   - Creates `lab_orders` record:
     ```sql
     INSERT INTO lab_orders (
       clinical_order_id, specimen_collected_at,
       specimen_collected_by_id, specimen_barcode
     ) VALUES (
       'order-uuid', NOW(), 'labtech-uuid', 'BARCODE-12345'
     );
     ```
5. Sample sent to Hi-Precision:
   - Updates `lab_orders.sent_to_partner_at = NOW()`
   - Sets `lab_orders.partner_lab_id = 'hi-precision-uuid'`
   - Sets `lab_orders.partner_reference_no = 'HP-2026-00789'`
6. Cashier creates transaction for lab fee

**Results Received** (2 days later):

1. Hi-Precision sends results via API or manual upload
2. System updates `lab_orders.results_received_at = NOW()`
3. System creates `lab_results` records:
   - WBC: 8.5 x10^9/L (normal)
   - RBC: 4.8 x10^12/L (normal)
   - Hemoglobin: 14.2 g/dL (normal)
   - Hematocrit: 42% (normal)
4. System uploads PDF to S3, stores URL in `lab_results.file_url`
5. System sends SMS: "Your CBC results are ready. View at portal.surevax.ph"

**Results Released**:

1. Patient logs into portal or visits clinic
2. Staff releases results:
   - Updates `lab_orders.results_released_at = NOW()`
   - Sets `lab_orders.results_released_by_id = 'staff-uuid'`
   - Updates `clinical_orders.status = 'Completed'`

**Result**:

- Clear state machine: Pending → In_Progress → Completed
- Traceability via specimen barcode and partner reference
- Automated patient notification
- Secure result delivery

---

### **Workflow 3: Mixed Standing Order (2 Tetanus + 1 Lab Test)**

**Scenario**: Patient needs tetanus booster series + baseline CBC

**Day 0**:

1. Doctor creates custom standing order template (or uses existing):
   - Template: "Tetanus Booster Series + CBC"
   - Items:
     - Day 0: Consultation, CBC (lab), Tetanus Dose 1
     - Day 30: Tetanus Dose 2
2. Doctor activates standing order for patient
3. System generates 4 clinical orders:
   - Consultation (Day 0, status='Pending')
   - CBC (Day 0, status='Pending', service_type='Laboratory')
   - Tetanus Dose 1 (Day 0, status='Pending')
   - Tetanus Dose 2 (Day 30, status='Pending')
4. Nurse administers consultation and Tetanus Dose 1
5. Lab tech collects blood sample for CBC
6. Sample sent to partner lab
7. Transaction created for Day 0 services

**Day 2**:

- CBC results received, patient notified

**Day 30**:

- Recall engine sends SMS reminder
- Patient returns for Tetanus Dose 2
- Nurse administers (standing order)
- Transaction created

**Result**:

- Single standing order manages both immunization and lab services
- Different service types handled uniformly
- Temporal coordination across multiple visits

---

## **Migration Strategy from Original Schema**

### **Mapping Old → New**

| Original Table       | New Table(s)                                                 | Notes                             |
| -------------------- | ------------------------------------------------------------ | --------------------------------- |
| `catalog_items`      | `service_catalog` + type-specific tables                     | Split into polymorphic hierarchy  |
| `item_bundles`       | `standing_order_templates` + `standing_order_template_items` | Elevated to first-class protocols |
| `clinical_orders`    | `clinical_orders` + `lab_orders`                             | Extended for lab tracking         |
| `diagnostic_results` | `lab_results`                                                | Renamed for clarity               |
| N/A                  | `patient_standing_orders`                                    | NEW: Tracks active protocols      |
| N/A                  | `partner_laboratories`                                       | NEW: External lab management      |
| N/A                  | `recall_schedules`                                           | NEW: Explicit recall tracking     |
| N/A                  | `standing_order_template_lab_panels`                         | NEW: Lab panel support            |

### **Data Migration Steps**

1. **Service Catalog Migration**:

   ```sql
   -- Migrate base services
   INSERT INTO service_catalog (id, code, name, service_type, base_price, is_stockable)
   SELECT id, name, name, type, base_price, is_stockable
   FROM catalog_items;

   -- Migrate immunizations
   INSERT INTO service_immunizations (service_id, cvx_code, target_disease)
   SELECT id, 'TBD', 'TBD'  -- Manual mapping required
   FROM catalog_items
   WHERE type = 'Service' AND name LIKE '%vaccine%';
   ```

2. **Standing Order Template Creation**:

   ```sql
   -- Convert bundles to templates
   INSERT INTO standing_order_templates (id, code, name, protocol_type)
   SELECT
     gen_random_uuid(),
     parent.name,
     parent.name,
     'Immunization'
   FROM catalog_items parent
   WHERE parent.type = 'Bundle';

   -- Migrate bundle items to template items
   INSERT INTO standing_order_template_items (
     template_id, service_id, sequence, day_offset, quantity
   )
   SELECT
     template.id,
     bundle.child_item_id,
     ROW_NUMBER() OVER (PARTITION BY bundle.parent_item_id ORDER BY bundle.id),
     0,  -- All Day 0 in old schema
     bundle.quantity
   FROM item_bundles bundle
   JOIN standing_order_templates template ON template.code = (
     SELECT name FROM catalog_items WHERE id = bundle.parent_item_id
   );
   ```

3. **Clinical Orders Migration**:

   ```sql
   -- Migrate existing orders
   INSERT INTO clinical_orders (
     id, patient_id, service_id, encounter_id,
     ordering_provider_id, status, completed_at
   )
   SELECT
     id, patient_id, item_id, encounter_id,
     created_by_id,
     CASE
       WHEN completed_at IS NOT NULL THEN 'Completed'
       ELSE 'Pending'
     END,
     completed_at
   FROM old_clinical_orders;
   ```

4. **Lab Orders Migration**:
   ```sql
   -- Migrate lab-specific data
   INSERT INTO lab_orders (
     clinical_order_id, partner_lab_id,
     results_received_at, results_released_at
   )
   SELECT
     co.id,
     dr.partner_lab_id,
     dr.released_at,
     dr.released_at
   FROM old_clinical_orders co
   JOIN old_diagnostic_results dr ON dr.order_id = co.id;
   ```

---

## **Performance Optimization**

### **Critical Indexes**

```sql
-- Recall engine performance
CREATE INDEX idx_clinical_orders_recall
ON clinical_orders (patient_id, status, scheduled_date)
WHERE status IN ('Pending', 'Due', 'Overdue');

-- FEFO inventory selection
CREATE INDEX idx_inventory_lots_fefo
ON inventory_lots (service_id, branch_id, expiry_date, quantity_on_hand)
WHERE quantity_on_hand > 0 AND is_quarantined = FALSE;

-- Branch isolation filter
CREATE INDEX idx_encounters_branch_date
ON encounters (branch_id, started_at)
WHERE status != 'Cancelled';

-- Transaction search
CREATE INDEX idx_transactions_search
ON transactions (branch_id, transaction_date, status, patient_id);

-- Audit log queries
CREATE INDEX idx_audit_logs_entity_time
ON audit_logs (entity_type, entity_id, timestamp DESC);
```

### **Partitioning Strategy**

For high-volume tables, consider time-based partitioning:

```sql
-- Partition audit_logs by month
CREATE TABLE audit_logs (
  -- columns
) PARTITION BY RANGE (timestamp);

CREATE TABLE audit_logs_2026_03 PARTITION OF audit_logs
FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- Partition transactions by year
CREATE TABLE transactions (
  -- columns
) PARTITION BY RANGE (transaction_date);
```

### **Materialized Views**

```sql
-- Daily patient volume by branch
CREATE MATERIALIZED VIEW mv_daily_patient_volume AS
SELECT
  branch_id,
  DATE(started_at) as visit_date,
  COUNT(DISTINCT patient_id) as unique_patients,
  COUNT(*) as total_encounters
FROM encounters
WHERE status = 'Completed'
GROUP BY branch_id, DATE(started_at);

-- Refresh nightly
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_patient_volume;
```

---

## **Security Considerations**

### **Row-Level Security (Defense-in-Depth)**

```sql
-- Enable RLS on sensitive tables
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see patients from their branch
CREATE POLICY branch_isolation_policy ON patients
FOR ALL
TO authenticated_users
USING (
  home_branch_id = current_setting('app.current_branch_id')::uuid
  OR
  EXISTS (
    SELECT 1 FROM users
    WHERE id = current_setting('app.current_user_id')::uuid
    AND role = 'SuperAdmin'
  )
);
```

### **Encryption at Rest**

- Use PostgreSQL's `pgcrypto` extension for column-level encryption
- Encrypt sensitive fields: `password_hash`, `api_key_encrypted`, `discount_id_number`
- Store encryption keys in separate key management service (AWS KMS, HashiCorp Vault)

### **Audit Triggers**

```sql
-- Auto-populate audit logs
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    user_id, action, entity_type, entity_id, changes
  ) VALUES (
    current_setting('app.current_user_id')::uuid,
    TG_OP,
    TG_TABLE_NAME,
    NEW.id,
    jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to sensitive tables
CREATE TRIGGER audit_patients
AFTER INSERT OR UPDATE OR DELETE ON patients
FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
```

---

## **Future Extensibility**

### **Chronic Disease Management**

Add standing order templates for:

- Diabetes monitoring (quarterly HbA1c, annual eye exam)
- Hypertension management (monthly BP checks, annual ECG)
- Asthma control (quarterly spirometry, annual chest X-ray)

### **Wellness Programs**

Add service types:

- `service_type = 'Wellness'` (health screenings, fitness assessments)
- `standing_order_templates` for annual physical exam packages
- Integration with wearable devices via `patient_vitals_history` table

### **Telemedicine**

Add tables:

- `virtual_encounters` (extends encounters with video call metadata)
- `remote_monitoring_data` (patient-submitted vitals)
- `teleconsultation_sessions` (video call logs)

### **Pharmacy Integration**

Add tables:

- `prescriptions` (medication orders)
- `prescription_items` (individual medications)
- `medication_dispensing` (pharmacy fulfillment)
- Link to `inventory_lots` for medication tracking

---

## **Conclusion**

This redesigned schema provides a **sustainable, scalable foundation** for SureVax CMS v2.0 by:

1. **Elevating standing orders** to first-class clinical protocols
2. **Supporting lab-to-lab services** with full lifecycle tracking
3. **Enabling service polymorphism** for uniform billing and inventory
4. **Maintaining temporal decoupling** for robust recall engine operation
5. **Ensuring financial immutability** for audit compliance
6. **Enforcing multi-tenant isolation** for security and scalability

The architecture supports current ABTC operations while providing clear extension points for future growth into comprehensive primary care, chronic disease management, and wellness services.

---

**Schema Version**: 2.0  
**Last Updated**: March 9, 2026  
**Author**: SureVax Development Team
