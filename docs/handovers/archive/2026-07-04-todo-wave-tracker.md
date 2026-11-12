# SureVax CMS v2.0 — TODO

## Status Legend

- [ ] Not Started
- [~] In Progress
- [x] Completed

---

## Implementation Progress

### Infrastructure

- [x] Monorepo scaffolded (`apps/backend`, `apps/frontend`, `packages/shared`)
- [x] Railway project created — API service + Managed PG (Singapore)
- [x] Railway build config (`railpack.json`, `railway.toml`)
- [x] Environment variables set on Railway (DATABASE_URL, JWT_SECRET, COOKIE_SECRET, CORS_ORIGIN, NODE_ENV)
- [x] Full database schema applied to Railway (62 tables post Schema v2 Phase 1, all enums, indexes) — Phase 1 additive 22→62 shipped PR #77 (2026-05-02)
- [x] Supplemental SQL applied: 7 files (RLS, audit trigger, refresh-token RLS, branch canLogin, Phase 1 RLS/triggers, Phase 1 backfill, inventory trigger enable)
- [ ] Cloudflare Pages connected (frontend deploy)
- [ ] Custom domains configured (`api.surevax.com`, `app.surevax.com`)
- [ ] Cloudflare R2 bucket created + env vars set
- [ ] Railway spend cap set

### Backend

- [x] Express app wired up (`index.ts`) with middleware chain (helmet → cors → rate-limit → auth → tenant → validate)
- [x] API contract codegen — per-module `contract.ts` + `pnpm gen:contracts` + CI drift gate; 15 modules converted (PRs #558/#559, 2026-06-13); remaining modules convert on next touch
- [x] Auth module: login, logout, refresh token (HTTP-only cookies + bcrypt)
- [x] Tenant context middleware (reads session, calls `SET LOCAL` inside tx)
- [x] Patients module: CRUD + full-text search
- [x] Staff time logs module: clock-in/out, active shift
- [x] Dashboard module: aggregated stats, recent encounters, scheduled orders due, low stock
- [x] Inventory module: FEFO-sorted lots, search, filters, summary stats
- [x] Scheduled orders module: read (list/detail, timeline, recompute-preview, paymentStatus, ?filter=overdue) + write (administer — FEFO+consent+payment-gate; reschedule; recompute) — PR #74, #76 (2026-05-01/02)
- [x] Arrivals module: `GET /api/arrivals/preview-bundle` (read-only FEFO bundle), `POST /api/arrivals/atomic` (encounter+PSO in one transaction) — PR #75 (2026-05-02); wizard consolidation deferred
- [x] Transactions module: read (list/detail) + write (create, payments, void, refund, apply-prepayment) — 2026-04-26 (PR #57, #58, #59)
- [x] Admin modules: users, attendance, approvals (approve/reject), audit log
- [x] `/health` endpoint (required by Railway healthcheck)
- [x] Seed script (`db:seed`) with realistic test data for all tables
- [x] Encounters module: create, list, detail — PR batch 2026-04-25
- [x] Standing orders module: template list+detail, `POST /api/patient-standing-orders` (creates clinical_orders per Day-offset) — PR batch 2026-04-25
- [ ] Service catalog module: CRUD
- [x] Schema v2 Phases 1–4 shipped 2026-05-07; see `docs/handovers/archive/2026-05-01-schema-v2-phase1.md` for the original phased plan

### Frontend

- [x] Vite + React + Tailwind + Shadcn/ui scaffolded
- [x] Auth pages: login, logout
- [x] Patient registration + search
- [x] Dashboard page (stats, recent encounters, scheduled orders, low stock alerts)
- [x] Scheduled Orders page (grouped by date, search, filters)
- [x] Transactions: list + detail + `TransactionsCreatePage` (RHF + Zod cashier form, BIR OSCA/PWD discount preview); detail-drawer lifecycle dialogs (Add payment / Void / Refund / Apply prepayment); cross-feature mini-lists on patient + encounter detail — 2026-04-26
- [x] Billing / cashier flow (subsumes the line above; tracked here for the original "Billing / cashier flow" backlog item)
- [x] Inventory page (FEFO table, search, filters, summary stats)
- [x] Admin pages: users, attendance, approvals, audit log
- [x] Encounter intake flow — Arrivals wizard at `/arrivals` (Identify → Encounter + vitals + bite-assessment → Protocol → Done); PR batch 2026-04-25, Step 3 wired PR #75
- [x] Scheduled Orders page — administer / reschedule / recompute dialogs, timeline, payment-gate banner — PR #76 (2026-05-01)
- [~] Arrivals wizard atomic-commit consolidation — Step 2 must defer encounter creation so Step 3 calls `POST /api/arrivals/atomic`; endpoint ready, wizard unconsumed
- [ ] Standing order dashboard (template management, CRUD)

### Shared (`@surevax/shared`)

- [ ] Zod schemas for all domain entities (mirrors Drizzle schema)
- [ ] Shared TypeScript types exported

---

## 1. Requirements & Planning Documentation

### 1.1 Requirements Document

- [x] **Requirements Document** (`docs/specs/surevax-cms-v2/requirements.md`)
  - Comprehensive user stories with acceptance criteria
  - 30 detailed functional requirements
  - 20 correctness properties for validation
  - Glossary of domain terms

### 1.2 Design Document

- [ ] **System Design Document** (`docs/ai-context/00-SYSTEM-CORE.md`)
  - High-level system architecture
  - Component diagrams and interactions
  - Database schema design (already available in references)
  - API design and endpoints
  - Security architecture
  - Integration points (SMS, FHIR, payment gateways)
  - Technology stack justification

### 1.3 Implementation Tasks

- [ ] **Task Breakdown** (`TODO.md` phase sections + implementation checklist)
  - Detailed implementation tasks derived from requirements
  - Task dependencies and sequencing
  - Effort estimates
  - Phase 1, 2, 3 deliverable breakdown

---

## 2. Technical Architecture Documentation

### 2.1 Database Documentation

- [x] **Database Schema** (Available in `references/Data Dictionary _ Schema.md`)
  - Complete PostgreSQL schema
  - Table definitions with constraints
  - Relationships and foreign keys
  - Indexing strategy

- [ ] **Database Migration Plan**
  - Migration scripts structure
  - Data migration from AppSheet/Google Sheets
  - Validation and rollback procedures
  - Performance optimization strategy

### 2.2 API Documentation

- [ ] **API Specification**
  - RESTful API endpoint definitions
  - Request/response schemas
  - Authentication and authorization flows
  - Error handling standards
  - Rate limiting policies

- [ ] **FHIR Integration Guide**
  - FHIR resource mappings
  - Philippine Core FHIR IG compliance
  - NHDR integration endpoints
  - SCIV certification requirements

### 2.3 Security Documentation

- [ ] **Security Architecture Document**
  - Authentication mechanisms (JWT, OAuth)
  - Authorization model (RBAC implementation)
  - Encryption standards (AES-256 at rest, TLS in transit)
  - Data privacy controls (NPC compliance)
  - Audit logging strategy
  - Penetration testing plan

- [ ] **Data Privacy Compliance Guide**
  - NPC Circular 2023-06 implementation checklist
  - Privacy Impact Assessment (PIA)
  - Data breach response procedures
  - Consent management workflows
  - Data retention and destruction policies

---

## 3. Compliance & Regulatory Documentation

### 3.1 Philippine Regulatory Compliance

- [x] **Compliance Research** (Available in `references/Philippine Health Data Compliance Research.md`)
  - Data Privacy Act requirements
  - DOH EMR validation standards
  - BIR POS system requirements

- [ ] **SCIV Certification Roadmap**
  - SCIV toolkit requirements checklist
  - HL7 FHIR implementation plan
  - NHDR integration testing plan
  - PhilHealth reimbursement integration

- [ ] **PIDSR Integration Guide**
  - Notifiable disease mapping
  - Automated reporting workflows
  - ESU submission protocols

- [ ] **NaRIS Integration Guide**
  - ABTC data capture requirements
  - Animal bite registry structure
  - DOH submission formats

### 3.2 Financial Compliance

- [ ] **BIR POS Compliance Document**
  - RMO 24-2023 implementation checklist
  - Receipt format specifications
  - E-journal requirements
  - Senior Citizen/PWD discount algorithm
  - VAT calculation procedures
  - Audit trail requirements

---

## 4. Development Standards & Guidelines

### 4.1 Coding Standards

- [ ] **Frontend Development Guide**
  - React component structure
  - State management patterns (Redux/Context)
  - UI/UX design system
  - Accessibility standards
  - Code style guide (ESLint/Prettier config)

- [ ] **Backend Development Guide**
  - Node.js/Express project structure
  - API design patterns
  - Error handling conventions
  - Logging standards
  - Code style guide

- [ ] **Database Development Guide**
  - SQL coding standards
  - Migration script conventions
  - Query optimization guidelines
  - Transaction management patterns

### 4.2 Testing Documentation

- [ ] **Testing Strategy**
  - Unit testing approach (Jest)
  - Integration testing plan
  - End-to-end testing strategy (Cypress/Playwright)
  - Property-based testing for correctness properties
  - Performance testing benchmarks
  - Security testing procedures

- [ ] **Test Plan Document**
  - Test scenarios for each requirement
  - Test data preparation
  - Acceptance testing criteria
  - User acceptance testing (UAT) plan

---

## 5. Deployment & Operations Documentation

### 5.1 Infrastructure Documentation

- [ ] **Infrastructure Architecture**
  - Cloud provider: Railway (API + Managed PostgreSQL, Singapore region)
  - Frontend: Cloudflare Pages
  - Object storage: Cloudflare R2
  - CDN/WAF: Cloudflare (free tier)
  - Load balancing strategy (Phase 2+)

- [ ] **Deployment Guide**
  - CI/CD pipeline setup (GitHub Actions/GitLab CI)
  - Environment configurations (dev, staging, production)
  - Deployment procedures
  - Rollback procedures
  - Blue-green deployment strategy

### 5.2 Operations Documentation

- [ ] **Operations Manual**
  - System monitoring setup (Prometheus/Grafana)
  - Log aggregation (ELK stack)
  - Alerting rules
  - Incident response procedures
  - Backup and restore procedures
  - Disaster recovery plan

- [ ] **Performance Tuning Guide**
  - Database optimization techniques
  - Caching strategies (Redis)
  - Query optimization
  - API performance monitoring

---

## 6. User Documentation

### 6.1 User Manuals

- [ ] **Administrator Manual**
  - System configuration
  - User management
  - Branch setup
  - Service catalog management
  - Pricing tier configuration
  - Report generation

- [ ] **Clinical Staff Manual**
  - Patient registration
  - Encounter documentation
  - Immunization intake workflows
  - Service bundle usage
  - Standing order execution
  - Inventory management

- [ ] **Billing Staff Manual**
  - Transaction processing
  - Split payment handling
  - HMO billing procedures
  - Senior Citizen/PWD discount processing
  - Receipt generation
  - End-of-day reporting

- [ ] **Patient Portal User Guide**
  - Account creation
  - Viewing vaccination history
  - Downloading certificates
  - Appointment management

### 6.2 Training Materials

- [ ] **Training Curriculum**
  - Role-based training modules
  - Video tutorials
  - Quick reference guides
  - FAQ document

---

## 7. Integration Documentation

### 7.1 Third-Party Integrations

- [ ] **SMS Gateway Integration**
  - Twilio/Semaphore API integration
  - Message template management
  - Delivery tracking
  - Error handling

- [ ] **Payment Gateway Integration**
  - PayMongo integration guide
  - GCash/Maya integration
  - Transaction reconciliation
  - Refund procedures

- [ ] **Laboratory Integration**
  - Partner lab API specifications
  - Result upload procedures
  - Status tracking workflows

---

## 8. Migration Documentation

### 8.1 Data Migration

- [ ] **Migration Strategy Document**
  - Legacy system analysis (AppSheet/Google Sheets)
  - Data mapping specifications
  - Transformation rules
  - Validation procedures
  - Cutover plan
  - Rollback procedures

- [ ] **Migration Scripts**
  - Patient data migration
  - Immunization history migration
  - Transaction history migration
  - Inventory data migration

---

## 9. Quality Assurance Documentation

### 9.1 QA Processes

- [ ] **Quality Assurance Plan**
  - Code review procedures
  - Testing protocols
  - Bug tracking workflows
  - Release criteria

- [ ] **Acceptance Criteria Checklist**
  - Requirement validation matrix
  - Compliance verification checklist
  - Performance benchmarks
  - Security audit checklist

---

## 10. Project Management Documentation

### 10.1 Project Planning

- [ ] **Project Charter**
  - Project objectives
  - Stakeholder identification
  - Success criteria
  - Constraints and assumptions

- [ ] **Project Schedule**
  - Phase 1 timeline (Core functionality)
  - Phase 2 timeline (Automation features)
  - Phase 3 timeline (Migration)
  - Milestone definitions
  - Resource allocation

- [ ] **Risk Management Plan**
  - Risk identification
  - Risk mitigation strategies
  - Contingency plans

### 10.2 Communication Plan

- [ ] **Stakeholder Communication Plan**
  - Status reporting schedule
  - Meeting cadence
  - Escalation procedures
  - Change management process

---

## Priority Recommendations

### Critical Path (Must Complete Before Development)

1. ✅ Requirements Document (COMPLETED)
2. System Design Document
3. Database Migration Plan
4. API Specification
5. Security Architecture Document
6. Testing Strategy

### High Priority (Complete During Phase 1)

1. SCIV Certification Roadmap
2. BIR POS Compliance Document
3. Frontend/Backend Development Guides
4. Infrastructure Architecture
5. Deployment Guide

### Medium Priority (Complete During Phase 2)

1. User Manuals
2. Training Materials
3. Integration Documentation
4. Operations Manual
5. Migration Scripts

### Lower Priority (Complete Before Production)

1. Performance Tuning Guide
2. Patient Portal User Guide
3. Training Curriculum
4. Quality Assurance Plan

---

## Next Steps

1. Create the System Design Document to define technical architecture
2. Complete API Specification and Security Architecture
3. Develop Database Migration Plan and Testing Strategy
4. Create Development Guides and Infrastructure Architecture
5. Begin Phase 1 implementation with proper documentation in place

---

## Notes

- All documentation should be version-controlled in the project repository
- Documentation should be reviewed and updated regularly as the project evolves
- Compliance documentation should be reviewed by legal/regulatory experts
- User documentation should be validated with actual end-users before finalization
- Technical documentation should follow industry best practices and be accessible to the development team

---

## UI/UX Audit Fixes (2026-05-23)

> Tracks the prioritised fixes from [`docs/handovers/archive/2026-05-23-ui-audit-deep-dive.md`](docs/handovers/archive/2026-05-23-ui-audit-deep-dive.md).
> Role posture corrected mid-audit: Branch = intentional shared-clinic
> access, per-role gating deferred. Items below assume that posture.

### Wave 0 — Architecture decision (sign-off required)

- [x] ~~**Cross-branch PHI access model**~~ ✅ **Shipped 2026-06-03 (PR #531).**
      D1-D6 locked; RFC steps 2-10 implemented — RESTRICTIVE `branch_isolation`
      flip (default-closed), break-glass route + `BreakGlassReveal` modal,
      `/admin/cross-branch-access` review page, and a 4-scenario integration
      suite. - RFC: [`docs/specs/cross-branch-phi-access.md`](docs/specs/cross-branch-phi-access.md) - Handover (archived): [`docs/handovers/archive/2026-05-23-cross-branch-phi-rfc.md`](docs/handovers/archive/2026-05-23-cross-branch-phi-rfc.md)

### Wave 1 — Ship-blockers

- [x] ~~**Fix `/api/admin/notifications` 500 regression**~~ ✅ Fixed pre-Wave (PR #432 whitespace fix landed; verified live).
- [x] **Add `isActive = true` filter to `listServices`** so 32 hidden panel-constituent rows stop rendering. ✅ Shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447).
- [x] ~~**Fix Day Summary revenue accounting**~~ — verified intentional. `day_summary/db.ts:31` explicitly notes "Draft is included because the cashier intends to collect"; Voided/Refunded already excluded. Not a bug.
- [x] **`/initiate-protocol` strip dev copy** + `<PhysicianPicker>` dropdown. ✅ Shipped [#443](https://github.com/njvil/surevax-cms-revamp/pull/443).
- [x] **Fix Admin → Users "Active now" KPI** — relabelled to "Active accounts / enabled for login" (matches data). ✅ Shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447). Live-session count remains a follow-up.
- [x] **Wire Lab Orders "Sent out" KPI** — now derives count from `laboratoryName != null`. ✅ Shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447).
- [x] **Fix `PHP PHP 1,000.00` doubled prefix** in ApplyPrepaymentDialog. ✅ Shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447).
- [x] **Health card PDF** — pass `tenantName` from caller; drop `displayId` line. ✅ Shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447).
- [x] **Convert JSONB `<pre>` dumps to structured displays** in EncounterDetail / LabOrderDetail / AdverseEventDetail. ✅ Shipped [#444](https://github.com/njvil/surevax-cms-revamp/pull/444).
- [x] **Strip `Tenant ID` + `Row version` fields** from AppointmentDetail / NotificationDetail / ProductRecallDetail / AdverseEventDetail. ✅ Shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447) + [#444](https://github.com/njvil/surevax-cms-revamp/pull/444).
- [x] **AEFI report — add success toast**. ✅ Shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447).
- [~] **BIR receipt rebuild**: add TIN / PTU / accreditation header fields, VAT breakdown (even 0), single receipt number, cashier signature, dynamic footer, drop `[serviceType]` bracket, unify locale to `en-PH`. Both `AcknowledgementReceipt.tsx` and `escpos/receipt.ts`. **Largely shipped [#569](https://github.com/njvil/surevax-cms-revamp/pull/569)**: an explicit acknowledgement mode (not-an-OR disclaimer + manual-OR-on-request footer, misleading "OR No." line dropped), per-branch header values, and a data-only official-OR pivot (`branches.settings.receipt.bir`). Still open and gated on real registration values: VAT breakdown, explicit SC/PWD break-out, cashier signature, the single BIR-issued OR number, and `en-PH` locale.
- [ ] **Auto-close `BranchDayOpenPrompt`** when drawer opens externally (`apps/frontend/src/features/branch/components/BranchDayOpenPrompt.tsx`). _Still open._
- [x] **Seed PINs for test users** — `'1234'` bcrypt-hashed PIN now seeded for every user via `seedUsers(passwordHash, pinHash, branchId)`. ✅ Shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447).
- [x] **Fix `BranchDayBanner` "open since" time** — shows "no drawer open" when none, drawer's open time otherwise. ✅ Shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447).
- [x] **Drop `RequireNonBranch` gate** — verified removed pre-Wave (zero `RequireNonBranch` refs anywhere in `apps/frontend/src/`); was cleared in [#439](https://github.com/njvil/surevax-cms-revamp/pull/439).

#### Wave 1 (cont.) — added from 2026-05-23 Wave-10 E2E pass

- [x] ~~**B27 — Fix `<PatientPicker>` selection binding**~~ ✅ Verified — `selectPatient(p)` is bound at `PatientPicker.tsx:123` and correctly calls `onChange(p.id)`. Original audit finding stale by the time Wave 1 ran.
- [x] **B28 — Wire arrivals "04 Draft transaction" step OR remove it** — replaced "TXN draft will be created in next iteration" with "No items priced — protocol bundle empty". ✅ Shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447).
- [x] ~~**B29 — Conditional Bite Assessment**~~ ✅ Verified — `Step2Encounter.tsx:214` already gates `<BiteAssessmentPanel>` on `watchedSpecialty === 'Rabies'`. Stale finding.
- [x] **B30 — Fix "Day-0 ARV blocked" banner condition** — now gates on `/ARV/i.test(selectedTemplate.name)` in Step3Protocol. ✅ Shipped [#449](https://github.com/njvil/surevax-cms-revamp/pull/449). _TransactionsCreatePage's banner remains generic; separate UX decision._
- [x] **B31 — Remove "On commit · what writes" sidebar** from TransactionsCreatePage. ✅ Shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447).
- [x] **B32 — Service dropdown shows names not codes** — searchable combobox built (`<ServicePicker>`). ✅ Shipped [#465](https://github.com/njvil/surevax-cms-revamp/pull/465).
- [x] **B34 — Lab result Critical interpretation flow** — verified shipped per preview-walk handover. `hasCriticalValue` wired end-to-end (`features/lab-orders/api.ts:25-27` + `LabOrderDetail.tsx:112-149` + backend `lab_orders/db.ts:67`); acknowledge-critical 200 OK on `LBO_MFD72QB2`.
- [x] **B35 — TransactionsCreatePage `Save as draft` silent no-op** — verified already removed prior to Wave 6 (worker DEVIATION confirmed backend `createTransactionSchema` has no `status` field). No action needed.
- [x] **B36 — Currency formatter on line-row totals** — fallback path now uses `fmtMoney` consistently. ✅ Shipped [#449](https://github.com/njvil/surevax-cms-revamp/pull/449).
- [x] **B37 — Humanize `BankTransfer`** — `SelectItem` now renders "Bank Transfer". ✅ Shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447).
- [x] **B38 — Receipt page `.toLocaleString()` crash** — verified guarded at `AcknowledgementReceipt.tsx:129` (`{txn.branchSeq !== null && (...)`). The earlier crash site was the local `fmtMoney` helper (line ~23) which Worker D's currency PR removes. No remaining Radix dialog DOM-cleanup bug surfaced in current preview walk.
- [x] **B39 — `DirtyFormGuard` `beforeunload` scope** — verified already correctly gated on the `when` prop (callers pass `form.formState.isDirty`). No code change needed.
- [x] **B40 — Backend detail responses include resolved `createdBy` object** — `LEFT JOIN users` + `{ id, displayId, firstName, lastName }` projection across 10 modules. ✅ Shipped [#446](https://github.com/njvil/surevax-cms-revamp/pull/446). _(users module has no detail `db.ts`; backend worker reported DEVIATION.)_

### Wave 2 — Humanizer sweep (~0.5 day)

- [x] **Add `humanizeRole()` helper** + codemod ~25 humanizer leak sites. ✅ Shipped [#456](https://github.com/njvil/surevax-cms-revamp/pull/456).

### Wave 3 — ID hygiene + pickers (~1 day)

- [x] **Add `mrn` to frontend `Patient` type** so MRN search actually works. ✅ Shipped [#466](https://github.com/njvil/surevax-cms-revamp/pull/466).
- [x] **Build `<UserLabel>` + `<PatientLabel>` primitives**. ✅ Shipped [#450](https://github.com/njvil/surevax-cms-revamp/pull/450) (UserLabel) + [#459](https://github.com/njvil/surevax-cms-revamp/pull/459) (PatientLabel).
- [x] **`<PhysicianPicker>`, `<LotPicker>`, `<ServicePicker>` built**. ✅ Shipped [#443](https://github.com/njvil/surevax-cms-revamp/pull/443) (Physician) + [#465](https://github.com/njvil/surevax-cms-revamp/pull/465) (Service) + [#466](https://github.com/njvil/surevax-cms-revamp/pull/466) (Lot).
- [x] **Codemod raw display-ID leak sites** — verified clean in Patient/Encounter/Transactions/ClinicalOrders/AdverseEvents pages post Wave 1+2 cleanup.
- [x] **AppointmentDetail Participants** — verified resolved at `AppointmentDetail.tsx:155-179` via flat `patientFirstName` / `providerName` / `branchName` / `cancelledByName` projections; raw IDs only surface as fallback when the joined record is null. Acceptable UX. (Worker E DEVIATION in [#470](https://github.com/njvil/surevax-cms-revamp/pull/470) confirmed this.)
- [x] **Refactor `audit/routes.ts:mapMessage`** — `/api/audit/recent` now returns structured `{actor, action, entityType, entityId, message}` alongside legacy message. ✅ Shipped [#466](https://github.com/njvil/surevax-cms-revamp/pull/466). _Worker DEVIATION: admin AuditPage already structured, instead refactored dashboard timeline consumer._
- [x] **Resolve `createdById` to user name** in 10 detail drawers (TransactionDetail, LabOrderDetail, InventoryDetail, ServiceDetail, PayerProfileDetail, PartnerLabDetail, NotificationDetail, ProductRecallDetail, AttendanceDetail, StandingOrderDetail). Backend B40 [#446](https://github.com/njvil/surevax-cms-revamp/pull/446) + frontend [#450](https://github.com/njvil/surevax-cms-revamp/pull/450) via `<UserLabel>`. ✅ Shipped. _UserDetail skipped — no `users/db.ts` module exists._

### Wave 4 — Currency consolidation (~0.5 day)

- [x] **Kill `₱{x}` raw concat sites + unify drawer-dialog labels + remove local `fmtMoney`** — done in [#471](https://github.com/njvil/surevax-cms-revamp/pull/471). DEVIATION: kept `₱` symbol on TenderRail denomination buttons (`+₱500`, etc.) and Step3Protocol "Unit ₱" column header — those are intentional UI symbol labels, not concatenated computed values.
- [ ] **Full `@/shared/lib/format` → `@/lib/format` module consolidation** — DEFERRED to its own design PR. The two modules have DIFFERENT semantics for `formatDate` (relative vs locale), `formatDateTime` (ISO vs locale), `formatMoney` (PHP-prefixed vs raw). Naive codemod would silently regress every list page and detail drawer. Per `.claude/rules/design-system.md`, existing `@/shared/lib/format` call sites stay until the consolidation PR.

### Wave 5 — Receipts + BIR (~1 day, needs ops sign-off)

> **Update 2026-06-20 ([#569](https://github.com/njvil/surevax-cms-revamp/pull/569)):** the receipt now runs in an explicit **acknowledgement** mode (not-an-OR disclaimer + manual-OR-on-request footer, misleading "OR No." line dropped) with **per-branch header values**, plus a **data-only official-OR pivot** (populate `branches.settings.receipt.bir` to flip a branch to official mode with no code change). The line items below (VAT breakdown, explicit SC/PWD break-out, cashier signature, single BIR-issued OR number, `en-PH` locale) are still open and gated on real registration values.

- [ ] **BIR header block** — TIN, PTU/ATP, accreditation, OR series range (waiting on real values).
- [ ] **VAT breakdown** — Vatable Sales / VAT Amount / VAT-Exempt / Zero-Rated, render at 0 not conditional.
- [ ] **SC/PWD 20% discount** broken out explicitly with VAT-exclusive base.
- [ ] **Cashier name + signature lines** on HTML receipt.
- [ ] **Single receipt number** — drop synthetic `buildReceiptNumber`, surface only the BIR-issued `orNumber`.
- [ ] **Drop `[serviceType]` bracket annotation** from both receipt formats.
- [ ] **Dynamic footer** — replace hardcoded `"for vaccination services received"` with derived text based on `txn.items` serviceTypes.
- [ ] **Unify receipt locale** to `en-PH` in ESC/POS (currently `en-US`).
- [ ] **Switch HTML receipt date** from `formatDate(...)` (relative) to `formatDateTime` (fixed format).

### Wave 6 — Dialogs polish (~0.5 day)

- [x] **Sentence-case dialog titles + Cancel label codemod + DialogDescription a11y + operational verb rewrites + required-marker wrap + ComingSoonButton tooltip cleanup**. ✅ Shipped [#460](https://github.com/njvil/surevax-cms-revamp/pull/460) + [#461](https://github.com/njvil/surevax-cms-revamp/pull/461).

### Wave 7 — Form validation copy (~0.5 day)

- [x] **Humanize shared Zod messages + reconcile patient schema parity** (`sex` + `dateOfBirth` now consistent). ✅ Shipped [#463](https://github.com/njvil/surevax-cms-revamp/pull/463).
- [x] **Vitals errors with clinical context** — typical-range hints in `encounterVitalsSchema`. ✅ Shipped pre-Wave 6.
- [x] **Rewrite backend Zod messages** — sentence-case across appointments, service_catalog, scheduled_orders, product_recalls. ✅ Shipped [#467](https://github.com/njvil/surevax-cms-revamp/pull/467). Earlier sites (cash_drawer, bite_incidents, attachments, payer_profiles) already humanized pre-Wave 6.
- [x] **`'Please try again.'` fallback** — ClockInModal, ClockInBanner, BranchKiosk now pipe `apiErrorMessage(err)` ([#467](https://github.com/njvil/surevax-cms-revamp/pull/467)). Verified `PatientForm:286/300` + `EncounterForm:106` already use `apiErrorMessage(err)` (stale TODO entry).
- [ ] **Rename or split `loginSchema`** in `packages/shared/src/schemas/auth.ts` — `loginSchema` shape is fine (min(1) on password). Registration sibling exists as separate schema at line 21. _Open if stricter rename desired; otherwise close as stale._
- [x] **Expand acronyms inline** — FAT in RecordOutcomeDialog and VIS in AdministerDialog both already wired via `<AcronymHint>`. Registry also carries entries for both. Verified live.

### Wave 8 — Nav + chrome (~0.5 day)

- [x] **AppShell branch label** — now reads `user?.branchCode ?? '—'` dynamically (was `"QC-01 · Quezon City"`).
- [x] **TransactionsPage drawer label, BranchKiosk brand string** — verified dynamic in code (stale TODO entries).
- [x] **Add `/clinical-orders` + `/bite-incidents` to Records sidebar nav + stub pages replaced with "Coming in Phase X" shell**. ✅ Shipped [#470](https://github.com/njvil/surevax-cms-revamp/pull/470).
- [x] **Remove "(coming soon)" from Cmd+K shortcut description** — shipped in [#464](https://github.com/njvil/surevax-cms-revamp/pull/464) per preview-walk handover B53.
- [ ] **Replace hardcoded `SVX`** in `BranchesPage.tsx:91` KPI cell. _Deferred — Phase 1 is single-tenant SVX; not urgent until Phase 2 onboarding._
- [x] **Pull receipt clinic info from API** instead of the `CLINIC` constant. ✅ Shipped [#569](https://github.com/njvil/surevax-cms-revamp/pull/569): `receiptClinic.ts`'s `buildClinicInfo(txn, user)` sources the branch of sale (new `branch` object on the txn-detail payload), falling back to the viewer's branch then the SureVax brand; the hardcoded `CLINIC` constant is removed.

### Wave 9 — Branch / kiosk specific

- [x] **Rename `PinKeypadDialog` to `PinEntryDialog`**. ✅ Shipped [#470](https://github.com/njvil/surevax-cms-revamp/pull/470). On-screen numeric keypad deferred to a future kiosk-hardware trial.
- [x] **Day Summary "Snapshot day" → "Close day"**. ✅ Shipped Wave 6 dialog polish in [#460](https://github.com/njvil/surevax-cms-revamp/pull/460).
- [ ] **Replace "Branch session" header with "Clinic day"** — wording sweep; minor copy-only.
- [ ] **Decide kiosk layout** — keep current full-AppShell behavior unless a chromeless-kiosk use case emerges. _Defer until ops calls it out._

### Wave 10 — E2E verification pass (2026-05-23 — items shipped vs blocked)

The Wave 10 E2E pass ran 2026-05-23 against the seeded dev DB. Items
below are tagged with what was confirmed working vs what stayed
blocked. New ship-blockers surfaced by this pass (B27-B40) live in the
Wave 1 (cont.) section above. Full report in
[`docs/handovers/archive/2026-05-23-ui-audit-deep-dive.md`](docs/handovers/archive/2026-05-23-ui-audit-deep-dive.md)
§"Wave 10 — E2E verification pass".

- [x] Patient register form filled + submitted + appears in list — `PAT_A1CWVKJW` created end-to-end
- [x] Arrivals wizard for non-Rabies specialty (Flu) — `ENC_BJVRA8PD` + `PSO_X3DZ3HVX` created; exposed B28/B29/B30
- [x] Void existing paid txn — `TXN_TCTXZ83D` voided
- [x] Refund existing paid txn — `TXN_0ACPV3TH` refunded
- [x] Lab order Mark Sent — `LBO_JDAMS5QY` transitioned to Sent
- [x] Day Summary "Snapshot day" confirm dialog reached (not actually fired — would mark live day closed)
- [x] Variance copy source-confirmed (signed `formatPhpAmount`, red/green color only, no "Over"/"Short" word)

### Wave 11 — Verification still uncovered (data seeding needed)

These need either Wave 1 fixes to land first OR new seed data before
they're verifiable. Renumbered from prior "Wave 10" list with
already-completed items removed.

- [ ] Bite incident new + 14-day outcome — blocked by **B27** (PatientPicker)
- [ ] AEFI new report — blocked by **B27**
- [ ] Lab result Save with Critical interpretation — blocked by **B34**
- [ ] Lab result with non-critical interpretation
- [ ] Critical-value acknowledge flow
- [ ] Upload Result PDF (with a real file)
- [ ] Apply prepayment to a draft (verifies the `PHP PHP` fix [#447](https://github.com/njvil/surevax-cms-revamp/pull/447)) — needs prepayment-state TXN in seed
- [ ] Full transaction commit with payment recorded — blocked by currency input rejecting programmatic value-set; needs keyboard-driven test or a Playwright pass
- [ ] Each payment method exercised (Cash / GCash / Maya / Card / HMO / Corporate)
- [ ] BIR senior/PWD discount applied to a real receipt
- [ ] Cash drawer close with a counted total (variance over/short scenario)
- [ ] Day Summary "Close day" actually fired (will mark today closed — defer to staging)
- [ ] Inventory transfer ship → confirm receipt — second branch needed in seed
- [ ] Inventory adjust / quarantine lot — no UI path exists, needs Wave 1 wiring first
- [ ] Standing-order template version bump
- [ ] External-dose append
- [ ] Notification template create + dry-run + actual send — _B27 PatientPicker verified working in Wave 1; re-test E2E._
- [ ] Approval request approve / reject — seed has zero approvals
- [ ] Cross-midnight kiosk day-rollover (advance system clock or seed yesterday's drawer)
- [ ] Recall affecting an existing lot (seed a recall row)
- [ ] Health card PDF visual inspection (multi-tenant: `tenantName` now passes from `tenants.name` per [#447](https://github.com/njvil/surevax-cms-revamp/pull/447); visual confirmation still pending)
- [ ] WHO categories I and III variants of arrivals wizard
- [ ] Edit patient + add allergy + add condition inline
- [ ] Mobile / tablet viewport (kiosk is presumably tablet-sized — 768px / 1024px)
- [ ] Dark mode
- [ ] Tagalog `fil-PH` UI swap
- [ ] Keyboard nav / focus order / focus trap on dialogs
- [ ] axe-core a11y scan + color contrast
- [ ] Empty states on each list (re-seed with no data per resource)
- [ ] Loading skeleton rendering (throttle network)
- [ ] ErrorBoundary fallback (force a render error)
- [ ] 404 page copy visual
- [ ] Tooltip copy on every `<AcronymHint>` (FEFO, PEP, PrEP, WHO, VIS, FAT, PRC, etc.)
- [ ] `row_version` conflict (open same record in two tabs, edit both)
- [ ] Refresh-token rotation in a long-running kiosk session (>15min idle)

### Wave 11 — Seed data needed for full QA

- [x] Default 4-digit PIN seeded on all test users (`'1234'` bcrypt-hashed). ✅ Shipped [#447](https://github.com/njvil/surevax-cms-revamp/pull/447).
- [ ] At least one prepayment-state transaction (verifies the `PHP PHP` fix)
- [ ] At least one notification template (verifies dry-run + actual send)
- [ ] At least one pending approval request
- [ ] At least one product recall affecting a current lot
- [ ] A second branch (verifies inventory-transfer flow + the multi-tenant chrome assumptions)
- [ ] A lab order with `criticalValue=true` flag (verifies critical-value ack flow once B34 lands)

### Wave 12 — Format module consolidation (Phase B + C) — shipped 2026-05-24

Closes the long-deferred `@/lib/format` vs `@/shared/lib/format` split.
Phase A (canonical helpers) shipped in Wave 9 [#477](https://github.com/njvil/surevax-cms-revamp/pull/477). Phase B + C landed
together in one PR (single worktree, 7 commits — 6 batch commits + Phase C
cleanup) since the per-call-site diff was mechanical (~130 LoC across 38 callers).

- [x] **Phase B — migrate all 38 callers off `@/shared/lib/format`** across 6 batches: patients/encounters/appointments; transactions/receipts; clinical-orders/scheduled-orders/arrivals/standing-orders; lab-orders; inventory; admin/branch/dashboard/day-summary/services.
- [x] **Phase C — delete `apps/frontend/src/shared/lib/format.ts`** and update `.claude/rules/design-system.md` "two modules exist" warning with the canonical helper table.
- [x] **UX shifts (intended per spec):** money everywhere now renders with `₱` peso symbol (was `PHP` prefix on some surfaces); receipts use `formatLongDate` instead of relative `formatDate`; detail-rail metadata timestamps now ISO `2026-05-24 15:45` (was locale `May 24, 2026, 03:45 PM`); narrative timestamps (dialog descriptions, Snapshotted/Generated captions, encounter timeline) use `formatLongDateTime` to preserve readability.

Spec preserved at [`docs/specs/format-module-consolidation.md`](docs/specs/format-module-consolidation.md) as historical record.

---

**Document Version**: 2.0
**Last Updated**: July 4, 2026 (reconcile with post-2026-06-13 commits)
**Maintained By**: Project Team

### Changelog

- 2.0 (2026-07-04): Reconciled with commits since 2026-06-13. Acknowledgement receipts + data-only BIR pivot ([#569](https://github.com/njvil/surevax-cms-revamp/pull/569)) largely close the Wave 1 / Wave 5 BIR receipt rebuild and fully close the Wave 8 "receipt clinic info from API" item; multi-patient family billing shipped ([#570](https://github.com/njvil/surevax-cms-revamp/pull/570)); the contract-codegen drift follow-ups + the dose-calc `resolveDoseRule` fix landed 2026-06-14. Canonical live backlog stays [`docs/handovers/2026-06-04-state-of-the-art.md`](docs/handovers/2026-06-04-state-of-the-art.md).
- 1.9 (2026-05-24) — Wave 10 (format Phase B + C): migrated all 38 callers off `@/shared/lib/format` across 6 batches in one PR; deleted legacy module; replaced `.claude/rules/design-system.md` "two modules exist" warning with canonical helper table covering `formatDate` / `formatLongDate` / `formatDateTime` / `formatLongDateTime` / `formatTime` / `formatMoney` (₱) / `formatNumber`. Coordinator did the work inline rather than spawning 6 parallel workers — the mechanical per-call-site diff didn't earn the orchestrate boot tax (~7k tokens × 6 workers).
- 1.7 (2026-05-24) — Wave 7 orchestration: Worker D currency polish (#471), Worker E a11y+chrome bundle (#470 — B47/B49/B52 + PinEntryDialog rename + nav additions + stub pages Coming-in-Phase-X), inline Edit Patient silent-drop fix + B34/B38/apiErrorMessage stale verification (#469). FAT+VIS AcronymHint verified already shipped (consumer sites + registry both wired pre-Wave 7). AppointmentDetail Participants verified resolved via flat name projections — raw-ID fallback only surfaces when the joined record is null. Full `@/shared/lib/format` consolidation deferred to its own design PR (the two modules have incompatible semantics).
- 1.6 (2026-05-24) — Wave 7 inline batch: B34 lab Critical + B38 receipt crash guard verified shipped; Edit Patient Allergies/Conditions chips now hidden in edit mode (silent-drop fix); PatientForm/EncounterForm `apiErrorMessage` TODO entry verified stale.
- 1.5 (2026-05-24) — Wave 6 doc sweep: B32 ServicePicker shipped (#465), Wave 3 ID hygiene closed via LotPicker + audit structured fields (#466), inline Batch 1 closed H4 Helmet + Wave 7 backend Zod + apiErrorMessage shift/kiosk (#467). Verified-stale items: B35 already removed pre-Wave, B39 DirtyFormGuard already correct, BranchDayOpenPrompt auto-close already shipped, Waves 2+6 fully closed in prior orchestrations.
- 1.4 (2026-05-23) — Wave 1 + Wave 2 doc sweep: Wave 1 ship-blockers (16/17 closed; BIR receipt blocked on ops), Wave 1 (cont.) E2E follow-ups (8/13 closed), Wave 3 ID hygiene (`<UserLabel>` + `<PhysicianPicker>` shipped, createdBy resolved in 10 drawers).
- 1.3 (2026-05-23) — Wave 10 E2E verification pass; added B27-B40 ship-blockers.
