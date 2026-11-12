/**
 * Loader.
 *
 * Walks a LoadPlan in referential order, batches into chunks of ctx.batchSize,
 * writes via an injected DbAdapter (production = withPlatformTx; tests = memory).
 *
 * Idempotency: every INSERT uses ON CONFLICT (tenant_id, legacy_appsheet_id)
 * DO NOTHING (the adapter implements this). Patients hold their legacy id in
 * the in-memory RowIdMap only (A3) — patient re-import is not idempotent across
 * separate runs; fine for one-shot cutover.
 *
 * Bot-12 atomicity: transaction + its items + payments + clinical-order status
 * must land in one DB transaction in production. The memory adapter doesn't
 * model transactions; the drizzleAdapter (when implemented) groups by
 * transactionLegacyId.
 */

import { RowIdMap, type EntityKind } from './idMap.js'
import type {
  FrozenMigrationRunInput,
  MigrationRun,
  MigrationRunStatus,
} from './migrationLedger.js'
import type { LoadPlan } from './targets.js'
import type { MigrationContext, MigrationReport } from './types.js'

export type InsertResult = {
  inserted: number
  idByKey: Map<string, number>
}

export type DbAdapter = {
  resolvePlatformUserId(tenantId: string): Promise<number>
  startMigrationRun?(input: FrozenMigrationRunInput): Promise<MigrationRun>
  recordMigrationStatus?(
    status: MigrationRunStatus,
    detail?: Record<string, unknown>,
  ): Promise<void>
  insertBatch<T extends { legacyAppsheetId: string }>(
    table: TableName,
    rows: T[],
  ): Promise<InsertResult>
  /**
   * The sale header, every item and every tender leg must be durable together.
   * This deliberately is not expressible as three independent `insertBatch`
   * calls: a failure after the header would otherwise create an unauditable
   * financial orphan.
   */
  insertFinancialGraph(graph: FinancialGraph): Promise<FinancialGraphInsertResult>
}

export type MigrationLoadControl = {
  run: FrozenMigrationRunInput
}

type ResolvedTransaction = LoadPlan['transactions'][number] & {
  branchId: number
  patientId: number
  cashierId: number | null
}

type ResolvedTransactionItem = LoadPlan['transactionItems'][number] & {
  transactionId?: number
  clinicalOrderId: number | null
  performedById: number | null
  legacyAppsheetId: string
}

type ResolvedPayment = LoadPlan['payments'][number] & {
  transactionId?: number
  legacyAppsheetId: string
}

export type FinancialGraph = {
  transaction: ResolvedTransaction
  items: ResolvedTransactionItem[]
  payments: ResolvedPayment[]
}

export type FinancialGraphInsertResult = {
  transaction: InsertResult
  items: InsertResult
  payments: InsertResult
}

export type TableName =
  | 'branches'
  | 'users'
  | 'user_roles'
  | 'user_branches'
  | 'products'
  | 'service_catalog'
  | 'service_eligible_products'
  | 'service_prices'
  | 'patients'
  | 'consents'
  | 'patient_tags'
  | 'encounters'
  | 'patient_standing_orders'
  | 'clinical_orders'
  | 'transactions'
  | 'transaction_items'
  | 'payments'
  | 'cash_drawer_sessions'
  | 'staff_time_logs'

export async function load(
  plan: LoadPlan,
  adapter: DbAdapter,
  ctx: MigrationContext,
  control?: MigrationLoadControl,
): Promise<MigrationReport> {
  const start = Date.now()
  const idMap = new RowIdMap()
  const report: MigrationReport = {
    sourceCounts: {},
    inserted: {},
    skipped: {},
    warnings: [],
    durationMs: 0,
  }

  if (control) {
    if (!adapter.startMigrationRun || !adapter.recordMigrationStatus) {
      throw new Error('migration load control requires a ledger-capable adapter')
    }
    if (control.run.tenantId !== ctx.tenantId) {
      throw new Error('migration run tenant does not match the load context')
    }
    const run = await adapter.startMigrationRun(control.run)
    await adapter.recordMigrationStatus('Validated', {
      resumed: run.resumed,
      planned: loadPlanCounts(plan),
    })
    await adapter.recordMigrationStatus('Applying', { stage: 'load_plan' })
  }

  try {
    await stage(adapter, ctx, idMap, report, 'branches', 'branch', plan.branches)
    const resolvedUsers = plan.users.map((user) => ({
      ...user,
      primaryBranchId: user.primaryBranchDisplayId
        ? (idMap.get('branch', user.primaryBranchDisplayId) ?? null)
        : null,
    }))
    await stage(adapter, ctx, idMap, report, 'users', 'user', resolvedUsers)
    await stage(adapter, ctx, idMap, report, 'products', 'product', plan.products)
    await stage(adapter, ctx, idMap, report, 'service_catalog', 'service', plan.services)

    const resolvedEligible = plan.serviceEligibleProducts.map((ep) => ({
      ...ep,
      productId: idMap.require('product', ep.productLegacyId),
      legacyAppsheetId: `${ep.serviceId}::${ep.productLegacyId}`,
    }))
    await stage(adapter, ctx, idMap, report, 'service_eligible_products', null, resolvedEligible)

    const resolvedPrices = plan.servicePrices.map((sp, i) => ({
      ...sp,
      legacyAppsheetId: `${sp.serviceId}::${sp.payerCode ?? 'LIST'}::${i}`,
    }))
    await stage(adapter, ctx, idMap, report, 'service_prices', null, resolvedPrices)

    const resolvedPatients = plan.patients.map((patient) => ({
      ...patient,
      homeBranchId: patient.homeBranchDisplayId
        ? (idMap.get('branch', patient.homeBranchDisplayId) ?? null)
        : null,
    }))
    await stage(adapter, ctx, idMap, report, 'patients', 'patient', resolvedPatients)

    // E35/E38: one app-owner-approved synthetic consent per migrated patient.
    // It is a cutover authorization only, never evidence of historical consent.
    const migrationBotId = plan.patients.length > 0 ? idMap.require('user', 'AppSheetAdmin') : null
    const legacyImportConsents = plan.patients.map((patient) => ({
      displayId: `CNS_LEGACY_${patient.displayId.slice(4)}`,
      tenantId: ctx.tenantId,
      patientLegacyId: patient.legacyAppsheetId,
      patientId: idMap.require('patient', patient.legacyAppsheetId),
      obtainedAt: ctx.cutoverAt,
      obtainedByUserLegacyId: 'AppSheetAdmin',
      obtainedById: migrationBotId!,
      legacyAppsheetId: `legacy-import::${patient.legacyAppsheetId}`,
    }))
    await stage(adapter, ctx, idMap, report, 'consents', null, legacyImportConsents)

    const resolvedEncounters = plan.encounters.map((e) => ({
      ...e,
      patientId: idMap.require('patient', e.patientLegacyId),
      branchId: idMap.require('branch', e.branchDisplayId),
      providerId: e.attendingUserLegacyId
        ? (idMap.get('user', e.attendingUserLegacyId) ?? null)
        : null,
    }))
    await stage(adapter, ctx, idMap, report, 'encounters', 'encounter', resolvedEncounters)

    const resolvedPso = plan.patientStandingOrders.map((p) => ({
      ...p,
      patientId: idMap.require('patient', p.patientLegacyId),
      initiatingEncounterId: idMap.require('encounter', p.initiatingEncounterLegacyId),
    }))
    await stage(adapter, ctx, idMap, report, 'patient_standing_orders', 'pso', resolvedPso)

    const resolvedOrders = plan.clinicalOrders.map((o) => ({
      ...o,
      patientId: idMap.require('patient', o.patientLegacyId),
      encounterId: o.encounterLegacyId ? idMap.require('encounter', o.encounterLegacyId) : null,
      patientStandingOrderId: o.patientStandingOrderLegacyId
        ? (idMap.get('pso', o.patientStandingOrderLegacyId) ?? null)
        : null,
      administeredById: o.administeredByUserLegacyId
        ? (idMap.get('user', o.administeredByUserLegacyId) ?? null)
        : null,
    }))
    await stage(adapter, ctx, idMap, report, 'clinical_orders', 'immunization', resolvedOrders)

    // Chronological for branch_seq counter assignment.
    const sortedTxns = [...plan.transactions].sort(
      (a, b) => a.transactedAt.getTime() - b.transactedAt.getTime(),
    )
    const resolvedTxns = sortedTxns.map((t) => ({
      ...t,
      branchId: idMap.require('branch', t.branchDisplayId),
      patientId: idMap.require('patient', t.patientLegacyId),
      cashierId: t.cashierUserLegacyId ? (idMap.get('user', t.cashierUserLegacyId) ?? null) : null,
    }))
    const resolvedItems = plan.transactionItems.map((i, idx) => ({
      ...i,
      clinicalOrderId: i.clinicalOrderLegacyId
        ? (idMap.get('immunization', i.clinicalOrderLegacyId) ?? null)
        : null,
      performedById: i.performedByUserLegacyId
        ? (idMap.get('user', i.performedByUserLegacyId) ?? null)
        : null,
      legacyAppsheetId: `${i.transactionLegacyId}::${i.serviceId}::${idx}`,
    }))

    const resolvedPayments = plan.payments.map((p, i) => ({
      ...p,
      legacyAppsheetId: `${p.transactionLegacyId}::${p.method}::${i}`,
    }))

    await stageFinancialGraphs(
      adapter,
      ctx,
      idMap,
      report,
      resolvedTxns,
      resolvedItems,
      resolvedPayments,
    )

    // Historical item detail is appended only after the authoritative header +
    // tender graph exists. This keeps a retry from trying to recreate an
    // already-linked transaction merely because its item projection was added
    // in a later migration scope.
    const itemRows = resolvedItems.map((item) => ({
      ...item,
      transactionId: idMap.require('transaction', item.transactionLegacyId),
    }))
    await stage(adapter, ctx, idMap, report, 'transaction_items', null, itemRows)

    // CashBalanceLog is a manual balance/deposit aid, not a sale ledger. It has
    // no trustworthy operator/session linkage, so it must not fabricate a
    // cashier-owned drawer session. Preserve it for reconciliation instead.
    if (plan.cashDrawerSessions.length > 0) {
      report.warnings.push({
        sheet: 'CashBalanceLog',
        row: 0,
        msg: `${plan.cashDrawerSessions.length} legacy cash-balance rows withheld: no safe cashier/session attribution`,
      })
    }

    const resolvedShifts = plan.staffTimeLogs
      .filter((s) => idMap.get('user', s.userLegacyId) !== undefined)
      .map((s) => ({
        ...s,
        userId: idMap.require('user', s.userLegacyId),
        branchId: idMap.require('branch', s.branchDisplayId),
      }))
    await stage(adapter, ctx, idMap, report, 'staff_time_logs', 'staff_time_log', resolvedShifts)

    const resolvedTags = plan.patientTags
      .filter((t) => idMap.get('patient', t.patientLegacyId) !== undefined)
      .map((t, idx) => ({
        ...t,
        patientId: idMap.require('patient', t.patientLegacyId),
        legacyAppsheetId: `${t.patientLegacyId}::${t.tagCode}::${idx}`,
      }))
    await stage(adapter, ctx, idMap, report, 'patient_tags', null, resolvedTags)

    report.durationMs = Date.now() - start
    if (control) {
      await adapter.recordMigrationStatus!('Completed', {
        inserted: report.inserted,
        skipped: report.skipped,
        warningCount: report.warnings.length,
        durationMs: report.durationMs,
      })
    }
    return report
  } catch (error) {
    report.durationMs = Date.now() - start
    if (control && adapter.recordMigrationStatus) {
      await adapter.recordMigrationStatus('Failed', {
        error: error instanceof Error ? error.message : String(error),
        inserted: report.inserted,
        skipped: report.skipped,
        durationMs: report.durationMs,
      })
    }
    throw error
  }
}

function loadPlanCounts(plan: LoadPlan): Record<string, number> {
  return Object.fromEntries(Object.entries(plan).map(([table, rows]) => [table, rows.length]))
}

async function stageFinancialGraphs(
  adapter: DbAdapter,
  ctx: MigrationContext,
  idMap: RowIdMap,
  report: MigrationReport,
  transactions: ResolvedTransaction[],
  items: ResolvedTransactionItem[],
  payments: ResolvedPayment[],
): Promise<void> {
  report.inserted.transactions = 0
  report.inserted.transaction_items = 0
  report.inserted.payments = 0
  report.skipped.transactions = 0
  report.skipped.transaction_items = 0
  report.skipped.payments = 0

  const paymentsByTransaction = new Map<string, ResolvedPayment[]>()
  for (const payment of payments) {
    const list = paymentsByTransaction.get(payment.transactionLegacyId) ?? []
    list.push(payment)
    paymentsByTransaction.set(payment.transactionLegacyId, list)
  }

  for (const transaction of transactions) {
    const graph: FinancialGraph = {
      transaction,
      items: [],
      payments: paymentsByTransaction.get(transaction.legacyAppsheetId) ?? [],
    }
    if (ctx.dryRun) {
      const id = (report.inserted.transactions ?? 0) + 1
      idMap.put('transaction', transaction.legacyAppsheetId, id)
      report.inserted.transactions += 1
      report.inserted.payments += graph.payments.length
      continue
    }
    const result = await adapter.insertFinancialGraph(graph)
    report.inserted.transactions += result.transaction.inserted
    report.skipped.transactions += 1 - result.transaction.inserted
    report.inserted.payments += result.payments.inserted
    report.skipped.payments += graph.payments.length - result.payments.inserted
    for (const [key, id] of result.transaction.idByKey) idMap.put('transaction', key, id)
  }
}

async function stage<T extends { legacyAppsheetId: string }>(
  adapter: DbAdapter,
  ctx: MigrationContext,
  idMap: RowIdMap,
  report: MigrationReport,
  table: TableName,
  kind: EntityKind | null,
  rows: T[],
): Promise<void> {
  report.inserted[table] = 0
  report.skipped[table] = 0
  if (rows.length === 0) return
  ctx.log({ level: 'info', msg: `loading ${rows.length} into ${table}` })
  for (let i = 0; i < rows.length; i += ctx.batchSize) {
    const chunk = rows.slice(i, i + ctx.batchSize)
    if (ctx.dryRun) {
      let nextId = (report.inserted[table] ?? 0) + 1
      const idByKey = new Map<string, number>()
      for (const r of chunk) {
        idByKey.set(r.legacyAppsheetId, nextId)
        nextId++
      }
      report.inserted[table] = (report.inserted[table] ?? 0) + chunk.length
      if (kind) {
        for (const [key, id] of idByKey) idMap.put(kind, key, id)
      }
      continue
    }
    const result = await adapter.insertBatch(table, chunk)
    report.inserted[table] = (report.inserted[table] ?? 0) + result.inserted
    report.skipped[table] = (report.skipped[table] ?? 0) + (chunk.length - result.inserted)
    if (kind) {
      for (const [key, id] of result.idByKey) idMap.put(kind, key, id)
    }
  }
}
