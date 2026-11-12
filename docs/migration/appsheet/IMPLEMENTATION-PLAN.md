# AppSheet Migration Implementation Plan

> **Status:** executable backlog, not production-ready
> **Source contract:** [`SOURCE-MANIFEST.json`](SOURCE-MANIFEST.json)
> **Semantic contract:**
> [`EVIDENCE-AND-RECONCILIATION.md`](EVIDENCE-AND-RECONCILIATION.md)

## Delivery order

Do not implement the production loader first. The reconciliation layer must
prove what will be loaded before any clinical or financial target mutation.

## Phase 0 — Freezeable evidence inputs

- [ ] Define `SourceManifest` validation in `@surevax/shared` or the migration
      module.
- [ ] Accept Drive file ID, local path, SHA-256, export timestamp, cutoff,
      timezone, branch and selected sheet/range.
- [ ] Fail closed when a file hash does not match the manifest.
- [ ] Reject copied/quarantined sheets unless the manifest carries an explicit
      adjudication.
- [x] Profile and connector-export Cubao provisionally
      (`Manual Sales 2026!A1:I19`, 2026-08-16).
- [ ] Re-export Cubao and the other 13 trackers after the declared freeze;
      materialize and hash every connector result.
- [ ] Capture Sheets UI copies for older database checkpoints.
- [ ] Download retained AppSheet Audit History outside Git.

**Output:** signed/frozen source manifest; no target writes.

## Phase 1 — Source envelopes and immutable observations

Change:

- `types.ts`: add `SourceEnvelope<T>` and source-kind unions.
- `extract.ts`: accept a manifest, not one `xlsxPath`; preserve file/sheet/row.
- `index.ts`: require cutoff and manifest/run metadata.
- reporting types: remove row-`0` placeholders.

Every observation needs:

```text
source kind
Drive file ID / local SHA-256
sheet + physical row
source row ID, when present
row-content hash
exported/observed time
raw value map or secured reference
```

**Started 2026-08-16:** `sourceEnvelope.ts` now validates immutable row
locators and separately carries the workbook-title branch. Manifest-driven
extraction and raw-row hashing remain pending.

**Database control plane completed 2026-08-17:** the regenerated development
baseline includes the tenant-scoped `migration` schema (`runs`, `run_events`,
`source_snapshots`, `observations`, `canonical_events`, `event_evidence`,
`decisions`, `target_links`, `exceptions`, `exception_events`, and
`sync_checkpoints`). These records are insert-only under both grants and a
database trigger. Importer wiring remains pending.

**Tests:** manifest mismatch, missing sheet, quarantined sheet, exact physical
row provenance, duplicate row hash and rerun behavior.

## Phase 2 — Clinic tracker extraction

- Add branch-specific header aliases without fixed column positions.
- Preserve raw service/route/brand/payment/notes text.
- Parse malformed dates into exceptions, never guessed dates.
- Group visit candidates before exploding bundled service cells.
- Produce name-to-patient crosswalk candidates using AppSheet patient DOB/contact
  where available.
- Keep fuzzy/non-unique identities unresolved.

**Fixtures:** Aguirre shifted columns, Salcedo monthly sheets, blank-header
blocks, exact duplicate rows, copied tabs, impossible years and Cubao.

## Phase 3 — Canonical event ledger

Add pure modules:

```text
eventLedger.ts   source observations -> candidate canonical events
match.ts         named deterministic/candidate matching rules
reconcile.ts     financial, clinical, schedule and exception outputs
```

**Started 2026-08-16:** `eventLedger.ts` defines append-only local
administration, external administration and scheduled-dose events plus typed
P0/P1/P2 exceptions. `manualAugmentations.ts` validates approved additions
against the frozen-source hash, and `remarkSemantics.ts` implements the narrow
owner-approved negative/contradiction and external-dose-1 phrase rules. These
modules are not yet connected to the current raw-row transforms or loader.

The ledger must emit distinct sale, purchase, payment, dose-slot,
administration, external-administration and note events. Both sides of
transaction/immunization references are unioned.

**Hard invariant:** a dangling immunization reference produces a purchase event
and exception; it is never skipped.

## Phase 4 — Delete/recreate and snapshot comparison

- Compare AppSheet row IDs across available revisions/copies.
- Emit `SOURCE_ROW_DISAPPEARED` for present-before/absent-after.
- Find recreated candidates with deterministic patient/service/slot/date facts.
- Preserve old and new observations after a canonical merge.
- Emit conflicts for changed date, route, brand, site or financial lineage.

**Fixtures:** disappeared row, same-facts new ID, conflicting new ID, transaction
pointing only to old ID, and current-only row with no historical snapshot.

## Phase 5 — Dose schedule reconstruction

- Feed canonical administrations and external-start evidence into the regimen
  engine; do not feed raw current immunizations directly.
- Retain purchased future slots without marking them administered.
- Keep overdue slots scheduled and derive due/overdue relative to cutoff.
- After checking attributable remarks, create an external dose-1 canonical fact
  when the first local ARV dose is 2+ and no contradiction exists. Unknown date,
  facility, brand and route remain unknown; never invent a completed timestamp.
- Preserve booster/episode boundaries and route-switch exceptions.
- Reconcile ERIG/HRIG/TT co-administration and the 19 bundle-only ERIG cases.

**Fixtures:** external Day 0 then local Day 3; four purchased/one administered;
deleted dose recreated; overdue not cancelled; interior missing slot; booster
episode.

### Biting-animal reconstruction

- Preserve `p_PetStatus` as the biting-animal observation fact and
  `p_PetFirstARVDate` separately as the human patient's first ARV date.
- Build `bite_incidents` / `animal_observation_followups` only where the patient,
  rabies encounter and incident/course anchor resolve uniquely.
- Map `Alive` to the historical Day-14 `Completed/AliveHealthy` outcome only for
  a uniquely resolved incident. Insert the historical fact directly during
  migration; do not replay the normal service that may cancel a Day-28 order.
- Search patient, immunization and transaction remarks for an explicit animal
  death cause or FAT/testing result. Treat ERIG/ATS skin-test text as human
  treatment evidence, not animal testing.
- Import bare `Dead` as the non-cancelling `DiedUnknownCause` outcome. Keep
  cause and testing unknown. Explicit
  attributable remarks may enrich notes but must still fit a truthful outcome.
- Treat `Pending` as “Day-14 outcome not recorded/updated,” because nurses did
  not always perform the update. With a unique incident/due date, retain the
  follow-up as Pending and derive overdue at cutoff using the human first ARV
  date plus 14 full calendar days; otherwise preserve raw. Overdue is a P3
  callback task, not a clinical outcome or a reason to cancel PEP.
- Keep N/A/blank separate from Unknown and Pending.

### Optional attendance history

- If included, pair TimeLog `Time In`/`Time Out` events and reconcile them with
  NurseShift rows by nurse, branch and date.
- Do not import NurseShift alone as complete attendance history.
- Attendance may be excluded from the clinical/financial cutover without
  blocking patient migration.

## Phase 6 — Corrected target transforms

### Transactions

- Stop silently dropping missing immunization references.
- Create one item per purchased service/dose.
- Keep allocated multi-dose bills as normal transactions.
- Preserve every ChargeAccounts observation before reconciliation.
- Maintain multi-tender and multi-patient rules.

### Clinical orders

- Build from canonical slots and administrations.
- Set `Completed` only with administration evidence.
- Set `Cancelled` only with explicit cancellation evidence.
- Remove `Migration` marker → external-clinic inference.
- Separate item quantity from dose-sequence number.

### Provenance

- Link each target display ID to source observation/event/matching rule.
- Decide permanent tenant-scoped tables versus immutable external run artifacts
  before production load implementation.

## Phase 7 — Production adapter and load

- [x] Require an explicit local/disposable-development write authorization and
      reject all writes under `NODE_ENV=production`.
- Implement current-schema-aligned Drizzle writes.
- Use tenant-scoped transactions and RLS GUCs.
- Load each sale header, items and payments atomically.
- Preserve soft-delete and database audit-trigger behavior.
- Insert the app-owner-approved active `legacy-import` consent for every
  migrated patient, with effective time and migration provenance.
- [x] Add a truthful target representation for unknown-date external
      administrations without fabricating a completion date.
- Make reruns idempotent or explicitly prevent a second production run.
- Run the read-only `migration:preflight` command against every candidate
  target before DDL or DML. A passing probe is evidence only and never grants
  write authorization.

## Phase 7B — Bounded legacy catch-up bridge

- [x] Implement a permanent append-only migration run/observation/event/link/
      checkpoint/exception ledger in the canonical development baseline.
- [ ] Wire the reconciliation pipeline and production adapter to that ledger.
- Use export hashes and source-pack hashes as authoritative watermarks; Drive
  revision IDs and modified times remain advisory.
- Treat deleted/recreated AppSheet rows as versioned observations, never as an
  instruction to delete a completed target fact.
- Apply canonical event-version idempotency keys and advance cursors only after
  target write and post-write validation succeed.
- Use one-way sync only: legacy sources feed v2 during a bounded catch-up
  window; v2 never writes changes back to AppSheet or clinic trackers.
- Retire the bridge after two consecutive frozen comparisons contain no safe
  applicable deltas. See
  [`PRODUCTION-CUTOVER-AND-SYNC.md`](PRODUCTION-CUTOVER-AND-SYNC.md).

## Phase 8 — Dry-run acceptance

Required artifacts:

- [ ] source-disposition report;
- [ ] financial reconciliation;
- [ ] purchase-versus-administration matrix;
- [ ] disappearance/recreation queue;
- [ ] duplicate/conflict queue;
- [ ] reconstructed dose schedule;
- [ ] provenance/manifest report;
- [ ] post-load invariant report from a disposable database.

Production loading stays disabled until every report has an owner and signed
disposition.

## Test and verification gates

For each code slice:

```bash
pnpm --filter @surevax/backend test
pnpm --recursive typecheck
pnpm agent:check
```

For the final adapter/load slice, also run a fresh worktree database setup,
deploy migrations/seeds, execute dry-run and rollback/clean-room repeat tests.
Any unavailable database/E2E check is reported as unverified, never treated as
passed.
