# **SureVax CMS v2.0: Master Data Dictionary**

## **Overview**

This document defines the production-ready PostgreSQL relational database schema for SureVax CMS v2.0. The architecture is engineered to support **Multi-Tenancy** (Branch Isolation), **Service Abstraction** (Urgent Care scaling), **Dynamic B2B/B2C Pricing** (HMOs/Mandated Discounts), and **Automated Medical Protocols** (The Recall Engine).

**System-Wide Technical Standards:**

- **Primary Keys:** UUID is used for all IDs to ensure global uniqueness, secure API routing, and safe offline-syncing capabilities in the future.
- **The Audit Baseline:** _Every_ table listed below implicitly contains created_at (Timestamp), updated_at (Timestamp), and created_by_id (UUID FK \-\> users) to ensure a bulletproof, legally compliant audit trail. They are omitted from the visual tables below only for brevity.

## ---

**Domain 1: Multi-Tenancy & Access Control**

_This domain enforces the physical separation of clinic operations. It ensures that staff at "Branch A" cannot access data, inventory, or financial records for "Branch B", enabling a scalable franchise or multi-branch model._

### **Table: branches**

| Column       | Type       | Constraints      | Context / Purpose                                                                                                                                                          |
| :----------- | :--------- | :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | UUID       | PK               | Unique identifier for the clinic location.                                                                                                                                 |
| name         | VARCHAR    | NOT NULL         | e.g., "Cainta Branch".                                                                                                                                                     |
| code         | VARCHAR(5) | NOT NULL, UNIQUE | e.g., "CNT". Used as a prefix for generating readable Transaction IDs (e.g., CNT-2026-0001).                                                                               |
| contact_info | JSONB      |                  | Stores branch email, phone, and address flexibly.                                                                                                                          |
| settings     | JSONB      |                  | Configuration details (e.g., default receipt printer IPs, operating hours). JSONB is safe here as this data is only read by the frontend for state, never queried against. |

### **Table: users (Staff Access)**

| Column        | Type    | Constraints         | Context / Purpose                                                                                                                                  |
| :------------ | :------ | :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| id            | UUID    | PK                  | Staff unique identifier.                                                                                                                           |
| branch_id     | UUID    | FK \-\> branches.id | **Security Anchor:** The foundation for Role-Based Access Control (RBAC). Automatically scopes all of the user's queries to their assigned branch. |
| email         | VARCHAR | NOT NULL, UNIQUE    | Staff login credential.                                                                                                                            |
| password_hash | VARCHAR | NOT NULL            | Bcrypt hashed password.                                                                                                                            |
| role          | ENUM    | NOT NULL            | 'SuperAdmin', 'BranchManager', 'Nurse', 'Doctor', 'Cashier'. Determines UI feature limits.                                                         |
| is_active     | BOOLEAN | DEFAULT TRUE        | Soft delete flag. Toggled to FALSE when staff resigns, revoking access without creating orphaned historical clinical logs.                         |

## ---

**Domain 2: Patient Registry & Mobile Readiness**

_Tracks demographics, handles pediatric consent, and isolates the medical record from future patient portal login credentials._

### **Table: patients**

| Column             | Type       | Constraints         | Context / Purpose                                                                                                                |
| :----------------- | :--------- | :------------------ | :------------------------------------------------------------------------------------------------------------------------------- |
| id                 | UUID       | PK                  | Master patient medical record.                                                                                                   |
| home_branch_id     | UUID       | FK \-\> branches.id | Indicates where the patient originally registered.                                                                               |
| first_name         | VARCHAR    | NOT NULL            |                                                                                                                                  |
| last_name          | VARCHAR    | NOT NULL            |                                                                                                                                  |
| dob                | DATE       | NOT NULL            | **Strict Column:** Enables dynamic age calculation at runtime (crucial for pediatric vs. adult dosing).                          |
| sex                | VARCHAR(1) |                     | 'M', 'F'.                                                                                                                        |
| contact_number     | VARCHAR    |                     | Primary destination for automated SMS Recall reminders.                                                                          |
| guardian_name      | VARCHAR    |                     | **Pediatric Gap Closed:** Required for minors receiving treatment.                                                               |
| emerg_contact_name | VARCHAR    |                     | **Liability Gap Closed:** Strict column for rapid emergency lookups.                                                             |
| emerg_contact_num  | VARCHAR    |                     | **Liability Gap Closed:** Strict column for rapid emergency lookups.                                                             |
| allergies          | TEXT       |                     | **Medical Safety:** Strict text column (e.g., "Penicillin, Peanuts") so doctors can run global query reports for safety recalls. |
| pet_status         | ENUM       |                     | 'Alive', 'Dead', 'Unknown', 'N/A'. Critical flag dictating the continuation of Rabies PEP protocols.                             |

### **Table: patient_accounts (Mobile App Auth)**

| Column        | Type    | Constraints                 | Context / Purpose                                                                                                |
| :------------ | :------ | :-------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| id            | UUID    | PK                          |                                                                                                                  |
| patient_id    | UUID    | FK \-\> patients.id, UNIQUE | 1-to-1 link to their medical timeline. Separated so walk-in patients don't require an app account to be treated. |
| email         | VARCHAR | UNIQUE                      | Login credential for the mobile app portal.                                                                      |
| password_hash | VARCHAR | NOT NULL                    | Encrypted password.                                                                                              |

## ---

**Domain 3: Catalog & Dynamic Pricing Engine**

_Abstracts all billable items. Solves the complexity of HMO charge accounts, bundles, and mandated B2C discounts (Senior/PWD) at the item level._

### **Table: catalog_items (The Master Menu)**

| Column        | Type    | Constraints   | Context / Purpose                                                                                                                                                                                |
| :------------ | :------ | :------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id            | UUID    | PK            |                                                                                                                                                                                                  |
| name          | VARCHAR | NOT NULL      | e.g., "Anti-Rabies (Speeda)", "Wound Cleaning", "Urinalysis".                                                                                                                                    |
| type          | ENUM    | NOT NULL      | 'Service', 'Goods', 'Diagnostic', 'Bundle'. Dictates UI rendering and workflows.                                                                                                                 |
| is_stockable  | BOOLEAN | DEFAULT FALSE | If TRUE, the system expects to deduct this from inventory_lots upon usage.                                                                                                                       |
| is_protocol   | BOOLEAN | DEFAULT FALSE | If TRUE, this item triggers the **Recall Engine** to calculate future dates.                                                                                                                     |
| base_price    | DECIMAL | NOT NULL      | The default out-of-pocket price.                                                                                                                                                                 |
| protocol_days | JSONB   |               | Defines standing order intervals (e.g., \[0, 3, 7, 14, 28\] for PEP). JSONB is used here because the DB doesn't query _inside_ the array; the Node.js backend just extracts it to compute dates. |

### **Table: item_bundles (The "Macro" Config)**

| Column         | Type    | Constraints              | Context / Purpose                                                            |
| :------------- | :------ | :----------------------- | :--------------------------------------------------------------------------- |
| parent_item_id | UUID    | FK \-\> catalog_items.id | The trigger item (e.g., "New Dog Bite \- Category III").                     |
| child_item_id  | UUID    | FK \-\> catalog_items.id | The components (e.g., "Consultation", "Speeda", "ERIG").                     |
| quantity       | INTEGER | DEFAULT 1                | Quantity of child items to auto-generate when the parent bundle is selected. |

### **Table: payer_profiles (Entities & Discount Groups)**

| Column      | Type    | Constraints   | Context / Purpose                                                                                           |
| :---------- | :------ | :------------ | :---------------------------------------------------------------------------------------------------------- |
| id          | UUID    | PK            |                                                                                                             |
| name        | VARCHAR | NOT NULL      | e.g., "Maxicare", "Senior Citizen", "DMCI Promo".                                                           |
| type        | ENUM    | NOT NULL      | 'HMO', 'Corporate', 'Gov_Mandated', 'Promo'.                                                                |
| requires_id | BOOLEAN | DEFAULT FALSE | If TRUE, the POS forces the cashier to input an ID number (e.g., PWD ID) before finalizing the transaction. |

### **Table: price_tiers & tier_prices (Pricing Override Logic)**

| Table       | Column       | Type      | Context / Purpose                                                                                                                                                                |
| :---------- | :----------- | :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| price_tiers | id           | UUID (PK) | Represents a rate card (e.g., "Ayala 2026 Rates", "Senior 20%").                                                                                                                 |
| price_tiers | payer_id     | UUID (FK) | Links the rate card to the payer_profiles.                                                                                                                                       |
| tier_prices | tier_id      | UUID (FK) |                                                                                                                                                                                  |
| tier_prices | item_id      | UUID (FK) | Links the pricing rule to a specific catalog_item.                                                                                                                               |
| tier_prices | custom_price | DECIMAL   | **HMO Markup:** Overrides base_price entirely (e.g., Flu shot is P1200, set to P1500 for HMOs to cover delayed payment terms).                                                   |
| tier_prices | discount_pct | DECIMAL   | **B2C Discount:** Applies a % off (e.g., 20% off for Seniors). Scalable because non-discountable items (like promos) simply won't have a row here, preventing illegal discounts. |

## ---

**Domain 4: Clinical Operations & Diagnostics**

_The Timeline of events. Separates the medical reality (what was done, who did it, and clinical notes) from the financial reality._

### **Table: encounters (The Visit Wrapper)**

| Column      | Type      | Constraints         | Context / Purpose                                                                                             |
| :---------- | :-------- | :------------------ | :------------------------------------------------------------------------------------------------------------ |
| id          | UUID      | PK                  | Groups multiple services and notes under a single physical visit.                                             |
| patient_id  | UUID      | FK \-\> patients.id |                                                                                                               |
| branch_id   | UUID      | FK \-\> branches.id | Solves the edge case of a patient visiting a different branch than their "home" branch for an emergency dose. |
| provider_id | UUID      | FK \-\> users.id    | The primary doctor/triage nurse responsible for initiating the visit.                                         |
| started_at  | TIMESTAMP | DEFAULT NOW()       | Time in.                                                                                                      |

### **Table: clinical_notes (Vitals & SOAP)**

| Column        | Type    | Constraints           | Context / Purpose                                                                                                                    |
| :------------ | :------ | :-------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| id            | UUID    | PK                    |                                                                                                                                      |
| encounter_id  | UUID    | FK \-\> encounters.id | Links the medical note to the specific visit.                                                                                        |
| author_id     | UUID    | FK \-\> users.id      | **Accountability:** Exactly which Nurse or Doctor wrote this note.                                                                   |
| note_type     | ENUM    | NOT NULL              | 'Triage_Vitals', 'SOAP', 'Progress_Note', 'Discharge'.                                                                               |
| systolic_bp   | INTEGER |                       | **Strict Column:** Extracted from JSONB to allow for reporting/analytics (e.g., flagging hypertensive patients).                     |
| diastolic_bp  | INTEGER |                       | **Strict Column.**                                                                                                                   |
| heart_rate    | INTEGER |                       | **Strict Column.**                                                                                                                   |
| temperature_c | DECIMAL |                       | **Strict Column.**                                                                                                                   |
| weight_kg     | DECIMAL |                       | **Strict Column.**                                                                                                                   |
| content       | JSONB   |                       | Holds purely unstructured text or dynamic forms (e.g., {"chief_complaint": "Dog bite on right calf", "assessment": "Category III"}). |
| is_amended    | BOOLEAN | DEFAULT FALSE         | **Legal Compliance:** If a note is edited after saving, this flags it as amended.                                                    |

### **Table: clinical_orders (The Recall Engine & Master Ledger)**

| Column       | Type      | Constraints               | Context / Purpose                                                                                                                                      |
| :----------- | :-------- | :------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | UUID      | PK                        | Represents a single medical action or lab request.                                                                                                     |
| encounter_id | UUID      | FK \-\> encounters.id     | Nullable. Future (Pending) appointments do not have an active encounter yet.                                                                           |
| patient_id   | UUID      | FK \-\> patients.id       |                                                                                                                                                        |
| item_id      | UUID      | FK \-\> catalog_items.id  | What was ordered (e.g., "Dose 3 Speeda").                                                                                                              |
| status       | ENUM      | NOT NULL                  | **Recall/Lab Engine:** 'Pending', 'Sample_Collected', 'Sent_To_Partner', 'Results_Received', 'Completed', 'Missed', 'Cancelled'.                       |
| due_date     | DATE      |                           | **Ideal Date:** Calculated dynamically by the protocol intervals.                                                                                      |
| completed_at | TIMESTAMP |                           | **Actual Date:** Timestamp of administration.                                                                                                          |
| admin_by_id  | UUID      | FK \-\> users.id          | **Clinical Accountability:** The specific nurse who pushed the plunger or collected the sample (can be different from the provider_id who ordered it). |
| lot_id       | UUID      | FK \-\> inventory_lots.id | **Traceability:** Explicitly binds the injected dose to the physical batch.                                                                            |
| notes        | JSONB     |                           | Execution context ({"site": "Left Deltoid", "route": "ID"}).                                                                                           |

### **Table: diagnostic_results (Urgent Care Lab Routing)**

| Column         | Type      | Constraints                | Context / Purpose                                                     |
| :------------- | :-------- | :------------------------- | :-------------------------------------------------------------------- |
| id             | UUID      | PK                         |                                                                       |
| order_id       | UUID      | FK \-\> clinical_orders.id | Links the result back to the specific test request.                   |
| partner_lab_id | UUID      | FK \-\> payer_profiles.id  | Identifies which 3rd party processed the sample (e.g., Hi-Precision). |
| file_url       | VARCHAR   |                            | Cloud storage link (AWS S3) to the PDF result for patient download.   |
| released_at    | TIMESTAMP |                            | Audit: Exact timestamp when the result was forwarded to the patient.  |

## ---

**Domain 5: Inventory Traceability**

_Professional-grade Lot/Batch management ensuring First-Expired-First-Out (FEFO) dispensing._

### **Table: inventory_lots**

| Column      | Type    | Constraints              | Context / Purpose                                                          |
| :---------- | :------ | :----------------------- | :------------------------------------------------------------------------- |
| id          | UUID    | PK                       |                                                                            |
| item_id     | UUID    | FK \-\> catalog_items.id | Links to stockable goods.                                                  |
| branch_id   | UUID    | FK \-\> branches.id      | The physical location of the stock.                                        |
| batch_no    | VARCHAR | NOT NULL                 | The manufacturer's lot number.                                             |
| expiry_date | DATE    | NOT NULL                 | **FEFO Logic:** Enables auto-suggesting the oldest viable batch to nurses. |
| qty_on_hand | INTEGER | DEFAULT 0                | Real-time stock count for this specific batch.                             |

### **Table: inventory_txns (The Audit Trail)**

| Column       | Type    | Constraints               | Context / Purpose                                                                                                   |
| :----------- | :------ | :------------------------ | :------------------------------------------------------------------------------------------------------------------ |
| id           | UUID    | PK                        | Immutable ledger of every stock movement.                                                                           |
| lot_id       | UUID    | FK \-\> inventory_lots.id |                                                                                                                     |
| change_qty   | INTEGER | NOT NULL                  | Positive integer (Restock) or Negative integer (Dispense/Spoilage).                                                 |
| reason       | ENUM    | NOT NULL                  | 'Dispensed', 'Restock', 'Expired', 'Adjustment'.                                                                    |
| reference_id | UUID    |                           | Polymorphic FK: If 'Dispensed', this holds the clinical_orders.id to prove exactly which patient received the vial. |

## ---

**Domain 6: Billing & Accounts Receivable**

_Handles Split Payments, HMO charge accounts, and capturing Mandated Discount IDs for BIR compliance._

### **Table: transactions (The Invoice Header)**

| Column          | Type    | Constraints           | Context / Purpose                                                                                                              |
| :-------------- | :------ | :-------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| id              | UUID    | PK                    |                                                                                                                                |
| reference_no    | VARCHAR | UNIQUE                | Auto-generated human-readable ID (e.g., "CNT-2026-0001").                                                                      |
| encounter_id    | UUID    | FK \-\> encounters.id | Nullable. Allows retail transactions (e.g., buying dog food) without a full medical visit.                                     |
| patient_id      | UUID    | FK \-\> patients.id   |                                                                                                                                |
| total_gross     | DECIMAL | NOT NULL              | Sum of all items before discounts.                                                                                             |
| total_discount  | DECIMAL | DEFAULT 0             |                                                                                                                                |
| total_net       | DECIMAL | NOT NULL              | Final amount due.                                                                                                              |
| discount_ref_no | VARCHAR |                       | **BIR Compliance:** Captures the physical ID number (e.g., Senior Citizen ID, PWD ID) if a mandated discount tier was applied. |
| status          | ENUM    | NOT NULL              | 'Paid', 'Partial', 'Unpaid', 'Refunded'. Triggers Accounts Receivable (AR) reports.                                            |

### **Table: txn_items (The Line Items)**

| Column         | Type    | Constraints              | Context / Purpose                                                                                                                                            |
| :------------- | :------ | :----------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id             | UUID    | PK                       |                                                                                                                                                              |
| transaction_id | UUID    | FK \-\> transactions.id  |                                                                                                                                                              |
| item_id        | UUID    | FK \-\> catalog_items.id | What was sold/charged.                                                                                                                                       |
| qty            | INTEGER | DEFAULT 1                |                                                                                                                                                              |
| price_snapshot | DECIMAL | NOT NULL                 | **Historical Integrity:** Locks in the price at the moment of sale so past financial reports don't break if base_price or tier_prices are updated next year. |

### **Table: payments (The Split Ledger)**

| Column         | Type    | Constraints               | Context / Purpose                                                                                                                        |
| :------------- | :------ | :------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------- |
| id             | UUID    | PK                        |                                                                                                                                          |
| transaction_id | UUID    | FK \-\> transactions.id   |                                                                                                                                          |
| method         | ENUM    | NOT NULL                  | 'Cash', 'GCash', 'PayMongo', 'ChargeToAccount', 'BankTransfer'.                                                                          |
| amount         | DECIMAL | NOT NULL                  | **Blended Payment Scenario:** Allows a single P15,000 transaction to have two payment rows (e.g., P10,000 ChargeToAccount, P5,000 Cash). |
| payer_id       | UUID    | FK \-\> payer_profiles.id | **AR Link:** If the method is 'ChargeToAccount', this logs exactly _who_ owes the clinic the money (e.g., Maxicare).                     |
| external_ref   | VARCHAR |                           | Stores the GCash reference number or the HMO Letter of Authorization (LOA) number.                                                       |
