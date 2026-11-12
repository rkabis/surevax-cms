# Requirements Document: SureVax Clinic Management System v2.0

> **Status**: Active Cursor-native requirements spec  
> **Canonical implementation context**: `docs/ai-context/06-PRODUCT-WORKFLOWS.md`

## Introduction

SureVax CMS v2.0 is a web-based clinic management system for Animal Bite Treatment Centers (ABTCs) in the Philippines. It replaces the legacy AppSheet/Google Sheets setup with a scalable React/Node/PostgreSQL architecture while preserving operational workflows and improving data integrity, compliance, and throughput.

This document defines the product requirements baseline used for implementation planning and validation.

## Scope

- Multi-branch operations with strict branch isolation
- Clinical encounter workflows for rabies PEP and related services
- Automated scheduling and date recalculation for multi-day protocols
- Billing, inventory, and regulatory compliance workflows
- Security, auditability, interoperability, and operations controls

## Functional Requirements

### FR-01 to FR-05: Intake and Encounter Foundations

1. Enforce branch-scoped data access with role-based controls and auditable cross-branch exceptions.
2. Maintain a Master Patient Index with duplicate detection, fuzzy search,
   required guardian/emergency data rules, and a branch-scoped operational
   worklist for incomplete guardian records.
3. Create encounter records with structured vitals and amend-tracking for edited notes.
4. Support single immunization intake with nurse accountability, lot traceability, and expired-lot hard stops.
5. Support service bundle intake that atomically creates encounter-linked orders, billing context, and future protocol scheduling.

### FR-06 to FR-10: Scheduled Orders, Standing Orders, and Billing Mechanics

6. Operate a clinical-order scheduling state machine (Pending/Due/Overdue/Completed with terminal closures) with dynamic date recalculation after late doses.
7. Support standing orders for nurse-administered follow-up doses with valid physician authorization chain.
8. Maintain a polymorphic service catalog (services, goods, diagnostics, bundles) with non-retroactive pricing behavior.
9. Apply dynamic pricing rules for HMO and mandated discounts, including SC/PWD VAT-first discount computation.
10. Support split payments across channels with exact transaction-balance validation.

### FR-11 to FR-15: Receipts, Inventory, and Branch Operations

11. Generate BIR-compliant receipts with immutable numbering, discount detail, and transaction journaling.
12. Enforce FEFO inventory lot selection with atomic deductions tied to clinical execution.
13. Provide lot-level traceability for product-recall events and rapid affected-patient reporting.
14. Support nurse shift timekeeping with anomaly flagging and auditable closeout.
15. Produce end-of-day branch reporting with payment-method breakdowns,
    discount totals, reconciliation metrics, and current-state carry-over
    exceptions requiring accountable follow-up.

**FR-15 implementation status (PR #618, 2026-08-23): partial.** The Phase-1
reporting MVP supplies one-branch/day transaction-net, payment-method, drawer,
deposit, and reconciliation facts using existing day-summary truth. The total is
named `transactionNetTotal` because no accounting-recognition event exists; it
must not be presented as recognized revenue. First-class discount totals and an
owner-approved recognition definition remain open, so FR-15 is not marked fully
complete. See the
[implementation and decision record](../../handovers/2026-08-23-phase-1-revenue-integrity-reporting.md)
and the
[reporting next-step register](../../STATUS.md#revenue-integrity-reporting-next-step-register).

### FR-16 to FR-20: Privacy, Reporting, and Records Governance

16. Implement Data Privacy Act controls including encryption at rest/in transit, RBAC, logging, and retention enforcement.
17. Support incident tracking and outputs needed for 72-hour breach notification workflows.
18. Support PIDSR notifiable disease reporting triggers and submission logs.
19. Support NaRIS-aligned animal bite registry capture and export.
20. Enforce medical record retention and cryptographic destruction policies by record class.

### FR-21 to FR-25: Interoperability and Patient Access

21. Support HL7 FHIR resources and API integration required for interoperability programs.
22. Enforce secure authentication/session controls (lockout, timeout, reset, MFA for privileged roles).
23. Maintain immutable, complete audit trails for critical create/read/update/delete operations.
24. Support diagnostic order lifecycle and secure result-file linkage to patient records.
25. Provide patient portal capabilities for vaccination history, certificates, and appointment interactions.

### FR-26 to FR-30: Messaging, Migration, and Platform Reliability

26. Integrate SMS reminders/overdue notices with template support, delivery logs, and idempotent behavior.
27. Provide migration tooling for AppSheet/Google Sheets historical data with validation and error reporting.
28. Meet baseline performance targets for concurrency, search latency, bundle expansion, and API p95.
29. Provide encrypted backup, retention, and disaster recovery procedures with documented RTO/RPO.
30. Provide administrative configuration for branch/catalog/pricing/protocol/notification settings with change logging.

## Workflow-Critical Policies

- Nurse-initiated standing-order actions require physician authorization linkage.
- Preventive-vaccine workflows require either consult authorization or external prescription reference.
- ERIG/HRIG quantity must be weight-based and auditable when overridden.
- Break-glass cross-branch access must be time-limited, critically logged, and manager-reviewed.

## Correctness Properties

The system must preserve these invariants:

1. Branch isolation for non-superadmin access
2. Financial balance: sum(payments) equals transaction net
3. Atomic clinical + inventory deductions
4. Consistent protocol date recalculation
5. Exact SC/PWD VAT-strip then discount formula
6. FEFO lot selection
7. Audit log immutability
8. Encryption at rest for sensitive data
9. Session timeout enforcement
10. FHIR round-trip integrity
11. Standing-order authorization chain
12. Valid clinical-order scheduling FSM transitions only
13. Duplicate payment prevention
14. Expired lot administration hard-stop
15. Cross-branch encounter policy enforcement
16. Consent retention alignment
17. Price snapshot immutability
18. Bundle all-or-nothing atomicity
19. Notification idempotency
20. Audit completeness for critical operations
21. Mandatory physician linkage for nurse protocol execution
22. Weight-based RIG dosing consistency
23. ID/IM inventory consistency for fractional usage
24. Terminal scheduling closure (Defaulted/Transferred) must halt automated reminders
25. Break-glass critical audit + acknowledgment chain
26. Cash drawer close integrity and discrepancy logging
27. Preventive workflow hard-stop without authorization evidence

## Source Alignment

- Product workflow source: `docs/ai-context/06-PRODUCT-WORKFLOWS.md`
- Runtime Review Center: `docs/specs/review-center-phase-1.md`
- Core architecture context: `docs/ai-context/00-SYSTEM-CORE.md`
- Data/compliance context: `docs/ai-context/01-DATA-AND-COMPLIANCE.md`
