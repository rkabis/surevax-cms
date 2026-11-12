---
name: db-migrations
description: Online-safe DDL patterns for SureVax CMS (CREATE INDEX CONCURRENTLY, the 3-step NOT NULL add, shadow-column type swaps, lock_timeout, two-PR drops, the baseline-only-edit trap and supplemental-file requirement), FK cascade conventions per FK type, and the negative-inventory CHECK with its 23514 to 409 translation. Use when writing or reviewing a migration, adding an FK, or touching inventory deduction.
---

# Migrations, FK cascades & the inventory CHECK

Migrated out of `.claude/rules/patterns.md` on 2026-08-03 to keep the always-loaded budget
down. Content unchanged, and re-extracted after rebasing onto main so it
carries main's latest edits to these sections.

## Migration safety (online-safe DDL patterns)

Phase 1 dev resets are destructive — but once Phase 2 customers have populated
DBs, every schema change must be online-safe. Bake the patterns in now:

- **`CREATE INDEX` → always `CREATE INDEX CONCURRENTLY`** on populated tables.
  Drizzle does NOT emit `CONCURRENTLY` — hand-write in supplemental SQL.
  > **Audit finding H9 (2026-05-23)**: zero `CONCURRENTLY` indexes across
  > the 18 existing migration files. Phase 1 always destructive-resets so
  > the gap is dormant; the moment tenant #2 onboards with live data the
  > next index DDL takes an `ACCESS EXCLUSIVE`-equivalent lock on every
  > table. Going forward, NEW index DDL must use `CONCURRENTLY` (outside
  > the transaction wrapper — `CREATE INDEX CONCURRENTLY` cannot run in
  > a tx). Retrofit of existing files is deferred until pre-prod.
  >
  > **No supplemental file uses it today.** The first one that did
  > (`0008_ar_indexes.sql`, a partial index on
  > `payments(tenant_id, funded_by_transaction_id)` backing every credit
  > derivation) was folded into the baseline and deleted in
  > [#595](https://github.com/njvil/surevax-cms-revamp/pull/595); that index now
  > ships as `payments_funded_by_idx` in `0000_initial.sql`, where a plain
  > `CREATE INDEX` is correct because a fresh baseline database has no populated
  > table to lock. The carve-out in `migrate.ts` that detects `CONCURRENTLY` and
  > applies such a file outside the transaction wrapper is still wired and still
  > the path to use. When you write one, keep it to a single statement:
  > `client.unsafe` uses the simple query protocol, which wraps multi-statement
  > SQL in an implicit transaction that `CONCURRENTLY` cannot run inside.
- **`ADD COLUMN NOT NULL DEFAULT <fn()>`** with a function default rewrites
  every row under an `ACCESS EXCLUSIVE` lock. Use the 3-step pattern:
  1. `ADD COLUMN col TYPE NULL` (instant in PG 11+).
  2. Backfill in batches (`UPDATE … WHERE id BETWEEN $a AND $b`).
  3. `ALTER COLUMN col SET NOT NULL` (instant if covered by a CHECK).
- **`ALTER COLUMN … TYPE`** rewrites the column. For text→bigint type changes
  on populated FK columns, use shadow-column-then-swap: add `col_new bigint`,
  backfill, swap (`DROP col`, `ALTER col_new RENAME TO col`), repoint FKs.
- **A baseline-only schema edit never reaches an existing database.** The repo's
  convention is to hand-edit the consolidated `0000_initial.sql`, which works
  only for a database created from scratch: the drizzle journal already records
  `0000_initial` as applied everywhere else, so it never re-runs. Any column
  added that way ALSO needs an idempotent supplemental file registered in
  `SUPPLEMENTAL_SQL_FILES` (`migrate.ts`) — those re-run on every deploy.
  Canonical: `0009_payment_void.sql`.
  - Corollary: a guarded `DO` block in an EARLIER supplemental file that
    references the new column will CRASH those databases before your new file
    runs (each file is wrapped in a transaction, so the whole file rolls back and
    the migration aborts — on Railway that is a failed healthcheck and a
    rolled-back deploy). Guard such blocks on column existence, not just on
    `pg_constraint`. Real incident: #581 added `service_prices.product_id` to the
    baseline plus a composite FK in `0003_invariants.sql`, and every pre-existing
    database failed with `column "product_id" referenced in foreign key
constraint does not exist`.
  - A constraint whose DEFINITION changed needs `pg_get_constraintdef(oid) NOT
LIKE '%…%'` detection, not an existence guard — an existence guard silently
    skips the stale form that is already there.
- **`SET lock_timeout = '5s';`** at the top of any risky migration session.
  Fails fast instead of holding `ACCESS EXCLUSIVE` indefinitely and stalling
  every reader.
- **Drop columns/constraints in two PRs.** PR1 stops using it in app code;
  PR2 drops it in DB. Never both in the same release — one rolls back without
  the other.

## FK cascade conventions

Apply this table when adding an FK in `schema.ts`. Inconsistent cascades are
the dominant cause of "why didn't soft-delete cascade?" debugging.

| FK type                                                    | onDelete                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| Junction tables (`user_branches`, `user_roles`) → entity   | `cascade`                                                       |
| Status-history → parent entity                             | `cascade`                                                       |
| Audit / event tables → any entity                          | `no action` (audit outlives the row)                            |
| Child entity → parent (e.g. `encounters.patient_id`)       | `restrict` (deny delete if children exist; soft-delete instead) |
| Sub-record → parent (e.g. `encounter_vitals.encounter_id`) | `cascade` (encounter delete cascades)                           |
| FK to lookup tables (services, payers)                     | `restrict`                                                      |
| FK to optional refs (e.g. `encounters.appointment_id`)     | `set null`                                                      |

## Negative-inventory CHECK + 23514 → 409 translation

`inventory_lots.quantity_on_hand` and `inventory_lot_balances.quantity_on_hand`
each carry `CHECK (quantity_on_hand >= 0)` (migration 0017). The
eligibility query already filters `qoh >= qtyNeeded` and locks
`FOR UPDATE SKIP LOCKED`, so a constraint hit means a real race. The
deduct path in `apps/backend/src/modules/inventory/fefo.ts` wraps the
UPDATE in a try/catch and translates Postgres error 23514 into a
structured `LifecycleError('Inventory race: lot dipped below zero —
re-fetch and retry', 'NEGATIVE_INVENTORY', 409)`.

The CHECK is defense-in-depth — never bypass it with `quantity_on_hand

- ${q}` arithmetic in app code; always go through the deduction helpers or the explicit
  transfer ship/receive helpers.

**Trigger gotcha — `INSERT … ON CONFLICT` vs a CHECK on a negative delta
(fixed 2026-06-04).** `maintain_lot_balances()` (in
`0001_extensions_and_rls.sql`) keeps `inventory_lot_balances` in sync with each
`inventory_movements` row. It originally did
`INSERT (… quantity_on_hand = NEW.quantity_delta …) ON CONFLICT (lot_id) DO
UPDATE SET quantity_on_hand = quantity_on_hand + NEW.quantity_delta`. **Postgres
evaluates a table's CHECK constraints against the candidate INSERT tuple BEFORE
the ON CONFLICT arbiter redirects to DO UPDATE.** An "Out" movement carries a
negative `quantity_delta`, so the candidate row (`quantity_on_hand = -1`)
tripped the non-negative CHECK and the whole transaction 500'd — meaning **every
dose administration / stock deduction failed**. The browser E2E daily-loop spec
caught it. Fix: UPDATE-first, INSERT-only-if-`NOT FOUND` — the UPDATE evaluates
the CHECK against the _resulting_ balance (valid), and the INSERT path only runs
for a lot's first-ever movement (always a positive stock-in). Never resurrect
the `ON CONFLICT` form for a table with a non-negative CHECK that takes signed
deltas; a genuine over-deduction still (correctly) raises 23514 on the UPDATE.
