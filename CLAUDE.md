# CLAUDE.md — SureVax CMS v2.0

ABTC clinic management system (Philippines). Replaces AppSheet/Google Sheets MVP.
Phase 1 = single-clinic MVP. Phase 2 = multi-tenant SaaS — schema cutover (Phases 1–4) landed 2026-05-07; dynamic tenant resolution is live; remaining Phase 2 work is operational (subdomain routing, tenant onboarding playbook, billing).

> **Runtime posture: development only.** Every deployed environment is
> `NODE_ENV=development`. No real clinical data anywhere yet. The backend
> (`apps/backend/src/shared/config/env.ts`) fail-closes if someone flips
> `NODE_ENV=production` without replacing dev secrets + CORS origin.
> Transition plan: [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md).

> **Solo-dev posture.** This is a single-developer project — there are no other
> developers, so changes do **not** wait on human code review from teammates.
> Still branch + open a PR (CI gates run there and auto-merge lands it once
> green) — the PR + green CI is the gate, not peer sign-off. Don't block on,
> request, or assign human reviewers. `/pr-review` and similar review-by-others
> flows are optional self-checks, not required steps.

> **ID redesign landed (2026-05-19).** Two-tier IDs: `bigserial` PK + `display_id`
> text column on every entity table; FKs are `bigint`; API surface speaks
> `display_id` (frontend types all IDs as `string`). Helper API in
> `apps/backend/src/shared/utils/displayId.ts` (mirrored in `@surevax/shared`).
> See `.claude/rules/gotchas.md` "Display IDs — two-tier model" for the
> always-loaded summary; full table-by-table mapping archived at
> [`docs/handovers/archive/2026-05-18-id-redesign.md`](docs/handovers/archive/2026-05-18-id-redesign.md).

## Deep context

`docs/ai-context/_INDEX.md` — routes to 7 context files (architecture, data model, backend API, frontend UI, infrastructure, dependency policy, clinical workflows). Read only what's relevant. `archive/` is historical only.

## Stack

| Layer      | Choice                                                            | Banned                                                    |
| ---------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| Frontend   | React 19, TS, Vite, TanStack Query, RHF, Zod, Tailwind, Shadcn/ui | Vue, CRA, Redux, styled-components, axios, lodash, moment |
| Backend    | Node.js 22, Express.js, Drizzle ORM, Pino                         | NestJS, Prisma, TypeORM, console.log in prod              |
| DB         | PostgreSQL 15+ with RLS                                           | Supabase, Firebase, self-hosted PG                        |
| Auth       | HTTP-Only Secure cookies + refresh tokens (bcrypt)                | localStorage/sessionStorage JWTs                          |
| Hosting    | Cloudflare Pages + Railway (Railpack, Singapore) + Cloudflare R2  | Vercel free tier                                          |
| Validation | Zod in `@surevax/shared` — single source of truth                 | Duplicate validation across layers                        |

## Non-negotiable rules

1. `tenant_id` on all tenant-scoped tables — hardcoded Phase 1, dynamic Phase 2
2. RLS is the primary tenant boundary — not app-only WHERE clauses
3. `SET LOCAL` only inside `db.transaction()` — never in middleware on pooled connections
4. Zod is the single schema source — shared between frontend and backend
5. Soft deletes only (`deleted_at`) for clinical/financial data
6. Audit trails via DB triggers — not app-only logging
7. Nurse picks the brand at administer time — the server never infers a lot for a dose. **FEFO is an ordering convention, not an automatic pick**: the picker sorts house-brand-first then earliest-expiry, and automatic earliest-expiry deduction survives only for point-of-sale bundle fan-out
8. No wrapping React Query, RHF, Router, Shadcn — DO wrap infra (HTTP, logging, analytics)
9. Never force-push to a PR with auto-merge armed — disarm first, push, then re-arm. Pattern in `commits.md`.

## Code conventions

- Feature-based architecture — group by feature, not file type
- Strict TypeScript — no `any`
- Functional components + hooks only
- Naming: Components PascalCase, utilities camelCase, constants UPPER_SNAKE_CASE
- Conventional Commits
- Parameterized queries only — never string-interpolate into SQL

## Monorepo layout

`@surevax/shared` (in `packages/shared/`) must compile to `dist/` before `apps/backend` builds — TS paths are compile-time only.

## Dependency gate

All 5 must pass: (1) can't build in <1 week, (2) maintained <3mo, (3) >1M downloads, (4) replaceable in <1 week, (5) fits conventions. Exception: never build security/crypto in-house. See `docs/ai-context/05-DEPENDENCY-POLICY.md`.

## Context Hygiene

Detailed rules: [`.claude/rules/efficiency.md`](.claude/rules/efficiency.md).

1. **Parallelize independent tool calls.** When the next 2+ calls don't depend on each other's outputs, batch them in ONE assistant turn. `git status`+`git diff`+`git log`, three independent Reads, etc. — never sequential.
2. **Don't narrate before tool calls.** Banned filler: `Let me check`, `Now let me`, `Let me read`, `I'll start by`. Just call the tool. (See `efficiency.md` for the full ban list and rationale.)
3. **Never re-Read a file in the same session.** `no-duplicate-read.sh` hook warns. Use offset/limit or grep for second visits.
4. **Never transcribe specs/handovers verbatim.** When implementing from a spec/RFC, reference it via path and quote only the specific sections being implemented — do not copy content into new code or doc files. If the user pastes a >5KB doc, ask whether to save verbatim, summarize, or have them save it.
5. **Pipe Bash outputs.** For any tool call expected to return >5k tokens (preview_network, large file reads, build logs), pipe through `head`/`grep`/`jq` filters first. `git log`, `pnpm install`, `find /`, and unfiltered `preview_network` are **blocked** by the context-hygiene hook — fix the command, don't fight the hook.
6. **Delegate broad searches to Agent (Explore).** Multi-file audits, "where is X used", design-doc reviews — subagent's tool noise stays in its context, only summary returns.
7. **Use `/compact-context` when conversation grows long.** Writes a handover note and starts fresh.
8. **Always-loaded budget**: `CLAUDE.md` + `.claude/rules/*.md` load every turn. Single-module / encyclopedia content → skill (loaded on demand). Current example: `gotchas.md` (core) + `gotchas` skill (deep).

## Doc Propagation

When renaming terminology, removing rules, or changing schema, search ALL docs (CLAUDE.md, README, RFCs, skill files, project_status.md, handover docs) in one pass before declaring done.

## Sub-agent Verification

After spawning parallel sub-agents/workers, ALWAYS verify each one actually committed AND pushed AND opened a PR before reporting success. Silent push failures are common — recover inline if a worker stalls. Verification commands are in the `/orchestrate` skill (§2b).

## Operational details

Local bootstrap: run `pnpm run setup` once per worktree to create `.env` files,
per-worktree ports, migrations, and seed data. Run `pnpm agent:check` before
handoff or PR to verify agent instructions, formatting, lint, typecheck, and
build.

Three test layers: backend integration (`pnpm --filter @surevax/backend test`,
Vitest + real Postgres), frontend component (`pnpm --filter @surevax/frontend
test`, Vitest + RTL + MSW), and browser E2E (`pnpm test:e2e`, Playwright in
[`e2e/`](e2e) against the full seeded stack — needs `pnpm dev` running, else it
boots the stack itself). All three run in CI.

Always-loaded `.claude/rules/` files (project instructions):

- `worktree.md` — git worktree workflow, pnpm PATH, index.lock, push-ref rename
- `gotchas.md` — high-frequency gotchas (display IDs, schema v2, JSONB, audit trigger, CSRF, requireRole, apiFetch, @surevax/shared, req.user). Low-frequency AND single-module gotchas → `gotchas` skill (load on demand).
- `patterns.md` — tenant-scoped DB access, PHI/break-glass, module structure, middleware order, money. Migrations + FK cascades → `db-migrations` skill; test-layer conventions → `testing` skill.
- `risks.md` — known risks and open questions
- `commits.md` — Conventional Commits, PR + ship flow, rebase + force-with-lease
- `efficiency.md` — token-efficiency rules (parallelize tool calls, ban narration filler, grep-first, etc.)
- `design-system.md` — frontend primitives (`PageHeader`, `KpiCell`+`Sparkline`, `KpiStrip`, `ListEmpty`, `DetailSheet`/`DetailRail`, `TableCard`, `PageToolbar`, `DoseStrip`, …), theme identity tokens, the 2xl wide-screen ladder, the canonical list-page/cockpit shapes, and the CI gates that enforce them

Load-on-demand skills (only when relevant):

- `gotchas` — encyclopedia of low-frequency + single-module gotchas (cross-site cookies, Drizzle Date sql, shadcn CLI, JWT validation, refresh tokens, PSO date-math, PIN attestation, payer/brand pricing, patient credit + multi-patient transactions, D2 trigger, AUTH-2 two-role split, SQL `.append()`, TooltipProvider, DirtyFormGuard)
- `db-migrations` — online-safe DDL (CONCURRENTLY, 3-step NOT NULL, shadow-column swaps, two-PR drops, baseline-edit trap), FK cascade table, negative-inventory CHECK + 23514→409
- `testing` — frontend component layer (jsdom + MSW + `renderWithProviders`) and backend `withRollback` BEGIN/ROLLBACK isolation with its GUC / Drizzle / supertest caveats
- `railway-ops` — Railway deploy, env vars, DATABASE URLs, migrations, CLI
- `pilot-integration` — run + land an `/orchestrate-pilot` wave: structured args, verify-prompt design facts, patch recovery from transcripts, git-apply ladder, main-tree write check
- `curl-smoke` — canonical end-to-end curl verification recipe (login + CSRF + tenant headers, envelope checks, the runtime bug classes typecheck can't catch). Run before committing DB-touching features and after every wave integration.
- `parallel-work` — repo conventions for parallel work (applies to `/orchestrate-pilot` and the legacy `/orchestrate`)
- `pr-review` — `/pr-review` parallel review-and-fix on open PRs (workers checkout each PR, audit against gotchas+patterns, fix BLOCKERs in-place, verify doc parity, post `--comment` review)
- `orchestrate` — **legacy** per-unit-PR orchestration protocol; prefer `/orchestrate-pilot` (deterministic fan-out, consolidated PR). Use only when units must land/revert independently.

Parallel-work model tiering (see `efficiency.md` for the full ladder): the
coordinator plans/verifies on the session model; impl workers run Sonnet,
adversarial verifiers run Opus — pinned in the `orchestrate-pilot` workflow.
