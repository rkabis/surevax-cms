# Migrations

Two tracks apply on every `db:deploy` (the runner is `../src/shared/db/migrate.ts`).

## 1. Drizzle baseline (journal-managed)

`0000_initial.sql` is generated from `../src/shared/db/schema.ts` via
`pnpm --filter @surevax/backend db:generate`. Drizzle records it in
`meta/_journal.json` and applies it with the Drizzle migrator. It is the only
journal-tracked file. Phase 1 always destructive-resets and there is no
production data yet, so the baseline is squashed (regenerated whole) rather than
accreting incremental diff files.

## 2. Hand-authored supplementals (explicit list)

`0001_extensions_and_rls.sql` through `0007_retention_procs.sql` are NOT in the
Drizzle journal. They hold everything Drizzle's DSL cannot express: RLS
policies, triggers, `GENERATED` columns, `EXCLUDE` constraints, partitioning,
FHIR views, and retention procedures. `migrate.ts` applies them in order, after
the baseline, via its explicit `SUPPLEMENTAL_SQL_FILES` array. Each file is
idempotent (`CREATE OR REPLACE` / `IF NOT EXISTS` / `DROP IF EXISTS`), so a
re-run is a no-op.

## Adding a schema change

- **Expressible in Drizzle** (table / column / index / enum): edit `schema.ts`.
  While Phase 1 stays dev-reset-only, regenerate the baseline: delete the
  Drizzle SQL file(s) + `meta/`, then `db:generate` (this is what produced the
  current single `0000_initial`). Once a tenant has real data (Phase 2), switch
  to append-only incremental migrations instead; `db:generate` will emit a new
  `0001_<name>.sql` on the Drizzle track, so **give it a name outside the
  `0001`-`0007` range** to avoid colliding with the supplementals.
- **Not expressible in Drizzle** (RLS / trigger / view / GENERATED / etc.): add
  the SQL to the themed `000X_*.sql` supplemental it belongs with, keep it
  idempotent, and do not touch the journal.

## History

Before 2026-07-04 the two tracks collided on sequence numbers (`0002_*` and
`0003_*` each existed in both tracks), and the Drizzle track carried three
random-named incremental files (`0002_red_darkhawk`, `0003_orange_hedge_knight`,
`0008_onboarding_channel`) applied out of numeric order by journal index. Those
were squashed into the single `0000_initial` baseline. The pre-consolidation
migration history is preserved in
`../../../docs/handovers/archive/2026-05-01-schema-v2-phase1.md`.
