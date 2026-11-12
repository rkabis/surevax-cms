# Database Schema Redesign Summary

## Overview

The database schema has been completely redesigned to treat **Standing Orders** as the primary abstraction for service delivery, while also supporting the clinic's expansion into lab-to-lab diagnostic services.

## Key Changes from Original Schema

### 1. Standing Orders as First-Class Citizens

**Before**: Bundles were simple groupings in `item_bundles` table
**After**: Three-tier hierarchy:

- `standing_order_templates` - Reusable clinical protocols (e.g., "Rabies PEP Category III")
- `patient_standing_orders` - Active protocol instances for specific patients
- `clinical_orders` - Individual services generated from standing orders

**Impact**:

- Physicians authorize once, nurses execute multiple times
- Protocols span multiple visits automatically
- Clear audit trail from template → patient enrollment → service execution
- Supports complex care pathways (4 ARV doses over 14 days, 2 tetanus shots over 30 days)

### 2. Service Polymorphism (Class-Table Inheritance)

**Before**: Flat `catalog_items` table with nullable columns
**After**: Polymorphic hierarchy:

- `service_catalog` - Base table (common attributes)
- `service_immunizations` - Vaccine-specific attributes (CVX code, dose volume, route)
- `service_laboratory` - Lab test attributes (LOINC code, specimen type, TAT)
- `service_goods` - Retail goods attributes (SKU, UPC, reorder levels)

**Impact**:

- Type-safe: Database enforces NOT NULL constraints on type-specific fields
- Extensible: Add new service types without modifying existing tables
- FHIR-aligned: Maps to FHIR PlanDefinition → ActivityDefinition pattern

### 3. Lab-to-Lab Service Support

**New Tables**:

- `lab_orders` - Extends clinical orders with specimen tracking
- `lab_results` - Individual test results within panels
- `partner_laboratories` - External lab relationships
- `standing_order_template_lab_panels` - Lab panel definitions

**Workflow Support**:

1. Sample drop-off → `status = 'In_Progress'`
2. Sample collected → `specimen_collected_at` recorded
3. Sent to partner → `sent_to_partner_at`, `partner_lab_id` set
4. Results received → `results_received_at`, `lab_results` populated
5. Released to patient → `results_released_at`, `status = 'Completed'`

**Impact**:

- Clear state machine for lab order lifecycle
- Supports both in-house and external lab processing
- Traceability via specimen barcodes
- Critical result flagging

### 4. Temporal Decoupling

**Before**: Orders required encounters to exist
**After**: `clinical_orders.encounter_id` is nullable

**Impact**:

- Future appointments exist without encounters
- Recall engine queries by `scheduled_date`, not encounter date
- SMS reminders sent before patient arrives
- No orphaned data when patients no-show

### 5. Enhanced Audit & Compliance

**New Tables**:

- `audit_logs` - Immutable audit trail for all operations
- `data_retention_policies` - Configurable retention periods
- `data_breach_incidents` - NPC compliance tracking
- `recall_schedules` - Explicit recall tracking
- `notifications` - SMS/email delivery audit

## Example: Rabies PEP Standing Order

### Day 0 - Initial Visit

1. Doctor activates "RABIES-PEP-CAT3" standing order template
2. System auto-generates 8 clinical orders:
   - Day 0: Consultation, Wound Cleaning, ARV Dose 1, ERIG, Tetanus (status='Pending')
   - Day 3: ARV Dose 2 (status='Pending', scheduled_date='2026-03-04')
   - Day 7: ARV Dose 3 (status='Pending', scheduled_date='2026-03-08')
   - Day 14: ARV Dose 4 (status='Pending', scheduled_date='2026-03-15')
3. Nurse administers Day 0 services (standing order authorization)
4. Inventory automatically deducted via FEFO
5. Transaction created

### Day 3, 7, 14 - Follow-up Visits

1. Recall engine identifies due order
2. SMS sent: "Your ARV Dose 2 is due today"
3. Patient arrives, nurse administers (no doctor needed)
4. Order status updated to 'Completed'
5. Inventory deducted, transaction created

### Result

- 1 standing order → 8 clinical orders → 4 encounters → 4 transactions
- Complete audit trail
- No manual date calculations
- Automatic SMS reminders

## Example: Lab-to-Lab CBC

### Sample Drop-off

1. Patient drops off sample
2. Lab tech creates clinical order for "Complete Blood Count"
3. Sample collected → `status = 'In_Progress'`
4. Specimen barcode generated
5. Sample sent to Hi-Precision → `sent_to_partner_at` recorded

### Results Received (2 days later)

1. Hi-Precision sends results via API
2. System creates `lab_results` records (WBC, RBC, Hemoglobin, etc.)
3. PDF uploaded to S3
4. SMS sent: "Your CBC results are ready"

### Results Released

1. Patient logs into portal or visits clinic
2. Staff releases results → `results_released_at` recorded
3. Order status updated to 'Completed'

## Migration Path

### Phase 1: Schema Creation

- Create new tables alongside existing schema
- Set up indexes and constraints
- Configure RLS policies

### Phase 2: Data Migration

- Migrate `catalog_items` → `service_catalog` + type-specific tables
- Convert `item_bundles` → `standing_order_templates`
- Migrate `clinical_orders` → new structure
- Create `lab_orders` from existing diagnostic data

### Phase 3: Application Updates

- Update API endpoints to use new schema
- Implement standing order workflows
- Add lab-to-lab service features
- Deploy recall engine enhancements

### Phase 4: Cutover

- Run parallel for validation period
- Switch to new schema
- Decommission old tables

## Performance Optimizations

### Critical Indexes

- `idx_clinical_orders_recall` - Recall engine queries
- `idx_inventory_lots_fefo` - FEFO inventory selection
- `idx_encounters_branch_date` - Branch isolation
- `idx_transactions_search` - Transaction lookups

### Partitioning

- `audit_logs` partitioned by month
- `transactions` partitioned by year
- Improves query performance and maintenance

### Materialized Views

- `mv_daily_patient_volume` - Daily statistics
- `mv_inventory_summary` - Stock levels
- Refreshed nightly

## Security Enhancements

### Row-Level Security

- Branch isolation enforced at database level
- SuperAdmin bypass for cross-branch reporting
- Defense-in-depth security

### Encryption

- Column-level encryption for sensitive fields
- API keys stored encrypted
- Integration with key management service

### Audit Triggers

- Automatic audit log population
- Captures before/after values
- Immutable audit trail

## Future Extensibility

### Chronic Disease Management

- Standing order templates for diabetes, hypertension, asthma
- Quarterly/annual monitoring protocols
- Integration with patient vitals history

### Wellness Programs

- Health screening packages
- Fitness assessments
- Wearable device integration

### Telemedicine

- Virtual encounters
- Remote monitoring data
- Video consultation logs

### Pharmacy Integration

- Prescription management
- Medication dispensing
- Inventory tracking for medications

## Benefits Summary

1. **Clinical Efficiency**: Standing orders reduce repetitive data entry and authorization overhead
2. **Service Flexibility**: Polymorphic design supports any service type (vaccines, labs, consultations, goods)
3. **Lab Expansion**: Full support for lab-to-lab diagnostic services with external partner integration
4. **Recall Automation**: Temporal decoupling enables robust recall engine with SMS notifications
5. **Audit Compliance**: Immutable audit trails for NPC, DOH, and BIR requirements
6. **Multi-Tenancy**: Strict branch isolation for security and scalability
7. **Future-Ready**: Clear extension points for chronic care, wellness, telemedicine, and pharmacy

## Files Created

- `database-schema-v2.md` - Complete schema documentation (50+ tables)
- `SCHEMA-REDESIGN-SUMMARY.md` - This summary document

## Next Steps

1. Review schema with clinical staff for workflow validation
2. Review with compliance officer for regulatory alignment
3. Create database migration scripts
4. Update API specifications to match new schema
5. Begin Phase 1 implementation
