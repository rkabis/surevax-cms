# Handover — 2026-05-06 schema v2 + orchestrate efficiency session

> Pick this up if you're continuing the schema v2 migration or want to keep
> moving Phase 4/5/frontend backlog. Read this first, then the original
> [`2026-05-01-schema-v2-phase1.md`](./2026-05-01-schema-v2-phase1.md)
> handover for the spec context, then check `gh pr list --state open` for
> current PR state (state below may have drifted).

## Session summary

Two-day continuous `/orchestrate` run shipped ~30 merged PRs (#104–#151
range). Schema v2 Phase 2 reads, most of Phase 3 writes, and Phase 5
infrastructure prep all moved. Plus a meta-improvement track: codified
`/orchestrate` efficiency rules + new `/orch-audit` + `/hotfix` skills

- active PR-format-gate hook ([#150](https://github.com/njvil/surevax-cms-revamp/pull/150)).

Token cost: ~3M. Mean ~310 tokens/LoC. Detailed audit + 8 codified
lessons in `~/.claude/projects/.../memory/feedback_orchestrate_*.md`
(loaded automatically next session).

## What landed (full session)

### Schema v2 Phase 2 — read-side switchover (DONE)

All 18 modules landed: `audit`, `branch`, `payer_profiles` (incl new
`payer_contracts` CRUD), `encounters` (vitals/diagnoses), `inventory`,
`standing_orders`, `lab_orders`, `auth`, `transactions`, `Idempotency-Key`
middleware, `shifts`, `admin/users`, `service_catalog` (clinical codes),
`admin/claims` CRUD, `admin/attendance`, `admin/approvals`, `clinical_orders`,
`scheduled_orders`, `patients` extras (emergency_contacts, external_immun,
consents).

### Schema v2 Phase 3 — write switches (DONE; some open)

- ✅ admin/users dual-write user_roles + user_branches (#127)
- ✅ service_catalog dual-write service_prices (#126)
- ✅ transactions consume Idempotency-Key (#123)
- ✅ cash drawer lifecycle on clock-in/out (#128)
- ✅ consent capture writes consents (#122)
- ✅ inventory consume writes inventory_movements (#132)
- ✅ amount_outstanding trigger (#136 — recovered after #133 closed)
- 🟡 patients allergies/conditions/tags writes — [#142](https://github.com/njvil/surevax-cms-revamp/pull/142) OPEN
- 🟡 standing_orders `is_locked` + copy-on-write — [#141](https://github.com/njvil/surevax-cms-revamp/pull/141) OPEN

### Schema v2 Phase 4 — hardening (DONE; 1 open)

- ✅ ID-format CHECK constraints on every tenant-scoped PK (#134)
- ✅ NOT NULL on backfilled columns (#131)
- ✅ Immutability triggers on Paid txns + Completed clinical_orders (#139)
  — needed three hotfix iterations (#146, #149, #151) to skip cascaded
  trigger updates AND legitimate Phase 1 backfill UPDATEs. Watch for
  similar issues if you add more triggers — see
  `feedback_orchestrate_cross_invariant_validate.md`.
- ✅ Exclusion constraints on `service_prices` daterange + `appointments`
  provider double-book (in #139)
- ✅ Composite tenant FK declarations on 7 cross-table refs (in #139)
- ✅ feature_flags COALESCE fix (#130)
- 🟡 Phase 4 drops runbook — [#140](https://github.com/njvil/surevax-cms-revamp/pull/140) OPEN

### Schema v2 Phase 5 — infrastructure (DONE; 2 open)

- ✅ Audit log partition cron (#117)
- ✅ Domain events publisher worker (#124)
- ✅ PHI access logging middleware (#125 — DEVIATION: only `/api/patients/:id`
  routes; schema requires `patientId` NOT NULL)
- ✅ notification_templates seed — en-PH (#115)
- 🟡 Analytics fact/dim/rollup schema — [#129](https://github.com/njvil/surevax-cms-revamp/pull/129) OPEN
- 🟡 Analytics REFRESH worker — [#145](https://github.com/njvil/surevax-cms-revamp/pull/145) OPEN
- 🟡 Filipino (fil-PH) notification templates + break-glass runbook —
  [#147](https://github.com/njvil/surevax-cms-revamp/pull/147) OPEN

### Frontend + tests + meta

- 🟡 Frontend catch-up: AlertDialog primitive + admin/users multi-role +
  encounters vitals/diagnoses tabs + lab critical-value ack + service
  catalog rename — [#143](https://github.com/njvil/surevax-cms-revamp/pull/143) OPEN
- 🟡 Status-history triggers integration tests (11 tests, all green) —
  [#144](https://github.com/njvil/surevax-cms-revamp/pull/144) OPEN
- ✅ docs/ai-context sweep — 01/02/06 updated (#148)
- ✅ /orchestrate efficiency tooling — /orch-audit, /hotfix skills +
  pr-format-gate hook + schema-snippet extractor (#150)

## What's still open

Run this for current state:

```bash
gh pr list --state open --json number,title,state,statusCheckRollup --jq \
  '.[] | "#\(.number) \(.title)"'
```

As of handover: **8 open PRs** (#129, #140, #141, #142, #143, #144, #145, #147).
Most have CI re-running after the immutability-trigger hotfix cascade
(#146/#149/#151). They should be green-able after rebase. Check each:

```bash
for n in 129 140 141 142 143 144 145 147; do
  gh pr view $n --json mergeable,statusCheckRollup --jq \
    "\"#$n \" + .mergeable + \" \" + ([.statusCheckRollup[]?] | map(.conclusion // .status) | join(\",\"))"
done
```

Use the new skills if you find issues:

- `/orch-audit --pr-min 140 --top 5` — efficiency check on the wave
- `/hotfix` — if a recently-merged PR breaks downstream PRs again

## What's blocked (cannot dispatch — needs USER decision)

These are §6 / §7 items from the original handover that need explicit input:

- **`clinical_orders.documented_by_id` vs `administered_by_id` semantic split** —
  affects completion form UX. Today both columns are populated as the
  same user (mirror of `completed_by_id`). Real semantic split needs a
  product call: when do they differ, and what does the form ask for?
- **Analytics placement** — single OLTP DB (current) vs dedicated replica.
  Current load doesn't force the move; document the trigger ("when P99
  dashboard query > 500ms, evaluate"). Affects [#145](https://github.com/njvil/surevax-cms-revamp/pull/145) deployment shape.
- **Multi-tenant deployment model** — RLS (current) vs DB-per-tenant for
  largest customers. Phase 2 architecture concern.
- **Inventory_lot_balances accuracy verification** — need a DB to run
  `SELECT FROM inventory_lot_balances JOIN inventory_movements ...`
  drift check from handover §7. Until then, [#114](https://github.com/njvil/surevax-cms-revamp/pull/114) (inventory reads
  via lot_balances) stays held — it could ship stale balances if drift
  exists.

## What's NOT yet done

### Empty modules — table exists, no code

- **`appointments`** — booking flow + provider availability + double-book
  exclusion (DB constraint added in #139, but no endpoints, no UI)
- **`adverse_events`** — reporting endpoints + clinical-order linkage
- **`product_recalls`** — lookup integration at order time
- **`attachments`** — generic "upload file to entity" flow (only `lab_orders`
  consumes attachments today)
- **`notifications` dispatch** — templates seeded, but no dispatcher wired
  to actually send SMS/email when triggers fire

### Domain events consumers

Publisher worker shipped (#124). No CONSUMERS wired yet — analytics
upserts (will come from #145), notification trigger dispatch, integration
webhooks. Phase 5 work, sequential after #145 lands.

### Frontend backlog beyond #143

Once #143 lands, still missing:

- Patient detail UI for allergies/conditions/tags edit forms (depends on #142)
- Patient emergency contacts / external immunizations / consents UI tabs
- Standing orders `is_locked` indicator + "Edit creates new version" UI
  flow (depends on #141)
- Service catalog full price-history + per-branch/payer override editor
  (Phase 5 admin UI)
- Claims management UI (backend in #121; no frontend)
- Audit log viewer enhancements (sessionId filter, jsonb metadata
  pretty-print)
- Notifications inbox / template management UI
- Recall lookup in clinical-order flow
- Adverse-events reporting flow
- Appointments booking UI
- 03-FRONTEND-UI-UX.md sweep (W34 only owned 01/02/06)

### Phase 4 drops (premature — needs production stability)

Once Phase 3 writes have been live in prod ≥30 days with zero new legacy
rows: drop `users.role`, `users.branch_id`, `service_catalog.base_price`,
`patients.allergies`/`conditions` jsonb, `staff_time_logs.float_amount`/
`drawer_state`, `clinical_orders.completed_by_id`, `lab_orders.result_file_url`,
plus tables `inventory_transactions` + `consent_records`. Runbook in [#140](https://github.com/njvil/surevax-cms-revamp/pull/140).

### Tech debt / refactors

- Extract `apiFetch` to shared util (per-feature copy is the canonical
  pattern today; gotcha doc flags it)
- Extract `projectScheduledDate` helper (handover §6 from 2026-05-02)
- Frontend test bootstrap (vitest config + smoke tests — backend has
  vitest, frontend doesn't yet)
- AppSheet migration plan doc (`docs/risks.md` flags as never written)
- Dashboard switch to analytics rollups (depends on #145 + worker
  populating data)

### Deferred (external trigger required)

- Hash-chained audit log immutability — when certification requires it
- Field-level PHI encryption — when risk assessment specifies fields
- HL7 FHIR mapping layer — first integration partner
- EDI 837/835 claim submission — first HMO requirement
- PIDSR/IIS regulatory reporting — first DOH submission deadline
- Patient portal accounts — Phase 2+ business decision

## Operational

- **Railway monthly spend cap** — `docs/risks.md` flags as not set
- **Production CORS_ORIGIN switch** — when prod env is configured
  (`apps/backend/src/shared/config/env.ts` fail-closes on prod without it)
- **2028 audit_logs partitions** — cron in #117 handles rolling windows;
  pre-2028 manual creation needed if cron isn't running by Q4 2027

## How to pick this up

1. **Check what's actually open**: `gh pr list --state open` — the list
   above is a snapshot.
2. **Land the held / open PRs first** — most should be re-green after
   the immutability hotfix cascade. Use `/hotfix` if any new issue
   surfaces.
3. **For Phase 4 drops**: don't run them yet. Production-stability gate
   first.
4. **For new work**:
   - Use `/orchestrate` for batch parallel work — the new wave-size
     budget (6 workers / 3 spine-touchers max) is enforced by the
     orchestrate skill.
   - The PR-format-gate hook automatically blocks worker PRs that
     skip prettier-write — workers must include `pnpm prettier --write
. && pnpm lint:fix` in their tail.
   - For known target tables, run
     `scripts/extract-schema-snippet.sh <table> [<table>...]` and
     paste the output into the worker prompt's "Schema reference" section.
5. **Audit mid-batch**: every 5–10 PRs, run `/orch-audit` (or the
   `scripts/orch-audit.sh` directly with `--pr-min`/`--top`) to catch
   compounding inefficiencies before they cascade.
6. **For user-decision items**: ask before dispatching — workers don't
   push back on bad spec.

## Memory entries (loaded automatically)

8 new `feedback_orchestrate_*` files in
`~/.claude/projects/-Users-njvil-Documents-Personal-Projects-surevax-cms-revamp/memory/`,
indexed in `MEMORY.md`. They cover: spine-first prep, module-ownership,
minimum-scope, handover summaries, wave-size caps, auto-merge default,
cross-invariant validation, inline schema snippets. These load every
session — no PR or repo file needed for them.

## Skills + scripts shipped (#150)

- `/orch-audit` — token-cost audit, runs `scripts/orch-audit.sh`
- `/hotfix` — diagnose+fix workflow for cross-cutting cascades
- `scripts/orch-audit.sh` — stream-aggregates agent JSONL via jq, no
  Claude context burn
- `scripts/extract-schema-snippet.sh` — pulls a Drizzle table block from
  schema.ts
- `.claude/hooks/pr-format-gate.sh` — PreToolUse hook that blocks
  `gh pr create` / `git push` to `claude/*` refs when prettier or lint
  would fail CI

Try `/orch-audit` mid-session to verify the lessons are paying out.
