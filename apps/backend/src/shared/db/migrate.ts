// Database migration runner
// Usage: railway run npx tsx src/shared/db/migrate.ts
// Runs Drizzle migrations then applies supplemental SQL (RLS, triggers, extensions)

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Resolve the Drizzle migrations directory. Precedence:
//   1. DRIZZLE_DIR env override (operator escape hatch — repoint without a redeploy).
//   2. dist/drizzle copy adjacent to compiled output (`build` postbuild `cp`),
//      so a `dist`-only artifact is self-contained.
//   3. Source tree at apps/backend/drizzle (dev under tsx; also the legacy prod
//      path that works only because Railpack ships the whole repo tree).
// __dirname is `src/shared/db` under tsx and `dist/shared/db` when compiled —
// both are 3 levels under apps/backend, so the source fallback is identical.
function resolveDrizzleDir(): string {
  if (process.env['DRIZZLE_DIR']) return path.resolve(process.env['DRIZZLE_DIR'])
  const distCopy = path.resolve(__dirname, '../../drizzle')
  if (existsSync(distCopy)) return distCopy
  return path.resolve(__dirname, '../../../drizzle')
}

const DRIZZLE_DIR = resolveDrizzleDir()

// Hand-written supplemental SQL files. Each is idempotent (CREATE OR REPLACE
// / DROP IF EXISTS / IF NOT EXISTS), applied in order after Drizzle migrations.
// The post-#228 (2026-05-07) accreted supplementals 0008-0029 were folded back
// into the themed 0001-0007 in the 2026-05-28 consolidation (AUTH-2 capstone).
// A second consolidation on 2026-07-30 folded the round of accreted files that
// had ALREADY reached every existing database (0008_ar_indexes,
// 0009_brand_pricing, 0010_cash_deposits) back into the baseline
// (0000_initial.sql) and these themed files — safe because those three had
// already run against Railway in earlier deploys, so removing them here only
// affects how a FRESH database gets built, never an existing one. 0009 was
// pure forward-migration cruft by that point and was deleted outright rather
// than folded. `0008_payer_price_adjustment.sql` looks similar but is NOT
// part of that consolidation — it ships the payer-percentage feature for the
// FIRST time, so it stays a live forward-migration (like 0009 was) until a
// future consolidation can confirm it has reached every deployed database too.
const SUPPLEMENTAL_SQL_FILES = [
  // Extensions, audit_logs partitioning, RLS (tenant + branch isolation with
  // platform-admin bypass), utility triggers (set_updated_at DB-7 optimized,
  // status_history, schedule_change, lot_balances, sync_txn_amounts),
  // analytics schema, session timeouts (A1), RLS hardening (M11+M12).
  '0001_extensions_and_rls.sql',
  // audit_log_changes() strict-mode trigger (H6 phase 1+2) + redaction list,
  // attached per table. Audit-log chain_hash tamper-evidence (0009).
  // verify_audit_chain() SECURITY DEFINER walker (0011).
  // DB-3: audit trigger on cross_branch_access_grants, patient_tags,
  //       service_eligible_products, service_bundle_items, tenant_counters.
  '0002_audit_and_redaction.sql',
  // Display-ID format CHECKs, polymorphic FK guards, composite tenant FKs,
  // status-history coupling, transaction_items uniqueness.
  // Negative-inventory CHECKs (0017). D2 branch-isolation trigger (0025).
  '0003_invariants.sql',
  // Immutability triggers (transactions / clinical_orders) + GENERATED
  // amount_outstanding column.
  '0004_immutability_and_generated.sql',
  // CITEXT emails, GENERATED full_name + pg_trgm, partial uniques, EXCLUDE
  // constraints, table COMMENTs. Idempotency partial uniques (CONC-1/0027).
  // DB-1 patients_tenant_mrn_uniq partial, DB-2 txn_items physician unique,
  // CONC-4 cash_drawer_sessions open-unique, CONC-5 payments ref-unique.
  '0005_modern_pg.sql',
  // FHIR R4 projection views (security_invoker=true, INT-1/INT-3 fixes).
  // patients_demographic_v cross-branch demographic view (0026 Step 2).
  '0006_fhir_views.sql',
  // SECURITY DEFINER retention procedures + audit partition rotation (0010).
  // tenant_counters RLS + triggers (0012 procedures).
  // purge_patient() DPA dry-run function (0018).
  '0007_retention_procs.sql',
  // Forward migration for the payer-wide percentage price adjustment
  // (payer_profiles.price_adjustment_percent + payer_price_adjustment_exclusions).
  // Both objects are also in the baseline for fresh databases; this file is
  // what gets them onto a database that already recorded 0000_initial as
  // applied (every existing deploy, including Railway). Must run after 0002
  // — its audit trigger calls audit_log_changes(), defined there.
  '0008_payer_price_adjustment.sql',
  // Forward migration for the payment-method-correction feature: adds
  // payments.voided_at / voided_by_id / void_reason / replaced_by_payment_id
  // (also in the baseline for fresh databases). Must run after 0001 and
  // 0005: it CREATE OR REPLACEs sync_transaction_amounts() (defined in
  // 0001) and rebuilds payments_tenant_txn_method_ref_uniq (defined in
  // 0005), both to exclude voided rows.
  '0009_payment_void.sql',
  // Forward migration for the bundle fan-out linkage feature: adds
  // clinical_orders.fan_out_transaction_id (also in the baseline for fresh
  // databases). Replaces a stopgap that stamped clinical_orders.notes with
  // the linkage instead of a real column. No ordering dependency on any
  // other supplemental file.
  '0010_fanout_linkage.sql',
  // Forward migration for the shared physical-drawer invariant. Replaces the
  // older per-user partial unique with one Open drawer per tenant+branch. It
  // never auto-closes conflicting financial history; existing duplicates make
  // the migration fail for accountable correction.
  '0011_cash_drawer_branch_invariant.sql',
  // Online-safe concurrency guard: tenant-qualified FK + order-row locking
  // reject a second active bill while permitting a corrected bill after the
  // prior transaction is Voided/Refunded. DDL uses a bounded lock timeout;
  // operators retry the migration if ordinary write traffic wins that lock.
  '0012_active_clinical_order_billing.sql',
  // Phase-1 compliance and incident-response controls: DPA execution evidence,
  // one-time tenant-bound emergency account-recovery leases, and live
  // primary-store de-identification with explicit incompleteness reporting.
  '0013_compliance_incident_response.sql',
  // Forward upgrade for the restart-safe AppSheet import ledger: migration.*
  // evidence tables, tenant RLS, immutable-event triggers, and the clinical
  // projections that cannot reach databases with an applied 0000 baseline.
  '0014_appsheet_migration_control_plane.sql',
  // Post-dose observation lives beside the immutable Completed order. This
  // forward migration creates its branch-scoped, audited one-to-one record.
  '0015_post_administration_observations.sql',
]

async function run() {
  // AUTH-2: prefer DATABASE_MIGRATOR_URL when set — it points at the migrator
  // role (BYPASSRLS + DDL). DATABASE_URL post-cutover points at surevax_app
  // (NOBYPASSRLS) which cannot do DDL. We fall back to DATABASE_URL on a
  // pre-cutover deploy so the rollout order is forgiving:
  //   1. Deploy code that knows about both URLs (this commit).
  //   2. Set DATABASE_MIGRATOR_URL in the env.
  //   3. Switch DATABASE_URL to point at surevax_app.
  const migratorUrl = process.env['DATABASE_MIGRATOR_URL'] ?? process.env['DATABASE_URL']
  if (!migratorUrl) {
    throw new Error('Neither DATABASE_MIGRATOR_URL nor DATABASE_URL is set')
  }
  if (process.env['DATABASE_MIGRATOR_URL']) {
    console.log('Using DATABASE_MIGRATOR_URL for migration.')
  } else {
    console.warn(
      'DATABASE_MIGRATOR_URL is not set — falling back to DATABASE_URL. ' +
        'This works during the AUTH-2 cutover; long-term Railway env must set both.',
    )
  }

  // Use max:1 for migrations — no pooling.
  // onnotice swallows Postgres NOTICE messages (idempotent IF NOT EXISTS / skipping
  // index, etc.) that otherwise saturate Railway's 500 logs/sec rate limit during
  // migrate runs and obscure the actual Applying/Applied lines.
  const client = postgres(migratorUrl, { max: 1, onnotice: () => {} })
  const db = drizzle(client)

  // Extensions must exist before Drizzle migrations run because schema.ts
  // declares `email citext` columns that 0000_initial.sql references.
  // 0001_extensions_and_rls.sql also creates these (idempotent), but it
  // runs *after* the Drizzle migration step.
  console.log('Ensuring required Postgres extensions...')
  await client.unsafe(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    CREATE EXTENSION IF NOT EXISTS "unaccent";
    CREATE EXTENSION IF NOT EXISTS "pg_trgm";
    CREATE EXTENSION IF NOT EXISTS "citext";
    CREATE EXTENSION IF NOT EXISTS "btree_gist";
  `)

  // FOOTGUN: drizzle's migrator tracks applied migrations in
  // `drizzle.__drizzle_migrations` — a SEPARATE schema from `public`. If
  // someone wipes `public` (e.g. `DROP SCHEMA public CASCADE` for a manual
  // reset) without also dropping `drizzle`, the marker row survives. On the
  // next deploy drizzle.migrate() decides 0000_initial.sql is already
  // applied and skips it — but the supplemental loop below assumes the
  // 0000 objects exist and crashes with `type "audit_action" does not
  // exist`. Detect that mismatch and reset the marker so 0000 re-applies.
  // Diagnostic for future debugging: see gotchas skill, "Drizzle migration
  // marker survives `DROP SCHEMA public`".
  //
  // Check is split across separate round-trips so the SQL planner doesn't
  // try to resolve `drizzle.__drizzle_migrations` on a virgin DB where the
  // table doesn't exist yet.
  const markerTableExists = await client<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    ) AS exists
  `
  if (markerTableExists[0]?.exists) {
    const drift = await client<{ has_marker: boolean; has_enum: boolean }[]>`
      SELECT
        EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations) AS has_marker,
        EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typname = 'audit_action'
        ) AS has_enum
    `
    if (drift[0]?.has_marker && !drift[0]?.has_enum) {
      console.warn(
        'Drift detected: drizzle.__drizzle_migrations populated but public schema empty — clearing marker so 0000 re-applies.',
      )
      await client.unsafe('TRUNCATE drizzle.__drizzle_migrations')
    }
  }

  console.log('Running Drizzle migrations...')
  await migrate(db, { migrationsFolder: DRIZZLE_DIR })
  console.log('Drizzle migrations complete.')

  for (const filename of SUPPLEMENTAL_SQL_FILES) {
    const filePath = path.resolve(DRIZZLE_DIR, filename)
    console.log(`Applying supplemental SQL: ${filename}...`)
    const sql = readFileSync(filePath, 'utf-8')
    // C2: wrap each supplemental file in a transaction so a mid-file
    // syntax/dependency error rolls back cleanly instead of leaving the
    // schema half-applied. Files that ship their own BEGIN/COMMIT
    // (e.g. 0019_junction_fk_cascades.sql) still work — Postgres
    // tolerates the nested BEGIN as a no-op and the file's COMMIT closes
    // the outer transaction, which is the same atomicity guarantee.
    //
    // Carve-out: `CREATE INDEX CONCURRENTLY` (H9, future index DDL on
    // populated tables) CANNOT run inside a transaction. Detect the
    // keyword and apply such files without the wrapper. None today, but
    // the path is wired so the first CONCURRENTLY file doesn't crash.
    if (/CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i.test(sql)) {
      await client.unsafe(sql)
    } else {
      await client.begin(async (tx) => {
        await tx.unsafe(sql)
      })
    }
    console.log(`Applied ${filename}.`)
  }

  const [financialGuard] = await client<
    Array<{ item_trigger: boolean; activation_trigger: boolean; tenant_fk_valid: boolean }>
  >`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.transaction_items'::regclass
          AND tgname = 'trg_transaction_items_one_active_clinical_order'
          AND tgenabled <> 'D' AND NOT tgisinternal
      ) AS item_trigger,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.transactions'::regclass
          AND tgname = 'trg_transactions_active_order_claims'
          AND tgenabled <> 'D' AND NOT tgisinternal
      ) AS activation_trigger,
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.transaction_items'::regclass
          AND conname = 'transaction_items_tenant_clinical_order_fk'
          AND convalidated
      ) AS tenant_fk_valid
  `
  if (
    !financialGuard?.item_trigger ||
    !financialGuard.activation_trigger ||
    !financialGuard.tenant_fk_valid
  ) {
    throw new Error('Phase-1 financial guard verification failed after migration')
  }
  console.log('Verified Phase-1 clinical-order billing guards.')

  await client.end()
  console.log('All migrations complete.')
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
