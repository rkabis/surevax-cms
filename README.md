# SureVax CMS v2.0

Planning and implementation documentation for a clinic management system focused on Animal Bite Treatment Centers (ABTCs) in the Philippines.

> ⚠️ **Development stage only.** All deployed environments (Railway backend,
> Cloudflare Pages frontend, Postgres) run with `NODE_ENV=development`, dev
> secrets, and no environment split. Do **not** point a real clinic at this
> codebase. See [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md) for the
> posture and the step-by-step transition to a real dev + prod split.

## Current Status

- Pilot status: **NO-GO as of the 2026-08-23 live Branch-account walkthrough.**
  Cross-branch write isolation, branch-local clinic-day accounting, staff-PIN
  recovery, prepayment eligibility, lot attestation, queue/account consistency,
  identity checkpoints and late-dose recovery must pass the acceptance tests in
  the [live usability audit](docs/audits/2026-08-22-branch-account-live-usability.md).
  The prioritized remediation list lives in [`docs/STATUS.md`](docs/STATUS.md).
- Project phase: **post-G3 — safety hardening + live-workflow remediation.** G3 core shipped 2026-05-01/02
  (clinical-order completion PR #76, Arrivals atomic endpoints PR #75, Schema v2 Phase 1
  PR #77). Major landings since: Schema v2 cutover + migration consolidation to 8 files
  (2026-05-07), the **AUTH-2 RLS capstone** (RLS enforced via a two-role split, verified on
  the Railway `development` env 2026-05-31), and the **form-surface UI redesign** P0–P3
  (patient record/register/edit as full-page routes, keyboard-driven Scheduled Orders,
  Dashboard cash/non-cash + printable end-of-day report; 2026-06-01…2026-06-03). The live
  backlog lives in `docs/STATUS.md`; dated handovers are historical evidence, not
  the task tracker.
- Runtime posture: **development only** — see `docs/ENVIRONMENTS.md`
- Delivery path:
  - Phase 1: single-clinic runtime (single-tenant operation)
  - Phase 2: multi-tenant SaaS enablement (tenant resolution + billing)
  - Schema v2 Phases 1–4 shipped 2026-05-07 (see `docs/handovers/archive/2026-05-01-schema-v2-phase1.md` for the original phased plan)

## Canonical Sources of Truth

Use these first for all implementation decisions:

- `docs/ai-context/_INDEX.md` (router to the canonical context)
- `docs/ai-context/00-SYSTEM-CORE.md` through `docs/ai-context/06-PRODUCT-WORKFLOWS.md`
- `docs/specs/surevax-cms-v2/requirements.md` (active requirements baseline)

Historical materials are kept under `archive/` for traceability only and should not drive current implementation decisions.

## What SureVax v2.0 Must Deliver

From the active requirements and workflow specs:

- Branch-scoped operations with strict access controls and auditable exceptions
- Master Patient Index with duplicate detection and required guardian/emergency data rules
- Atomic clinical intake flows (single-service and service-bundle paths)
- Multi-dose protocol scheduling: clinical orders are auto-generated; their dates recalculate when a dose slips, and a state machine drives Scheduled → Pending → Completed/Missed transitions
- Standing-order execution with authorization-chain integrity
- BIR-compliant billing and receipts with SC/PWD-compliant discount handling
- FEFO inventory control with lot-level traceability
- Compliance controls for Philippine DPA, PIDSR, NaRIS, and retention policies
  - At-rest encryption decision (Railway AES-256 + R2 SSE-S3 as SPI control): [`docs/compliance/dpa-controls.md`](docs/compliance/dpa-controls.md)
- Interoperability path via HL7 FHIR-aligned data exchange

## Architecture Baseline

### Application Stack

- Frontend: React 19, TypeScript, Vite, TanStack Query, React Hook Form, Zod, Tailwind CSS, Shadcn/ui
- Backend: Node.js 22 LTS, Express.js, Drizzle ORM
- Database: PostgreSQL 15+ with Row-Level Security (RLS) and tenant-aware schema
- Validation: Zod as the single contract source shared across layers

### Infrastructure Baseline

- Frontend hosting: Cloudflare Pages
- Backend hosting: Railway (Singapore region, managed containers)
- Database hosting: Railway Managed PostgreSQL (Singapore region)
- Object storage: Cloudflare R2
- Security edge: Cloudflare WAF

### Non-Negotiables

- No `localStorage`-based JWT auth for web sessions; use HTTP-only secure cookies
- No Supabase as the primary data platform
- No Vercel free tier for production frontend hosting
- No Vue for new implementation work; React stack only
- No bypassing RLS for tenant isolation

## Repository Layout

```text
surevax-cms-revamp/
├── README.md
├── TODO.md                 ← stub; the backlog moved to docs/STATUS.md
├── docs/
│   ├── README.md           ← documentation map (start here)
│   ├── STATUS.md           ← the live backlog: current state + open work (single source)
│   ├── ROADMAP.md          ← long-term module roadmap (Phase 2 to 4)
│   ├── ENVIRONMENTS.md     ← dev to production transition plan
│   ├── ai-context/         ← canonical implementation context, _INDEX.md + 00-06 (read first)
│   ├── specs/              ← design specs / RFCs
│   ├── runbooks/           ← operational procedures (onboarding, RLS cutover, ...)
│   ├── migration/          ← AppSheet to SureVax data migration
│   ├── audits/             ← point-in-time analyses + audit artifact bundles
│   ├── compliance/         ← regulatory notes (DPA / BIR / DOH)
│   ├── security/           ← security reviews
│   └── handovers/          ← dated, append-only session notes (see handovers/README.md)
│       └── archive/        ← superseded handovers
└── archive/                ← historical planning docs (pre-build)
```

## Recommended Reading Paths

### For product and workflow implementation

1. `docs/specs/surevax-cms-v2/requirements.md`
2. `docs/ai-context/06-PRODUCT-WORKFLOWS.md`
3. `docs/ai-context/01-DATA-AND-COMPLIANCE.md`
4. `docs/ai-context/02-BACKEND-API.md`
5. `docs/ai-context/03-FRONTEND-UI-UX.md`

### For architecture and deployment

1. `docs/ai-context/00-SYSTEM-CORE.md`
2. `docs/ai-context/04-INFRASTRUCTURE-DEPLOYMENT.md`
3. `docs/ai-context/05-DEPENDENCY-POLICY.md`

### For historical rationale

- `archive/README.md` first
- Then inspect only the relevant archived file(s) by title and scope

## Implementation Approach (Planned)

- Phase 1 is designed as single-clinic runtime, but with tenant-ready schema and access boundaries from day 1
- Development sequence is schema-first:
  1. Shared Zod contracts
  2. Drizzle schema + migrations
  3. API modules + validation
  4. Frontend data hooks
  5. Feature UI assembly
- Core correctness properties are defined in `requirements.md` and `06-PRODUCT-WORKFLOWS.md`; these should drive tests and acceptance checks

## Compliance and Safety Focus

SureVax v2.0 is designed for regulated healthcare operations. Key controls include:

- Database-enforced tenant isolation and branch-scoped access rules
- Immutable audit trails for critical clinical, financial, and access events
- Payment-before-administration enforcement for Day 0 biologics workflows
- FEFO inventory usage and expired-lot hard stops
- DPA-aligned protection measures (encryption, retention, breach process readiness)

## Dependency and Contribution Discipline

- Follow the dependency gate in `docs/ai-context/05-DEPENDENCY-POLICY.md`
- Prefer stable, minimal dependencies; avoid unnecessary abstractions over framework-level libraries
- Keep TypeScript strict and avoid `any`
- Use conventional commit messages

## Working Backlog

- Live backlog (current state + open work): [`docs/STATUS.md`](docs/STATUS.md)
- Long-range roadmap and additive expansions: [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Full documentation map: [`docs/README.md`](docs/README.md)

## Setup (local dev)

Use Node 22 and pnpm 9.15.0. `.nvmrc`, the root engine constraints, and the
`packageManager` field define the supported local toolchain.

Per-worktree isolation is the default. The setup script reuses one local
Postgres container and creates a separate database, backend port, frontend
port, and env files for each worktree.

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

`pnpm run setup` writes `apps/backend/.env` and `apps/frontend/.env.local`, runs
migrations, and seeds the worktree database. Re-run `pnpm run setup --force` only
when you intend to regenerate local env files.

Before handing work to another agent or opening a PR, run:

```bash
pnpm agent:check
```

This verifies Codex/Claude instruction files, formatting, zero-warning lint,
frontend token/design-system rules, typecheck, and build.

### Test layers

Three suites, all gated in CI (`.github/workflows/ci.yml`):

| Layer               | Command                                | Stack                                  | Covers                                                                                                                                                                 |
| ------------------- | -------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend integration | `pnpm --filter @surevax/backend test`  | Vitest + real Postgres                 | API + DB: RLS, audit trigger, CSRF, FEFO, transactions, idempotency, tenant resolution, money. Needs local setup.                                                      |
| Frontend component  | `pnpm --filter @surevax/frontend test` | Vitest + Testing Library + MSW (jsdom) | Per-component logic; no backend. Scaffold in `apps/frontend/src/test-utils/`.                                                                                          |
| Browser E2E         | `pnpm test:e2e`                        | Playwright + Chromium                  | Cross-page journeys against the **full seeded stack** (frontend → backend → Postgres): login, daily loop (administer → payment), Arrivals wizard, cashier, page smoke. |

`pnpm test:e2e` reuses a running `pnpm dev` (per-worktree ports), or boots the
stack itself. Runs as the single-operator `Branch` account. See
[`e2e/README.md`](e2e/README.md) for how to add specs and the seed-data caveats.

Test credentials and tenant slug resolution are documented in
`.claude/rules/gotchas.md`. Codex-facing project rules live in `AGENTS.md`;
Claude-facing deep rules live in `CLAUDE.md` and `.claude/rules/`.

---

Last updated: 2026-05-02 (G3 clinical-order completion PR #76, Arrivals atomic PR #75, Schema v2 Phase 1 PR #77)
