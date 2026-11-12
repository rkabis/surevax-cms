# SureVax CMS v2.0: AI Context Router

> **Last Updated**: 2026-08-23 (corporate billing, financial controls, Runtime Review Center, and revenue-integrity reporting) | **Total Files**: 7 | **Format**: Dense, structured, AI-optimized

> **2026-08-02 audit notice:** The React and Node stack rows were refreshed during the audit, but this context set still contains stale authentication and shipped-feature details. Treat it as a navigation aid, verify claims against current source and requirements, and see the [comprehensive audit](../audits/2026-08-02-comprehensive/INDEX.md) before making cross-cutting decisions.

---

## How to Use This Directory

This directory contains the **canonical AI context** for SureVax CMS v2.0. Each file is a self-contained module covering one domain. **Read only the files relevant to your current task** — do not load all 7 into context unless performing a cross-cutting architectural review.

---

## File Router

| #   | File                                                                 | Domain                      | Read When...                                                                                                                                              |
| --- | -------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00  | [00-SYSTEM-CORE.md](./00-SYSTEM-CORE.md)                             | **Architecture & Monorepo** | Setting up the project, understanding deployment model, monorepo structure, tech stack decisions, Phase 1 vs Phase 2 scope                                |
| 01  | [01-DATA-AND-COMPLIANCE.md](./01-DATA-AND-COMPLIANCE.md)             | **Data Model & Compliance** | Writing database migrations, implementing RLS, audit logging, handling Philippine DPA/BIR/PIDSR requirements, schema questions                            |
| 02  | [02-BACKEND-API.md](./02-BACKEND-API.md)                             | **Backend API & Security**  | Building Express.js routes, implementing authentication (HTTP-Only cookies), middleware, validation, error handling                                       |
| 03  | [03-FRONTEND-UI-UX.md](./03-FRONTEND-UI-UX.md)                       | **Frontend UI/UX**          | Building React components, implementing keyboard navigation, Shadcn/ui patterns, layout system, accessibility, forms                                      |
| 04  | [04-INFRASTRUCTURE-DEPLOYMENT.md](./04-INFRASTRUCTURE-DEPLOYMENT.md) | **DevOps & Infrastructure** | Deploying to Railway, configuring Cloudflare Pages, database networking, backups, CI/CD, scaling                                                          |
| 05  | [05-DEPENDENCY-POLICY.md](./05-DEPENDENCY-POLICY.md)                 | **Dependency Gatekeeper**   | Adding a new npm package, evaluating a library, deciding whether to wrap or use directly                                                                  |
| 06  | [06-PRODUCT-WORKFLOWS.md](./06-PRODUCT-WORKFLOWS.md)                 | **Clinical Workflows**      | Implementing patient intake, encounter flow, standing orders, scheduled-orders date recalc, billing, inventory lot selection, any clinical business logic |

---

## Task-to-File Quick Lookup

| Task                                         | Files to Read                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"Add a new API endpoint"**                 | `02-BACKEND-API.md` → `01-DATA-AND-COMPLIANCE.md` (if touching DB)                                                                                                                                                                                                                                  |
| **"Build a new page/component"**             | `03-FRONTEND-UI-UX.md` → `02-BACKEND-API.md` (for API contract)                                                                                                                                                                                                                                     |
| **"Add a new database table"**               | `01-DATA-AND-COMPLIANCE.md` → `00-SYSTEM-CORE.md` (for naming/structure conventions)                                                                                                                                                                                                                |
| **"Implement patient intake flow"**          | `06-PRODUCT-WORKFLOWS.md` → `01-DATA-AND-COMPLIANCE.md` → `02-BACKEND-API.md` → `03-FRONTEND-UI-UX.md`                                                                                                                                                                                              |
| **"Fix a deployment issue"**                 | `04-INFRASTRUCTURE-DEPLOYMENT.md`                                                                                                                                                                                                                                                                   |
| **"Should I use library X?"**                | `05-DEPENDENCY-POLICY.md`                                                                                                                                                                                                                                                                           |
| **"Implement scheduled-orders date recalc"** | `06-PRODUCT-WORKFLOWS.md` → `01-DATA-AND-COMPLIANCE.md`                                                                                                                                                                                                                                             |
| **"Handle compliance/audit"**                | `01-DATA-AND-COMPLIANCE.md`                                                                                                                                                                                                                                                                         |
| **"Migrate AppSheet/clinic data"**           | `../migration/appsheet/README.md` → `../migration/appsheet/SOURCE-MANIFEST.md` → `../migration/appsheet/PRE-CUTOVER-READINESS-2026-08-16.md` → `../migration/appsheet/INFERENCE-AND-MANUAL-REVIEW-POLICY.md` → `../migration/appsheet/EVIDENCE-AND-RECONCILIATION.md` → `01-DATA-AND-COMPLIANCE.md` |
| **"Understand the architecture"**            | `00-SYSTEM-CORE.md`                                                                                                                                                                                                                                                                                 |
| **"Implement authentication"**               | `02-BACKEND-API.md` → `04-INFRASTRUCTURE-DEPLOYMENT.md` (for cookie/CORS config)                                                                                                                                                                                                                    |
| **"Set up the monorepo"**                    | `00-SYSTEM-CORE.md` → `05-DEPENDENCY-POLICY.md`                                                                                                                                                                                                                                                     |
| **"Implement standing orders"**              | `06-PRODUCT-WORKFLOWS.md` → `01-DATA-AND-COMPLIANCE.md` (for schema)                                                                                                                                                                                                                                |
| **"BIR receipt / SC-PWD discount"**          | `01-DATA-AND-COMPLIANCE.md` (BIR section) → `06-PRODUCT-WORKFLOWS.md` (transaction step)                                                                                                                                                                                                            |
| **"Corporate / group billing"**              | `decisions/2026-08-22-corporate-group-billing-vertical-slice.md` → `01` → `02` → `03` → `06`                                                                                                                                                                                                        |
| **"Phase-1 billing controls"**               | `01-DATA-AND-COMPLIANCE.md` → `02-BACKEND-API.md` → `06-PRODUCT-WORKFLOWS.md`; live closeout in `../STATUS.md`                                                                                                                                                                                      |
| **"Extend the Runtime Review Center"**       | `06-PRODUCT-WORKFLOWS.md` → `02-BACKEND-API.md` → `01-DATA-AND-COMPLIANCE.md` → `03-FRONTEND-UI-UX.md`                                                                                                                                                                                              |
| **"Revenue / AR reports"**                   | `02-BACKEND-API.md` → `01-DATA-AND-COMPLIANCE.md` → `03-FRONTEND-UI-UX.md`; limits in `../handovers/2026-08-23-phase-1-revenue-integrity-reporting.md`                                                                                                                                              |

---

## Critical Cross-Cutting Rules

These rules appear across multiple files. Violating any of them is a **hard stop**.

1. **No localStorage JWTs** — Authentication uses HTTP-Only, Secure cookies only (`02`)
2. **No Vue/Radix-Vue** — Stack is React + Shadcn/ui (`03`)
3. **No Vercel** — Frontend deploys to Cloudflare Pages (`04`)
4. **No Supabase** — Railway Managed PostgreSQL (`00`, `04`)
5. **No wrapping React Query / RHF** — Use directly, only wrap infrastructure (`05`)
6. **RLS on every tenant-scoped table** — `tenant_id` + `SET LOCAL` in every transaction (`01`)
7. **Audit trail on every write** — `audit_logs` with before/after JSONB (`01`)
8. **Zod is the single source of truth** — Shared package validates frontend + backend (`00`, `01`, `02`)
9. **Nurse picks the brand at administer time** — the server never infers a dose's lot; the picker orders house-brand-first then earliest-expiry, and expired/quarantined lots are hard-stopped (`06`)
10. **BIR discount formula** — `(base_price / 1.12) * 0.20` for SC/PWD (`01`)

---

## Directory Rules

- **QUARANTINE**: The `archive/` directory at repo root is **off-limits**. It contains outdated schemas and decisions. Never read or reference it.
- **Self-Contained**: These 7 files are **fully self-contained**. They do **not** reference or depend on any other documentation in the repo. All information from the original source docs has been synthesized here.
- **Source of Truth**: These 7 files **supersede all other documentation** in the repo for implementation decisions. Original source docs should be moved to `archive/`.
- **Update Protocol**: When architectural decisions change, update the relevant file(s) here and bump the `Last Synthesized` date.

---

## Documents to Archive

The following root-level and reference documents have been **fully synthesized** into the files above and should be moved to `archive/` to prevent context pollution:

| Document                                                        | Synthesized Into       | Notes                                                             |
| --------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------- |
| `QUICK-START.md`                                                | `00`                   | **OUTDATED** — references Vercel, npm (not pnpm), sibling folders |
| `TECH-STACK-ROADMAP.md`                                         | `00`, `01`, `02`, `04` | Fully captured                                                    |
| `PROJECT-STRUCTURE.md`                                          | `_INDEX.md`, `00`      | Superseded by this router                                         |
| `database-schema-v4.md`                                         | `01`                   | Full schema + JSONB structures + SQL queries captured             |
| `SCHEMA-IMPROVEMENTS.md`                                        | `01`, `06`             | Bug fixes + future tables captured                                |
| `USER-STORIES.md`                                               | `06`                   | 42 stories summarized; critical workflows detailed                |
| `UI-DESIGN-GUIDE.md`                                            | `03`                   | **Vue references stripped**; fully translated to React            |
| `docs/policies/DEPLOYMENT-STRATEGY.md`                          | `04`                   | Fully captured                                                    |
| `docs/policies/DEPENDENCY-POLICY.md`                            | `05`                   | Fully captured                                                    |
| `references/Philippine Health Data Compliance Research.md`      | `01`                   | DPA/NPC/BIR/PIDSR rules captured                                  |
| `references/EMR Multi-Tenancy Database Design.md`               | `01`                   | Pool/Bridge/Silo + patterns captured                              |
| `references/Data Dictionary _ Schema.md`                        | `01`                   | Schema cross-refs captured                                        |
| `references/Project Proposal_ SureVax CMS (v2.0).md`            | `00`, `02`, `06`       | Vision + tech strategy captured                                   |
| `references/Project Proposal_ SureVax CMS (v2.0) Milestones.md` | `00`                   | Budget + phases captured                                          |
| `references/Clinic Workflow Case Study Research.md`             | `06`                   | Intake tiers + FSM + revenue leakage captured                     |

**Keep in active workspace** (not archived):

| Document                                                         | Reason                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `README.md`                                                      | Standard repo entry point — points to `docs/ai-context/`                                         |
| `TODO.md`                                                        | Stub; the live backlog moved to `docs/STATUS.md`                                                 |
| `docs/STATUS.md`                                                 | Live backlog: current state + open work (P0/P1/P2) + deferred items (single source)              |
| `docs/ROADMAP.md`                                                | Long-term roadmap (Phase 2 to 4 module expansion); key items captured in `06`                    |
| `docs/specs/surevax-cms-v2/requirements.md`                      | Canonical requirements spec for implementation scope and acceptance criteria                     |
| `docs/specs/schema-v2-redesign.md`                               | Full target schema for v2; authoritative reference for Phases 2–5 rewrites                       |
| `docs/specs/review-center-phase-1.md`                            | Runtime Review Center contract, safety boundary, and explicit next slices                        |
| `docs/handovers/archive/2026-05-01-schema-v2-phase1.md`          | Phase 1 shipped; Phases 2–5 plan, parallel-state pairs, per-module rewrite roadmap               |
| `docs/handovers/archive/2026-05-02-scheduled-orders-handover.md` | Deferred items from PR #76 and PR #75: Workstream B, consent NOT NULL fix, seed gap, query drift |
| `.cursor/rules/project-guidelines.mdc`                           | Active Cursor rule for project-wide AI guidance                                                  |
