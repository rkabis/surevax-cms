# 00 — System Core & Architecture

> **Last Synthesized**: 2026-03-22 | **Self-contained** — synthesized from now-archived source docs | **Updated**: 2026-08-23 (Runtime Review Center feature boundary and documentation ownership; PR #616 pending merge)

## Product & Phases

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Product**       | **SureVax CMS v2.0**                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Status**        | **G2 complete + G3 in progress** — full intake flow live: patient registration with duplicate-detect, encounter creation, vitals + bite-assessment capture, standing-order initiation, nurse arrival wizard at `/arrivals`. Inventory deduction and clinical-order completion shipped in PR #76 (the dose lot became a required, nurse-picked argument 2026-07-25); the scheduled-orders SMS/job runner remains for G3 close-out. |
| **Phase 1 (MVP)** | **Single clinic** deployment; **single-tenant** runtime                                                                                                                                                                                                                                                                                                                                                                           |
| **Phase 2**       | **Multi-tenant SaaS**; schema & RLS already aligned                                                                                                                                                                                                                                                                                                                                                                               |
| **Delivery**      | **Phased** — see gates below                                                                                                                                                                                                                                                                                                                                                                                                      |

### Phase 1 — Runtime & Stack

| Layer                        | Choice                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**                 | **React 19**, **TypeScript**, **Vite**, **TanStack Query**, **React Hook Form**, **Zod**, **Tailwind CSS**, **Shadcn/ui**       |
| **Pivot**                    | **FROM Vue TO React**. Treat **Vue** as deprecated for this codebase                                                            |
| **Backend**                  | **Node.js 22 LTS**, **Express.js**                                                                                              |
| **Data**                     | **PostgreSQL 15+**, **Drizzle ORM**, **HTTP-Only Secure Cookies + Refresh Tokens (No stateless localStorage JWTs)**, **bcrypt** |
| **Schema validation**        | **Zod** is the **single source of truth** for schemas (shared package)                                                          |
| **Dependency target (core)** | **13 core packages** (see root README / dependency policy)                                                                      |

### Phase 2 — Tenant & Billing

| Addition        | Notes                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------- |
| **`tenant_id`** | On **all** tenant-scoped tables (present from **Day 1** in schema; **hardcoded** in Phase 1) |
| **Middleware**  | **Tenant resolution** from subdomain / **JWT** (replaces hardcoded tenant in Phase 2)        |
| **Queries**     | Align with **RLS** + **tenant_id**                                                           |
| **Billing**     | Add when going multi-tenant                                                                  |

---

## Non-Negotiable Platform Decisions

| Decision             | Choice                                                                                                                     | Rejected / Avoid                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Database hosting** | **Cloud-provider managed PostgreSQL** (Day 1; e.g., **DigitalOcean Managed DB** / **AWS RDS**; **not** on the Hetzner VPS) | **Supabase** as primary platform                    |
| **Frontend hosting** | **Cloudflare Pages** (free tier acceptable)                                                                                | **Vercel** free tier — **commercial use violation** |
| **Backend hosting**  | **Railway** (Singapore region)                                                                                             | Hetzner VPS, self-managed Docker                    |
| **Database hosting** | **Railway Managed PostgreSQL** (Singapore region)                                                                          | Self-hosted DB on raw VPS                           |
| **ORM**              | **Drizzle ORM**                                                                                                            | Ad-hoc SQL without typed layer                      |
| **API style**        | **REST** over **Express.js**                                                                                               | —                                                   |
| **Monorepo**         | **pnpm workspaces**                                                                                                        | npm/yarn without workspaces                         |
| **UI stack**         | **React** + **Tailwind** + **Shadcn/ui**                                                                                   | **Vue** for new work                                |

---

## Architecture Decisions (Day 1)

| #     | Invariant                           | Implementation                                                              |
| ----- | ----------------------------------- | --------------------------------------------------------------------------- |
| **1** | **Multi-tenancy from Day 1**        | **`tenant_id`** on all relevant tables; **hardcoded** in Phase **1**        |
| **2** | **Database-level tenant isolation** | **PostgreSQL RLS** — **not** app-only `WHERE tenant_id = …` as sole defense |
| **3** | **Monorepo**                        | **pnpm** — `packages/shared`, `apps/frontend`, `apps/backend`               |
| **4** | **Audit trails from Day 1**         | **`created_at`**, **`updated_at`**, **`created_by`**, **`updated_by`**      |
| **5** | **Self-hosted frontend**            | **Cloudflare Pages** or **Nginx on VPS** — **not** **Vercel** free tier     |

### Request Flow (Phase 1)

```
Frontend (React SPA)
  → REST API
    → Backend (Node.js / Express on Hetzner VPS)
      → Database (PostgreSQL + RLS)
```

---

## Repository & Documentation Map

| Location               | Purpose                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **`docs/ai-context/`** | **Canonical AI context** — the 7 files in this directory are the **source of truth** for all implementation decisions |
| **`archive/`**         | **OFF-LIMITS** — historical documents only; never read or reference                                                   |
| **`.cursor/rules/`**   | AI tooling configuration                                                                                              |
| **Root**               | **README.md** (repo entry point), **TODO.md** (conventional pointer to the living `docs/STATUS.md` backlog)           |

---

## Monorepo Layout (Target)

| Path                   | Package / App                                       | Responsibility                                                                                                             |
| ---------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **`/`**                | Root **`package.json`** + **`pnpm-workspace.yaml`** | **Workspaces**: `["apps/*", "packages/*"]`; `pnpm.onlyBuiltDependencies` for native addons                                 |
| **`packages/shared/`** | **`@surevax/shared`**                               | **Zod** schemas, types, shared utils — **must be built to `dist/` before backend** (`pnpm --filter @surevax/shared build`) |
| **`apps/frontend/`**   | Frontend                                            | **React**, **Vite**, **Tailwind**, **Shadcn/ui**                                                                           |
| **`apps/backend/`**    | Backend                                             | **Express**, **Drizzle** — imports from `@surevax/shared` resolved via `dist/` at runtime                                  |

**Tree (conceptual):**

```
surevax-cms/
├── package.json
├── pnpm-workspace.yaml
├── packages/shared/     # @surevax/shared
├── apps/frontend/
└── apps/backend/
```

---

## Development Workflow

| Step  | Order                                               |
| ----- | --------------------------------------------------- |
| **1** | **Schema-first** (**Zod** in **`@surevax/shared`**) |
| **2** | **DB schema** (**Drizzle** + migrations)            |
| **3** | **API** (**Express** routes, validation)            |
| **4** | **Frontend hooks** (**TanStack Query**)             |
| **5** | **UI** (**feature-based** folders)                  |

### Code Organization

- **Feature-based architecture** — group by **feature**, not by file type only
- **Strict TypeScript** — no **`any`**
- **React** — **functional components** + **hooks** only
- **Naming** — Components **PascalCase**, utilities **camelCase**, constants **UPPER_SNAKE_CASE**

---

## Phase 1 → Phase 2 Migration

| Aspect                     | Detail                                                                     |
| -------------------------- | -------------------------------------------------------------------------- |
| **Cross-tenant leak risk** | **Zero** (if **RLS** + **`tenant_id`** discipline holds)                   |
| **Main change**            | **Tenant middleware**: subdomain / **JWT** instead of **hardcoded** tenant |
| **Net-new Phase 2 work**   | Tenant provisioning, billing integration, dynamic resolution               |

---

## Delivery Gates

| Gate   | Focus                      | Status                | Exit criteria                                                                                                                                                                                                                                                                       |
| ------ | -------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1** | **Infrastructure + CI/CD** | ✅ **Done**           | Railway API live (`/health → 200`), DB schema deployed + RLS applied, Nixpacks build working, bcrypt native addon resolved                                                                                                                                                          |
| **G2** | **UI MVP**                 | ✅ **Done**           | Login page, split-screen patients list/detail/register, app shell with sidebar nav, Shadcn/ui components set up, JWT cookie auth (access 15m + refresh 7d), `GET/POST /api/patients`, `POST /api/auth/*`                                                                            |
| **G3** | **Core Clinical Features** | 🚧 **Nearly closed**  | ✅ Encounters (create/view) · ✅ Standing-order initiation · ✅ Clinical-order completion (administer / reschedule / recompute — stock deduction + consent, PR #76) · ✅ Arrivals atomic endpoints (PR #75) · ⬜ Scheduled-orders SMS/job runner · ⬜ Arrivals wizard consolidation |
| **G4** | **Billing**                | 🟡 **Pulled forward** | ✅ Transaction draft→pay flow, split payments, SC/PWD BIR discount, void, refund, apply-prepayment (PR #57–59); ancillary billing UX remains                                                                                                                                        |
| **G5** | **Polish + Hardening**     | ⬜ Not started        | Error boundaries, offline toast, DB-backed refresh token revocation ✅ done, audit log triggers ✅ done, per-role authorization                                                                                                                                                     |
| **G6** | **UAT + Launch**           | ⬜ Not started        | User training, Cloudflare Pages wired, monitoring, production go-live                                                                                                                                                                                                               |

### What's Live Right Now (2026-04-25)

**Backend** (`apps/backend/src/`):

- `modules/auth/` — login, logout, refresh, `/me`; JWT HTTP-Only cookies; bcrypt verify
- `modules/patients/` — list (cursor pagination + `ilike` search), get by ID, create with full medical/guardian/insurance/JSONB fields. Writes inside `db.transaction` with `set_config` for RLS context.
- `modules/encounters/` — list (with optional `patientId` filter), get by ID, create (POST). Writes use `db.transaction` + `set_config`; JSONB `specialtyData` / `clinicalNotes` JSON-stringified per gotcha.
- `modules/standing_orders/` — list templates with items (no N+1), POST `/api/patient-standing-orders` to initiate a protocol from a template (creates one `clinical_orders` row per Day-offset; nurses must supply `authorizingProviderId`).
- `modules/scheduled_orders/` — read (list/detail/timeline/recompute-preview, `paymentStatus` join, `?filter=overdue`) + write (`POST /:id/administer` — deduct the nurse-picked lot + consent + downstream recompute; `POST /:id/reschedule`; `POST /:id/recompute`) — PR #76 (2026-05-01).
- `modules/arrivals/` — `GET /api/arrivals/preview-bundle` (read-only Day-0 stock preview; the lot shown is indicative — the nurse picks the brand at administer time), `POST /api/arrivals/atomic` (encounter + PSO in one transaction). Wizard not yet consolidated to call atomic — PR #75 (2026-05-02).
- Other read-only modules (`clinical_orders`, `inventory`, `transactions`, `service_catalog`, `lab_orders`, `partner_laboratories`, `payer_profiles`, `staff_time_logs`, `dashboard`, `admin/*`).
- `shared/middleware/auth.ts` — JWT verify; skips `PUBLIC_PATHS`
- `shared/middleware/tenant.ts` — Phase 2 dynamic resolution: JWT claim → `X-Tenant-Slug` header (or subdomain) → `X-Dev-Tenant-Id` (dev only) → 400 `TENANT_REQUIRED`. No silent fallback. Tenant slug: `SVX` (PR [#219](https://github.com/njvil/surevax-cms-revamp/pull/219), 2026-05-07).
- `shared/db/` — Drizzle schema. **ID redesign landed 2026-05-19** ([#392](https://github.com/njvil/surevax-cms-revamp/pull/392)): every entity table is `bigserial` PK + `display_id text NOT NULL UNIQUE`; FKs are `bigint`. API responses surface `display_id` only via `.select()` projections — bigint never leaves the backend. Helper API in `shared/utils/displayId.ts` (mirrored in `@surevax/shared`). Schema v2 cutover (Phases 1–4) shipped 2026-05-07; 32 transitional migrations squashed into an 8-file baseline ([#228](https://github.com/njvil/surevax-cms-revamp/pull/228)). See `docs/handovers/archive/2026-05-18-id-redesign.md` for the table-by-table ID mapping and `docs/handovers/archive/2026-05-01-schema-v2-phase1.md` for the original schema v2 plan.

**Frontend** (`apps/frontend/src/`):

- `components/ui/` — Button, Input, Label, Form, Badge, Card, Sheet, Separator, Avatar, Resizable, ScrollArea, Skeleton, Toast (sonner), Command, DropdownMenu, Checkbox, Textarea, Dialog, EmptyState, FormSection
- `shared/components/AppShell.tsx` — desktop sidebar (`md+`), Sheet-based mobile drawer, breadcrumbs derived from route, keyboard shortcuts dialog (`?`), data-driven `SHORTCUTS` registry. Active-nav highlight uses primary background.
- `features/auth/` — `AuthProvider` context, `LoginPage`. Default landing path is role-aware: Nurse → `/arrivals`, others → `/dashboard` (via `defaultPathForRole`).
- `features/patients/` — list+detail+register pattern. `PatientForm` is sectioned (Identity / Contact / Guardian / Medical / Insurance) with allergy/condition `ChipInput`; `PatientDuplicatePanel` debounces a search-as-you-type and disables submit on exact first+last+DOB match unless "Create anyway" override is checked. `PatientDetail` masks sensitive JSONB keys, renders allergies/conditions as badges, and shows recent encounters (uses `?patientId=` filter).
- `features/encounters/` — list+detail Sheet drawer (specialty/vitals/clinical-notes sections, JSONB pretty-printed, sensitive keys masked). `EncounterForm` (RHF + Zod) launched from patient detail's "Start encounter" button; reusable `VitalsPanel` (BP/HR/RR/temp/SpO2/weight/height/BMI) and `BiteAssessmentPanel` (WHO category, animal type/status, exposure, wound, prior PEP) write into `clinicalNotes.vitals` and `specialtyData` respectively.
- `features/standing-orders/` — `TemplatePicker` + `InitiateProtocolSheet` (template → dose schedule preview → physician dropdown for nurses → submit creates patient_standing_orders + clinical_orders). Self-contained route at `/standing-orders`.
- `features/arrivals/` — multi-step wizard at `/arrivals` (Identify → Encounter → Protocol → Done). React context + URL search params + sessionStorage for refresh-safe wizard state. Defensive imports keep the page rendering when sibling features evolve. `Cmd+Enter` advance, `Esc` abandon.
- `features/dashboard/` — `NurseWidgets` adds "Today's encounters", "Scheduled today", "Active shift duration" (live ticker) when `role === 'Nurse'`.
- `features/shift/` — clock-in/out, banner, end-shift dropdown action (unchanged this batch).
- `App.tsx` — route-level code splitting (`React.lazy`), `RequireAuth` + `RequireAdmin` guards, role-based home redirect via `defaultPathForRole`.

**Open gaps (as of 2026-05-02)**:

- ✅ ~~Refresh tokens not DB-persisted~~ — now persisted + rotated; reuse of revoked `jti` revokes the entire family (security finding #5 remediation, PR ~Apr-26)
- ✅ ~~Clinical-order completion not wired~~ — `POST /:id/administer` ships stock deduction + consent atomically (PR #76; the lot became a required, nurse-picked argument 2026-07-25)
- ⬜ Scheduled-orders SMS/job runner (G3 close-out)
- ⬜ Arrivals wizard atomic-commit consolidation — Step 2 must defer encounter creation so Step 3 calls `POST /api/arrivals/atomic`
- ✅ ~~`consent_records.encounter_id NOT NULL` silent-skip~~ — `consent_records` table dropped in schema v2 cutover ([#217](https://github.com/njvil/surevax-cms-revamp/pull/217), 2026-05-07); replaced by polymorphic `consents` table
- ✅ Clinical-orders + lab-orders seed wiring — landed 2026-05-21 (see `docs/handovers/archive/2026-05-19-remaining-todos.md` §2; rolled into `docs/handovers/archive/2026-05-24-state-of-the-art.md`)
- `SET LOCAL` RLS pattern applied in create paths; older list/get paths still use the env-driven module constant (acceptable for Phase 1)
- Cloudflare Pages: `CORS_ORIGIN` on Railway should be set to the Pages URL (cookies use `SameSite=None; Secure` so cross-site is supported)
- `JWT_SECRET` env var on Railway is unused (superseded by `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET`) — safe to delete

**Live endpoints (2026-05-02)**:

- API: `https://surevax-cms-revamp-production.up.railway.app`
- `GET /health` → `200`
- `POST /api/auth/login|logout|refresh`, `GET /api/auth/me`
- `GET /api/patients`, `GET /api/patients/:id`, `POST /api/patients`
- `GET /api/encounters` (supports `?patientId=`), `GET /api/encounters/:id`, `POST /api/encounters`
- `GET /api/standing-order-templates`, `POST /api/patient-standing-orders`
- `GET /api/clinical-orders`, `GET /:id` · `GET /api/inventory`, `GET /:id` · `GET /api/services`, `GET /:id` · `GET /api/lab-orders`, `GET /:id`
- `GET /api/scheduled-orders` (`?filter=all|today|upcoming|missed|overdue`), `GET /:id` (with `paymentStatus`), `GET /:id/timeline`, `GET /:id/doses` (prepay picker), `GET /:id/recompute-preview`, `POST /:id/administer`, `POST /:id/reschedule`, `POST /:id/recompute`
- `GET /api/transactions`, `GET /:id`, `POST /api/transactions` (incl. item-less `depositAmount` patient-credit deposit), `POST /:id/payments|void|refund|apply-prepayment` (apply-prepayment = credit draw), `GET /api/patients/:id/credit`
- `GET /api/arrivals/preview-bundle`, `POST /api/arrivals/atomic`
- Admin: `/api/admin/users|attendance|approvals|audit`, `/api/partner-labs`, `/api/payer-profiles`, `/api/staff-time-logs`, `/api/dashboard`

---

## Security & Quality (Baseline)

| Area          | Rule                                                                  |
| ------------- | --------------------------------------------------------------------- |
| **Input**     | Validate with **Zod**; sanitize user-derived data                     |
| **DB**        | **Parameterized** queries (**Drizzle**); **bcrypt** passwords         |
| **Transport** | **HTTPS**; **CORS** configured; **rate limiting**                     |
| **Testing**   | Business logic, complex utils, **API** endpoints, critical user flows |
| **Commits**   | **Conventional Commits**                                              |

---

## Key Invariants

1. **PostgreSQL** + **RLS** is the **authoritative** tenant boundary — not optional for multi-tenant readiness.
2. **`tenant_id`** exists in the **schema from Day 1**; Phase **1** uses a **fixed** tenant context; Phase **2** switches **middleware** only.
3. **Zod** in **`@surevax/shared`** is the **single schema source of truth** for API and UI contracts.
4. **Drizzle ORM** + **Express.js** for **backend**; **React** + **Tailwind** + **Shadcn/ui** for **frontend** — **no Vue** for new code.
5. **pnpm workspaces** monorepo — **`apps/*`**, **`packages/*`**.
6. **Cloudflare Pages** for **frontend** — **do not** deploy the SPA to **Vercel** free tier (**commercial restriction**).
7. **Railway Managed PostgreSQL** (Singapore region) — **do not** anchor the architecture on **Supabase** as the primary database platform or self-host PostgreSQL on a raw VPS.
8. **Audit columns** (**`created_at`**, **`updated_at`**, **`created_by`**, **`updated_by`**) on **all** relevant tables from **Day 1**.
9. **Phase 1** = **single-tenant MVP**; **Phase 2** = **multi-tenant SaaS** with **billing** and dynamic tenant resolution — **no** full schema rewrite assumed.
