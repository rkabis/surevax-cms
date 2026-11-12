/**
 * Public surface of the data_migration module.
 *
 *   import { runMigration } from './modules/data_migration/index.js'
 *   const report = await runMigration({ xlsxPath, tenantId: 'SVX', dryRun: true })
 *
 * See docs/migration/appsheet/ for the analysis, decisions, and design.
 */

export { extractFromFile, extractFromDriveSnapshot, bundleFromMap } from './extract.js'
export { runTransforms } from './transform/index.js'
export { load, type DbAdapter, type InsertResult, type TableName } from './load.js'
export { drizzleAdapter, createMemoryAdapter } from './adapter.js'
export {
  deterministicMigrationDisplayId,
  stabilizeMigrationTargetIds,
} from './deterministicTargets.js'
export { RowIdMap, type EntityKind } from './idMap.js'
export {
  sourceEnvelopeSchema,
  sourceKindSchema,
  type SourceEnvelope,
  type SourceKind,
} from './sourceEnvelope.js'
export {
  emptyEventLedger,
  type CanonicalDoseEvent,
  type CanonicalEventLedger,
  type ReconciliationException,
} from './eventLedger.js'
export {
  applyManualAugmentations,
  augmentationBundleSchema,
  manualAugmentationSchema,
  type ApplyAugmentationOptions,
  type AugmentationBundle,
  type AugmentationReferenceCatalog,
  type ManualAugmentation,
} from './manualAugmentations.js'
export {
  classifyAnimalDeathRemark,
  classifyPendingAnimalFollowup,
  classifyRemark,
  decideExternalDoseOne,
  trackerRemarkNegatesAdministration,
  type AnimalDeathRemarkDisposition,
  type ExternalDoseOneDecision,
  type PendingAnimalFollowupDecision,
  type PendingAnimalIncidentAnchor,
  type RemarkDisposition,
} from './remarkSemantics.js'
export {
  assertDevelopmentWriteAuthorized,
  developmentWriteAuthorizationSchema,
  type DevelopmentWriteAuthorization,
} from './writeAuthorization.js'
export {
  canonicalEventVersionHash,
  deterministicMigrationRunId,
  drizzleMigrationLedger,
  targetLinkIdempotencyKey,
  type CanonicalEventDisposition,
  type CanonicalTargetEvent,
  type FrozenMigrationRunInput,
  type MigrationLedger,
  type MigrationMutationKind,
  type MigrationRun,
  type MigrationRunMode,
  type MigrationRunStatus,
  type TargetEventApplyResult,
} from './migrationLedger.js'
export {
  projectCanonicalClinicalHistory,
  type CanonicalClinicalProjection,
  type ClinicalOrderProvenance,
  type ClinicalProjectionBlock,
  type ClinicalProjectionIdFactory,
  type ClinicalProjectionInput,
  type MissedEvaluationGuard,
  type PlanningAnchor,
  type ProjectedClinicalOrder,
  type ProjectedPatientStandingOrder,
  type ResolvedClinicalCourse,
} from './canonicalClinicalProjection.js'
export {
  resolveRabiesClinicalCourses,
  type CourseResolutionBlock,
  type RabiesCourseResolution,
} from './resolveRabiesClinicalCourses.js'
export { buildCanonicalClinicalPlan, type CanonicalClinicalPlan } from './clinicalMigrationPlan.js'
export {
  projectTransactionConstrainedItems,
  type TransactionItemProjection,
} from './transactionItemProjection.js'
export { projectAttendance, type AttendanceProjection } from './attendanceProjection.js'
export {
  reconcileRehearsal,
  runLocalMigrationRehearsal,
  type LocalRehearsalOptions,
  type QueueDisposition,
  type QueuePriority,
  type RehearsalInput,
  type RehearsalResult,
  type SafeQueueItem,
  type SafeRehearsalReport,
} from './rehearsal.js'
export type { LoadPlan } from './targets.js'
export type { MigrationContext, MigrationReport, SourceBundle, SheetCounts } from './types.js'

import { extractFromFile } from './extract.js'
import { runTransforms } from './transform/index.js'
import { load } from './load.js'
import { drizzleAdapter } from './adapter.js'
import { assertDevelopmentWriteAuthorized } from './writeAuthorization.js'
import type { MigrationContext, MigrationReport } from './types.js'
import type { DevelopmentWriteAuthorization } from './writeAuthorization.js'

export type RunMigrationOpts = {
  xlsxPath: string
  tenantId: string
  dryRun?: boolean
  batchSize?: number
  log?: MigrationContext['log']
  /** Substitute the adapter (tests pass createMemoryAdapter). Default is the
   *  local-only Drizzle adapter; production writes remain rejected. */
  adapter?: ReturnType<typeof drizzleAdapter>
  /** Required for any write. It cannot authorize production. */
  writeAuthorization?: DevelopmentWriteAuthorization
}

export async function runMigration(opts: RunMigrationOpts): Promise<MigrationReport> {
  assertDevelopmentWriteAuthorized(opts.dryRun ?? true, opts.writeAuthorization)
  const ctx: MigrationContext = {
    tenantId: opts.tenantId,
    platformUserId: 0,
    cutoverAt: new Date(),
    dryRun: opts.dryRun ?? true,
    batchSize: opts.batchSize ?? 1000,
    log: opts.log ?? ((event) => console.log(`[migration] ${event.level}: ${event.msg}`)),
  }
  const adapter = opts.adapter ?? drizzleAdapter(ctx.tenantId)
  if (!ctx.dryRun) {
    ctx.platformUserId = await adapter.resolvePlatformUserId(ctx.tenantId)
  }
  const src = await extractFromFile(opts.xlsxPath)
  ctx.log({ level: 'info', msg: `extracted ${Object.keys(src).length} sheets` })
  const xform = runTransforms(src, ctx.tenantId, ctx.cutoverAt)
  ctx.log({
    level: 'info',
    msg: `transformed: ${xform.plan.patients.length} patients, ${xform.plan.clinicalOrders.length} clinical orders, ${xform.plan.transactions.length} transactions, ${xform.warnings.length} warnings`,
  })
  const report = await load(xform.plan, adapter, ctx)
  report.sourceCounts = xform.sourceCounts
  for (const w of xform.warnings) {
    report.warnings.push({
      sheet: (w.source as keyof typeof report.sourceCounts) ?? 'Patient',
      row: 0,
      msg: w.msg,
    })
  }
  return report
}
