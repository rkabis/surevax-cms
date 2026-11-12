/**
 * Destructive-by-design migration trial for a disposable local database.
 *
 * This runner deliberately accepts only a localhost database whose name starts
 * with `surevax_migration_trial_`. It is not a production cutover command.
 */
import 'dotenv/config'
import { drizzleAdapter } from '../modules/data_migration/adapter.js'
import { buildCanonicalClinicalPlan } from '../modules/data_migration/clinicalMigrationPlan.js'
import { projectAttendance } from '../modules/data_migration/attendanceProjection.js'
import { stabilizeMigrationTargetIds } from '../modules/data_migration/deterministicTargets.js'
import { load } from '../modules/data_migration/load.js'
import { runLocalMigrationRehearsal } from '../modules/data_migration/rehearsal.js'
import { projectTransactionConstrainedItems } from '../modules/data_migration/transactionItemProjection.js'
import { assertDevelopmentWriteAuthorized } from '../modules/data_migration/writeAuthorization.js'
import type { MigrationContext } from '../modules/data_migration/types.js'

function args(argv: string[]): Map<string, string> {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || !value) throw new Error('arguments must be --key value pairs')
    values.set(key, value)
  }
  return values
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key)
  if (!value) throw new Error(`${key} is required`)
  return value
}

const values = args(process.argv.slice(2))
const databaseUrl = process.env['DATABASE_URL']
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const target = new URL(databaseUrl)
if (!['localhost', '127.0.0.1'].includes(target.hostname)) {
  throw new Error('local migration trial refuses a non-local database')
}
const databaseName = target.pathname.slice(1)
if (!databaseName.startsWith('surevax_migration_trial_')) {
  throw new Error('local migration trial requires a surevax_migration_trial_* database')
}

const tenantId = values.get('--tenant') ?? 'SVX'
const cutoffDate = required(values, '--cutoff')
const scope = values.get('--scope') ?? 'base'
if (!['base', 'clinical', 'full'].includes(scope))
  throw new Error('--scope must be base, clinical, or full')
const fingerprint = required(values, '--database-fingerprint')
assertDevelopmentWriteAuthorized(false, {
  targetClass: 'disposable_development',
  databaseFingerprint: fingerprint,
  approvedBy: required(values, '--approved-by'),
  approvedAt: required(values, '--approved-at'),
})

const rehearsal = await runLocalMigrationRehearsal({
  manifestPath: required(values, '--manifest'),
  appsheetSnapshotDirectory: required(values, '--appsheet-snapshot-dir'),
  appsheetSnapshotSha256: required(values, '--appsheet-snapshot-sha'),
  tenantId,
  cutoffDate,
})

const allowedTrialP0 = new Set([
  'LOAD_PLAN_SCHEDULES_NOT_RECONCILED',
  'TRACKER_TAB_OWNERSHIP_UNRESOLVED',
])
const unexpectedP0 = rehearsal.report.queue.filter(
  (item) => item.priority === 'P0' && !allowedTrialP0.has(item.code),
)
if (unexpectedP0.length > 0) {
  throw new Error(
    `unexpected P0 blocks trial write: ${unexpectedP0.map((item) => item.code).join(', ')}`,
  )
}

// The legacy clinical projection is never admitted. Clinical scope replaces it
// with the canonical evidence/course projector.
const preClinicalPlan = {
  ...rehearsal.plan,
  patientStandingOrders: [],
  clinicalOrders: [],
}
const canonicalClinical =
  scope !== 'base'
    ? buildCanonicalClinicalPlan({
        source: rehearsal.source,
        ledger: rehearsal.ledger,
        basePlan: preClinicalPlan,
        tenantId,
        evaluatedAt: new Date(`${cutoffDate}T23:59:59.999+08:00`),
      })
    : null
const preItemPlan = {
  ...preClinicalPlan,
  encounters: canonicalClinical?.encounters ?? preClinicalPlan.encounters,
  patientStandingOrders: canonicalClinical?.patientStandingOrders ?? [],
  clinicalOrders: canonicalClinical?.clinicalOrders ?? [],
}
const transactionItemProjection =
  scope === 'full' ? projectTransactionConstrainedItems(preItemPlan) : null
const attendanceProjection =
  scope === 'full'
    ? projectAttendance({
        source: rehearsal.source,
        plan: preItemPlan,
        tenantId,
        cutoffAt: new Date(`${cutoffDate}T23:59:59.999+08:00`),
      })
    : null
const stablePlan = stabilizeMigrationTargetIds({
  ...preItemPlan,
  transactionItems: transactionItemProjection?.items ?? [],
  staffTimeLogs: attendanceProjection?.staffTimeLogs ?? [],
})

const adapter = drizzleAdapter(tenantId)
const platformUserId = await adapter.resolvePlatformUserId(tenantId)
const ctx: MigrationContext = {
  tenantId,
  platformUserId,
  cutoverAt: new Date(`${cutoffDate}T23:59:59.999+08:00`),
  dryRun: false,
  batchSize: 500,
  log: (event) => console.error(`[migration-trial] ${event.level}: ${event.msg}`),
}
const patientsWithSafeDob = stablePlan.patients.map((patient) => {
  const invalid =
    patient.dateOfBirth !== null &&
    (patient.dateOfBirth <= '1900-01-01' || patient.dateOfBirth > cutoffDate)
  if (!invalid) return patient
  return {
    ...patient,
    dateOfBirth: null,
    onboardingData: {
      ...patient.onboardingData,
      migration: { invalidDateOfBirthWithheld: true },
    },
  }
})
const invalidDateOfBirthWithheld = patientsWithSafeDob.filter(
  (patient) =>
    (patient.onboardingData['migration'] as { invalidDateOfBirthWithheld?: boolean } | undefined)
      ?.invalidDateOfBirthWithheld === true,
).length
const aggregatedTransactionItems = new Map<
  string,
  (typeof rehearsal.plan.transactionItems)[number]
>()
for (const item of stablePlan.transactionItems) {
  const key = [item.transactionLegacyId, item.serviceId, item.performedByUserLegacyId ?? ''].join(
    '::',
  )
  const previous = aggregatedTransactionItems.get(key)
  if (!previous) {
    aggregatedTransactionItems.set(key, { ...item, clinicalOrderLegacyId: null })
    continue
  }
  const quantity = Number(previous.quantity) + Number(item.quantity)
  const subtotal = Number(previous.subtotal) + Number(item.subtotal)
  aggregatedTransactionItems.set(key, {
    ...previous,
    quantity: quantity.toFixed(2),
    unitPrice: (subtotal / quantity).toFixed(2),
    subtotal: subtotal.toFixed(2),
    discountAmount: (Number(previous.discountAmount) + Number(item.discountAmount)).toFixed(2),
    vatAmount: (Number(previous.vatAmount) + Number(item.vatAmount)).toFixed(2),
  })
}
const baseTransactionItems = [...aggregatedTransactionItems.values()]
// This trial intentionally loads only source-authoritative base facts. The
// legacy clinical-order transform has not yet been replaced by the canonical
// course/slot projector and can misclassify old planned doses. Transaction
// headers and tender legs reconcile, but Immunization-derived invoice lines do
// not: the frozen full-load check materially overstated service-line totals.
// Withhold every line until the transaction-authoritative item projector can
// preserve header gross/net and allocate discounts without double counting.
const baseFactsPlan = {
  ...stablePlan,
  // Legacy staff rows are identity/reference records in this trial. They must
  // never become usable credentials before owner-reviewed branch/role mapping.
  users: stablePlan.users.map((user) => ({ ...user, canLogin: false })),
  patients: patientsWithSafeDob,
  // Current/go-live rates are configuration, not historical sale facts. The
  // live Vaccine rows and seeded catalog currently contain genuine tier/route
  // conflicts, so prices are reconciled from the cleaned price matrix in a
  // separate configuration stage. Transaction-item unit prices remain intact.
  servicePrices: [],
  patientStandingOrders: stablePlan.patientStandingOrders,
  clinicalOrders: stablePlan.clinicalOrders,
  transactionItems: scope === 'full' ? baseTransactionItems : [],
}
const report = await load(baseFactsPlan, adapter, ctx, {
  run: {
    tenantId,
    mode: 'Baseline',
    sourcePackHash: rehearsal.report.sourcePack.hash,
    cutoffAt: ctx.cutoverAt,
    importerVersion: values.get('--importer-version') ?? 'appsheet-local-v3',
    metadata: {
      databaseFingerprint: fingerprint,
      sourceSnapshotSha256: required(values, '--appsheet-snapshot-sha'),
      boundary:
        scope === 'full'
          ? 'base_facts_plus_canonical_clinical_plus_exact_transaction_items_plus_attendance'
          : scope === 'clinical'
            ? 'base_facts_plus_canonical_clinical'
            : 'base_facts_only',
    },
  },
})
console.log(
  JSON.stringify(
    {
      mode: 'disposable_local_trial',
      databaseName,
      tenantId,
      sourcePackHash: rehearsal.report.sourcePack.hash,
      allowedUnresolvedP0: [...allowedTrialP0],
      withheldForInitialTrial: {
        invalidDateOfBirthFields: invalidDateOfBirthWithheld,
        duplicateTransactionItemRowsAggregated:
          stablePlan.transactionItems.length - baseTransactionItems.length,
        transactionItems: baseTransactionItems.length,
        servicePrices: stablePlan.servicePrices.length,
        unsafeLegacyPatientStandingOrders: rehearsal.plan.patientStandingOrders.length,
        unsafeLegacyClinicalOrders: rehearsal.plan.clinicalOrders.length,
        canonicalClinicalBlocks: canonicalClinical?.blocks.length ?? null,
        canonicalProjectionBlocks: canonicalClinical?.projectionBlocks.length ?? null,
      },
      canonicalClinical: canonicalClinical
        ? {
            counts: canonicalClinical.counts,
            resolutionCounts: canonicalClinical.resolutionCounts,
            blockCounts: Object.fromEntries(
              [...canonicalClinical.blocks, ...canonicalClinical.projectionBlocks].reduce(
                (counts, block) => counts.set(block.code, (counts.get(block.code) ?? 0) + 1),
                new Map<string, number>(),
              ),
            ),
          }
        : null,
      transactionItemProjection: transactionItemProjection?.counts ?? null,
      attendanceProjection: attendanceProjection?.counts ?? null,
      inserted: report.inserted,
      skipped: report.skipped,
      warnings: report.warnings.map((warning) => ({ sheet: warning.sheet, msg: warning.msg })),
      durationMs: report.durationMs,
    },
    null,
    2,
  ),
)
