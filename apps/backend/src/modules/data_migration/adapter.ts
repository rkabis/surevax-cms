/** Local-only, fail-closed Drizzle writer for the migration loader. */

import { createHash } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/index.js'
import { withPlatformTx, type Tx } from '../../shared/db/withTenantTx.js'
import {
  branches,
  clinicalOrders,
  consents,
  encounters,
  patientStandingOrders,
  patientTags,
  patients,
  payerProfiles,
  payments,
  platformUsers,
  products,
  serviceCatalog,
  serviceEligibleProducts,
  servicePrices,
  staffTimeLogs,
  tagDefinitions,
  transactionItems,
  transactions,
  userBranches,
  userRoles,
  users,
} from '../../shared/db/schema.js'
import type {
  DbAdapter,
  FinancialGraph,
  FinancialGraphInsertResult,
  InsertResult,
  TableName,
} from './load.js'
import {
  drizzleMigrationLedger,
  type CanonicalTargetEvent,
  type MigrationLedger,
  type MigrationRun,
} from './migrationLedger.js'
import { migrationPayerDisplayId } from './payerReferences.js'

type LegacyRow = { legacyAppsheetId: string }
type Row = LegacyRow & Record<string, unknown>

type ServiceCatalogSemantics = {
  id: string
  code: string
  serviceType: string
  defaultRoute: string | null
  requiresStock: boolean
  isActive: boolean
}

/**
 * The seeded catalog is the canonical definition of a service. A migration may
 * reuse it by code, but only where the clinical semantics agree. Names and
 * default dose volumes are intentionally not gates: they are presentation and
 * formulation metadata which vary across the legacy sheet's brand rows.
 */
export function serviceCatalogReuseDecision(
  incoming: ServiceCatalogSemantics,
  existing: ServiceCatalogSemantics,
): { compatible: true } | { compatible: false; reason: string } {
  const differences: string[] = []
  if (incoming.code !== existing.code)
    differences.push(`code source=${incoming.code} target=${existing.code}`)
  if (serviceType(incoming.serviceType) !== existing.serviceType) {
    differences.push(
      `service type source=${serviceType(incoming.serviceType)} target=${existing.serviceType}`,
    )
  }
  // A blank legacy route is incomplete data, not a statement that the service
  // has no route. Retain the seeded clinical route as a safe enrichment. An
  // explicitly supplied but different route is a genuine semantic conflict.
  if (incoming.defaultRoute !== null && incoming.defaultRoute !== existing.defaultRoute) {
    differences.push(
      `default route source=${incoming.defaultRoute ?? 'none'} target=${existing.defaultRoute ?? 'none'}`,
    )
  }
  if (incoming.requiresStock !== existing.requiresStock) {
    differences.push(
      `stock requirement source=${incoming.requiresStock} target=${existing.requiresStock}`,
    )
  }
  if (incoming.isActive !== existing.isActive) {
    differences.push(`active status source=${incoming.isActive} target=${existing.isActive}`)
  }
  return differences.length === 0
    ? { compatible: true }
    : { compatible: false, reason: differences.join('; ') }
}

/** The importer price is open-ended; an existing interval overlaps it unless it has already ended. */
export function importedPriceOverlapsExisting(
  incomingEffectiveFrom: string,
  existingEffectiveTo: string | Date | null,
): boolean {
  if (existingEffectiveTo === null) return true
  const end =
    existingEffectiveTo instanceof Date
      ? existingEffectiveTo.toISOString().slice(0, 10)
      : existingEffectiveTo
  return end === 'infinity' || end === '+infinity' || end > incomingEffectiveFrom
}

export function importedEligibilityDefault(
  existingDefault: boolean,
  sourceDefault: boolean,
): boolean {
  // Keep the already-curated seed default. The imported product remains an
  // eligible alternative instead of creating two logical defaults.
  return sourceDefault && !existingDefault
}

function result(key: string, id: number): InsertResult {
  return { inserted: 1, idByKey: new Map([[key, id]]) }
}

/**
 * This path is deliberately limited to local/disposable development by the
 * caller's write authorization. It does not make an unlinked rerun safe: the
 * source-pack → canonical-event → target-link stage owns that future guarantee.
 */
export function drizzleAdapter(tenantId: string): DbAdapter {
  let operatorId: number | undefined
  let migrationLedger: MigrationLedger | undefined
  let migrationRun: MigrationRun | undefined
  // LoadPlan service IDs are source-facing catalog codes. They may resolve to
  // an existing seeded row whose physical id differs from that source code.
  const importedServiceIds = new Map<string, string>()
  const resolvePlatformUserId = async (): Promise<number> => {
    if (operatorId !== undefined) return operatorId
    const [operator] = await db
      .select({ id: platformUsers.id })
      .from(platformUsers)
      .where(and(eq(platformUsers.isActive, true), eq(platformUsers.canLogin, true)))
      .limit(1)
    if (!operator) throw new Error('migration requires one active platform operator')
    operatorId = operator.id
    return operator.id
  }

  const insertBatch = async <T extends LegacyRow>(
    table: TableName,
    rows: T[],
  ): Promise<InsertResult> => {
    if (rows.length === 0) return { inserted: 0, idByKey: new Map() }
    const platformUserId = await resolvePlatformUserId()
    if (migrationLedger && migrationRun) {
      const sourceRows = rows as unknown as Row[]
      const events = sourceRows.map((row) => targetEvent(table, row))
      const applied = await migrationLedger.applyTargetEvents(
        migrationRun,
        events,
        async (tx, _event, index) => insertOne(tx, table, sourceRows[index]!, importedServiceIds),
        async (tx, _event, index) =>
          resolveLinkedRowId(tx, table, sourceRows[index]!, importedServiceIds),
      )
      const idByKey = new Map<string, number>()
      let inserted = 0
      for (let index = 0; index < applied.length; index++) {
        const outcome = applied[index]!
        const row = sourceRows[index]!
        if (outcome.value === undefined) {
          throw new Error(`linked migration target could not be resolved for ${table}`)
        }
        idByKey.set(row.legacyAppsheetId, outcome.value)
        if (outcome.outcome === 'applied') inserted++
      }
      return { inserted, idByKey }
    }
    return withPlatformTx({ platformUserId, targetTenantId: tenantId }, async (tx) => {
      const idByKey = new Map<string, number>()
      for (const sourceRow of rows)
        idByKey.set(
          sourceRow.legacyAppsheetId,
          await insertOne(tx, table, sourceRow as Row, importedServiceIds),
        )
      return { inserted: rows.length, idByKey }
    })
  }

  return {
    resolvePlatformUserId: async () => resolvePlatformUserId(),
    async startMigrationRun(input) {
      if (input.tenantId !== tenantId)
        throw new Error('migration run tenant does not match adapter tenant')
      const platformUserId = await resolvePlatformUserId()
      migrationLedger ??= drizzleMigrationLedger(platformUserId)
      migrationRun = await migrationLedger.startOrResume(input)
      return migrationRun
    },
    async recordMigrationStatus(status, detail = {}) {
      if (!migrationLedger || !migrationRun) throw new Error('migration run has not been started')
      await migrationLedger.recordStatus(migrationRun, status, detail)
    },
    insertBatch,
    async insertFinancialGraph(graph: FinancialGraph): Promise<FinancialGraphInsertResult> {
      const platformUserId = await resolvePlatformUserId()
      if (migrationLedger && migrationRun) {
        const event = financialTargetEvent(graph)
        const [applied] = await migrationLedger.applyTargetEvents(
          migrationRun,
          [event],
          async (tx) => writeFinancialGraph(tx, tenantId, graph, importedServiceIds),
          async (tx) => resolveLinkedFinancialGraph(tx, tenantId, graph),
        )
        if (!applied?.value) throw new Error('linked financial graph could not be resolved')
        if (applied.outcome === 'already_linked') return applied.value
        return applied.value
      }
      return withPlatformTx({ platformUserId, targetTenantId: tenantId }, async (tx) =>
        writeFinancialGraph(tx, tenantId, graph, importedServiceIds),
      )
    },
  }
}

function targetEvent(table: TableName, row: Row): CanonicalTargetEvent {
  return {
    canonicalEventKey: `load:${table}:${row.legacyAppsheetId}`,
    eventType: `load.${table}`,
    disposition: 'SafeWrite',
    facts: {
      sourceKey: row.legacyAppsheetId,
      rowFingerprint: fingerprint(row),
    },
    ruleVersion: 'base-loader-v1',
    targetTable: table,
    targetDisplayId: targetIdentity(table, row),
    mutationKind: 'Insert',
  }
}

function financialTargetEvent(graph: FinancialGraph): CanonicalTargetEvent {
  return {
    canonicalEventKey: `load:transaction_graph:${graph.transaction.legacyAppsheetId}`,
    eventType: 'load.transaction_graph',
    disposition: 'SafeWrite',
    facts: {
      sourceKey: graph.transaction.legacyAppsheetId,
      graphFingerprint: fingerprint(graph),
      itemCount: graph.items.length,
      paymentCount: graph.payments.length,
    },
    ruleVersion: 'base-financial-graph-v1',
    targetTable: 'transactions',
    targetDisplayId: graph.transaction.displayId,
    mutationKind: 'Insert',
  }
}

function targetIdentity(table: TableName, row: Row): string {
  const displayId = row['displayId']
  if (typeof displayId === 'string' && displayId.length > 0) return displayId
  if (table === 'service_catalog') return string(row, 'id')
  if (table === 'service_prices') return `SVP_${stableId(row.legacyAppsheetId)}`
  return `legacy:${row.legacyAppsheetId}`
}

async function resolveLinkedRowId(
  tx: Tx,
  table: TableName,
  row: Row,
  importedServiceIds: Map<string, string>,
): Promise<number> {
  const tenantId = string(row, 'tenantId')
  const displayId = typeof row['displayId'] === 'string' ? row['displayId'] : null
  switch (table) {
    case 'branches':
      return requireDisplayId(tx, branches, tenantId, displayId, table)
    case 'users':
      return requireDisplayId(tx, users, tenantId, displayId, table)
    case 'products':
      return requireDisplayId(tx, products, tenantId, displayId, table)
    case 'patients':
      return requireDisplayId(tx, patients, tenantId, displayId, table)
    case 'encounters':
      return requireDisplayId(tx, encounters, tenantId, displayId, table)
    case 'patient_standing_orders':
      return requireDisplayId(tx, patientStandingOrders, tenantId, displayId, table)
    case 'clinical_orders':
      return requireDisplayId(tx, clinicalOrders, tenantId, displayId, table)
    case 'transaction_items':
      return requireDisplayId(tx, transactionItems, tenantId, displayId, table)
    case 'staff_time_logs':
      return requireDisplayId(tx, staffTimeLogs, tenantId, displayId, table)
    case 'service_catalog': {
      const sourceId = string(row, 'id')
      const code = string(row, 'code')
      const [existing] = await tx
        .select({ id: serviceCatalog.id })
        .from(serviceCatalog)
        .where(and(eq(serviceCatalog.tenantId, tenantId), eq(serviceCatalog.code, code)))
        .limit(1)
      if (!existing) throw new Error(`linked service catalog target is missing for code ${code}`)
      importedServiceIds.set(sourceId, existing.id)
      return stableId(row.legacyAppsheetId)
    }
    // These join/configuration rows are not referenced by later RowIdMap
    // stages. Their durable target link is the identity; a stable numeric
    // placeholder preserves the adapter contract without inventing a domain ID.
    case 'service_eligible_products':
    case 'service_prices':
    case 'consents':
    case 'patient_tags':
    case 'user_roles':
    case 'user_branches':
    case 'cash_drawer_sessions':
      return stableId(row.legacyAppsheetId)
    case 'transactions':
    case 'payments':
      throw new Error(`${table} must be resolved through its financial graph`)
  }
}

type DisplayIdTable = {
  id: unknown
  tenantId: unknown
  displayId: unknown
}

async function requireDisplayId(
  tx: Tx,
  table: DisplayIdTable,
  tenantId: string,
  displayId: string | null,
  tableName: string,
): Promise<number> {
  if (!displayId) throw new Error(`linked ${tableName} row has no display id`)
  const reader = tx as unknown as {
    select(fields: object): {
      from(table: object): {
        where(condition: unknown): { limit(count: number): Promise<Array<{ id: number }>> }
      }
    }
  }
  const [existing] = await reader
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.tenantId as never, tenantId), eq(table.displayId as never, displayId)))
    .limit(1)
  if (!existing) throw new Error(`linked ${tableName} target ${displayId} is missing`)
  return existing.id
}

async function writeFinancialGraph(
  tx: Tx,
  tenantId: string,
  graph: FinancialGraph,
  importedServiceIds: ReadonlyMap<string, string>,
): Promise<FinancialGraphInsertResult> {
  const paymentTotal = graph.payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
  if (!nearlyEqual(paymentTotal, Number(graph.transaction.amountPaid))) {
    throw new Error(
      `transaction ${graph.transaction.legacyAppsheetId} has payment legs that do not equal amount_paid`,
    )
  }
  const key = migrationKey('transaction', graph.transaction.legacyAppsheetId)
  const [previous] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.tenantId, tenantId), eq(transactions.idempotencyKey, key)))
    .limit(1)
  if (previous) {
    throw new Error(
      `transaction ${graph.transaction.legacyAppsheetId} exists without a matching migration target link`,
    )
  }
  const payerId = graph.transaction.payerCode
    ? await payer(tx, tenantId, graph.transaction.payerCode)
    : null
  const transactionId = await insertId(tx, transactions, {
    displayId: graph.transaction.displayId,
    tenantId,
    branchId: graph.transaction.branchId,
    patientId: graph.transaction.patientId,
    cashierId: graph.transaction.cashierId,
    payerId,
    status: graph.transaction.status,
    grossAmount: graph.transaction.grossAmount,
    discountAmount: graph.transaction.discountAmount,
    vatAmount: graph.transaction.vatAmount,
    netAmount: graph.transaction.netAmount,
    amountPaid: graph.transaction.amountPaid,
    discountIdType: graph.transaction.discountIdType,
    discountIdNumber: graph.transaction.discountIdNumber,
    idempotencyKey: key,
    transactedAt: graph.transaction.transactedAt,
  })
  const itemIds = new Map<string, number>()
  for (const item of graph.items) {
    itemIds.set(
      item.legacyAppsheetId,
      await insertId(tx, transactionItems, {
        displayId: item.displayId,
        tenantId,
        transactionId,
        serviceId: await resolveImportedServiceId(tx, tenantId, item.serviceId, importedServiceIds),
        clinicalOrderId: item.clinicalOrderId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountAmount: item.discountAmount,
        vatAmount: item.vatAmount,
        subtotal: item.subtotal,
        performedById: item.performedById,
      }),
    )
  }
  const paymentIds = new Map<string, number>()
  for (const payment of graph.payments) {
    paymentIds.set(
      payment.legacyAppsheetId,
      await insertId(tx, payments, {
        displayId: payment.displayId,
        tenantId,
        transactionId,
        method: payment.method,
        amount: payment.amount,
        referenceNumber: payment.referenceNumber,
        reconciliationStatus: payment.reconciliationStatus,
        receivedAt: payment.receivedAt,
        idempotencyKey: migrationKey('payment', payment.legacyAppsheetId),
      }),
    )
  }
  return {
    transaction: result(graph.transaction.legacyAppsheetId, transactionId),
    items: { inserted: graph.items.length, idByKey: itemIds },
    payments: { inserted: graph.payments.length, idByKey: paymentIds },
  }
}

async function resolveLinkedFinancialGraph(
  tx: Tx,
  tenantId: string,
  graph: FinancialGraph,
): Promise<FinancialGraphInsertResult> {
  const [existing] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        eq(transactions.displayId, graph.transaction.displayId),
        eq(
          transactions.idempotencyKey,
          migrationKey('transaction', graph.transaction.legacyAppsheetId),
        ),
      ),
    )
    .limit(1)
  if (!existing)
    throw new Error(`linked transaction target ${graph.transaction.displayId} is missing`)
  return {
    transaction: {
      inserted: 0,
      idByKey: new Map([[graph.transaction.legacyAppsheetId, existing.id]]),
    },
    items: { inserted: 0, idByKey: new Map() },
    payments: { inserted: 0, idByKey: new Map() },
  }
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalJson(value)))
    .digest('hex')
}

function canonicalJson(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('migration source row contains a non-finite number')
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map((item) => canonicalJson(item))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJson(item)]),
    )
  }
  throw new Error(`migration source row contains unsupported ${typeof value}`)
}

async function insertOne(
  tx: Tx,
  table: TableName,
  r: Row,
  importedServiceIds: Map<string, string>,
): Promise<number> {
  switch (table) {
    case 'branches': {
      const displayId = string(r, 'displayId')
      const [existing] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.tenantId, string(r, 'tenantId')), eq(branches.displayId, displayId)))
        .limit(1)
      if (existing) return existing.id
      return insertId(tx, branches, {
        displayId,
        tenantId: string(r, 'tenantId'),
        code: string(r, 'code'),
        name: string(r, 'name'),
        address: nullableString(r, 'address'),
        email: nullableString(r, 'email'),
        isActive: boolean(r, 'isActive'),
      })
    }
    case 'users': {
      const tenantId = string(r, 'tenantId')
      const displayId = string(r, 'displayId')
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.displayId, displayId)))
        .limit(1)
      if (existing) return existing.id
      const branchId = nullableNumber(r, 'primaryBranchId')
      const id = await insertId(tx, users, {
        displayId,
        tenantId,
        email: string(r, 'email'),
        passwordHash: string(r, 'passwordHash'),
        firstName: string(r, 'firstName'),
        lastName: string(r, 'lastName'),
        canLogin: boolean(r, 'canLogin'),
        status: string(r, 'status') as 'Active' | 'Inactive' | 'Locked' | 'PendingActivation',
        primaryBranchId: branchId,
      })
      const roles = r['roles'] as Array<
        'TenantAdmin' | 'BranchAdmin' | 'Physician' | 'Nurse' | 'Cashier' | 'Branch'
      >
      await tx
        .insert(userRoles)
        .values(roles.map((role) => ({ tenantId, userId: id, role, branchId })))
      if (branchId !== null)
        await tx.insert(userBranches).values({ tenantId, userId: id, branchId })
      return id
    }
    case 'products': {
      const tenantId = string(r, 'tenantId')
      const displayId = string(r, 'displayId')
      const [existing] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, tenantId), eq(products.displayId, displayId)))
        .limit(1)
      if (existing) return existing.id
      return insertId(tx, products, {
        displayId,
        tenantId,
        name: string(r, 'name'),
        manufacturer: nullableString(r, 'manufacturer'),
        defaultRoute: nullableString(r, 'defaultRoute') as never,
        vialVolumeMl: nullableString(r, 'vialVolumeMl'),
        isActive: boolean(r, 'isActive'),
      })
    }
    case 'service_catalog': {
      const id = string(r, 'id')
      const tenantId = string(r, 'tenantId')
      const incoming: ServiceCatalogSemantics = {
        id,
        code: string(r, 'code'),
        serviceType: string(r, 'serviceType'),
        defaultRoute: nullableString(r, 'defaultRoute'),
        requiresStock: boolean(r, 'requiresStock'),
        isActive: boolean(r, 'isActive'),
      }
      const [existing] = await tx
        .select({
          id: serviceCatalog.id,
          code: serviceCatalog.code,
          serviceType: serviceCatalog.serviceType,
          defaultRoute: serviceCatalog.defaultRoute,
          requiresStock: serviceCatalog.requiresStock,
          isActive: serviceCatalog.isActive,
        })
        .from(serviceCatalog)
        .where(and(eq(serviceCatalog.tenantId, tenantId), eq(serviceCatalog.code, incoming.code)))
        .limit(1)
      if (existing) {
        const decision = serviceCatalogReuseDecision(incoming, existing)
        if (!decision.compatible) {
          throw new Error(
            `service catalog conflict for tenant ${tenantId}, code ${incoming.code}: ${decision.reason}; refusing to overwrite seeded service ${existing.id}`,
          )
        }
        importedServiceIds.set(id, existing.id)
        return stableId(r.legacyAppsheetId)
      }
      await tx.insert(serviceCatalog).values({
        id,
        tenantId,
        code: string(r, 'code'),
        name: string(r, 'name'),
        serviceType: serviceType(string(r, 'serviceType')),
        defaultRoute: nullableString(r, 'defaultRoute') as never,
        defaultDoseVolumeMl: nullableString(r, 'defaultDoseVolumeMl'),
        isVatExempt: boolean(r, 'isVatExempt'),
        requiresStock: boolean(r, 'requiresStock'),
        isActive: boolean(r, 'isActive'),
      })
      importedServiceIds.set(id, id)
      return stableId(r.legacyAppsheetId)
    }
    case 'service_eligible_products': {
      const tenantId = string(r, 'tenantId')
      const serviceId = await resolveImportedServiceId(
        tx,
        tenantId,
        string(r, 'serviceId'),
        importedServiceIds,
      )
      const productId = number(r, 'productId')
      const [existing] = await tx
        .select({ serviceId: serviceEligibleProducts.serviceId })
        .from(serviceEligibleProducts)
        .where(
          and(
            eq(serviceEligibleProducts.tenantId, tenantId),
            eq(serviceEligibleProducts.serviceId, serviceId),
            eq(serviceEligibleProducts.productId, productId),
          ),
        )
        .limit(1)
      if (existing) return stableId(r.legacyAppsheetId)
      const sourceDefault = boolean(r, 'isDefault')
      const [existingDefault] = sourceDefault
        ? await tx
            .select({ serviceId: serviceEligibleProducts.serviceId })
            .from(serviceEligibleProducts)
            .where(
              and(
                eq(serviceEligibleProducts.tenantId, tenantId),
                eq(serviceEligibleProducts.serviceId, serviceId),
                eq(serviceEligibleProducts.isDefault, true),
              ),
            )
            .limit(1)
        : []
      await tx.insert(serviceEligibleProducts).values({
        tenantId,
        serviceId,
        productId,
        ranking: number(r, 'ranking'),
        isDefault: importedEligibilityDefault(Boolean(existingDefault), sourceDefault),
      })
      return stableId(r.legacyAppsheetId)
    }
    case 'service_prices':
      return insertServicePrice(tx, r, importedServiceIds)
    case 'patients': {
      const tenantId = string(r, 'tenantId')
      const seqName = `mrn_seq_${tenantId.toLowerCase()}`
      const [seqRow] = (await tx.execute(
        sql`SELECT nextval(${seqName}) AS next`,
      )) as unknown as Array<{ next: number | string }>
      if (!seqRow) throw new Error(`MRN sequence ${seqName} returned no value`)
      const mrn = `MRN-${String(Number(seqRow.next)).padStart(6, '0')}`
      return insertId(tx, patients, {
        displayId: string(r, 'displayId'),
        tenantId,
        mrn,
        homeBranchId: nullableNumber(r, 'homeBranchId'),
        firstName: string(r, 'firstName'),
        lastName: string(r, 'lastName'),
        middleName: nullableString(r, 'middleName'),
        dateOfBirth: nullableString(r, 'dateOfBirth'),
        sex: nullableString(r, 'sex') === 'Unknown' ? null : (nullableString(r, 'sex') as never),
        contactNumber: nullableString(r, 'contactNumber'),
        email: nullableString(r, 'email'),
        address: nullableString(r, 'address'),
        onboardingData: jsonbParam(r['onboardingData']),
        isActive: boolean(r, 'isActive'),
        createdAt: (r['createdAt'] as Date | null) ?? undefined,
      })
    }
    case 'consents':
      return insertId(tx, consents, {
        displayId: string(r, 'displayId'),
        tenantId: string(r, 'tenantId'),
        patientId: number(r, 'patientId'),
        consentType: 'legacy-import',
        scope: 'patient',
        scopeRefType: null,
        scopeRefId: null,
        consenterRelation: 'Other',
        visProvided: false,
        obtainedAt: r['obtainedAt'] as Date,
        obtainedById: number(r, 'obtainedById'),
        createdById: number(r, 'obtainedById'),
        notes:
          'Migration-only authorization approved by the app owner; not evidence of historical clinical consent.',
      })
    case 'encounters':
      return insertId(tx, encounters, {
        displayId: string(r, 'displayId'),
        tenantId: string(r, 'tenantId'),
        patientId: number(r, 'patientId'),
        branchId: number(r, 'branchId'),
        providerId: nullableNumber(r, 'providerId'),
        specialty: string(r, 'specialty') as never,
        status: string(r, 'status') as never,
        startedAt: r['startedAt'] as Date,
        completedAt: r['completedAt'] as Date | null,
        triageCategory: nullableString(r, 'triageCategory'),
        clinicalNotes: jsonbParam(r['clinicalNotes']),
        specialtyData: jsonbParam(r['specialtyData']),
      })
    case 'patient_standing_orders':
      return insertId(tx, patientStandingOrders, {
        displayId: string(r, 'displayId'),
        tenantId: string(r, 'tenantId'),
        patientId: number(r, 'patientId'),
        templateId: string(r, 'templateId'),
        initiatingEncounterId: number(r, 'initiatingEncounterId'),
        status: string(r, 'status') as never,
        startDate: r['startDate'] as Date,
        endDate: r['endDate'] as Date | null,
      })
    case 'clinical_orders':
      return insertId(tx, clinicalOrders, {
        displayId: string(r, 'displayId'),
        tenantId: string(r, 'tenantId'),
        patientId: number(r, 'patientId'),
        serviceId: await resolveImportedServiceId(
          tx,
          string(r, 'tenantId'),
          string(r, 'serviceId'),
          importedServiceIds,
        ),
        encounterId: nullableNumber(r, 'encounterId'),
        patientStandingOrderId: nullableNumber(r, 'patientStandingOrderId'),
        orderType: string(r, 'orderType') as never,
        status: string(r, 'status') as never,
        originalScheduledDate: r['originalScheduledDate'] as Date | null,
        currentScheduledDate: r['currentScheduledDate'] as Date | null,
        completedAt: r['completedAt'] as Date | null,
        completedAtUnknown: boolean(r, 'completedAtUnknown'),
        administeredById: nullableNumber(r, 'administeredById'),
        quantity: string(r, 'quantity'),
        doseNumber: nullableNumber(r, 'doseNumber'),
        administrationRoute: nullableString(r, 'administrationRoute') as never,
        administrationSite: nullableString(r, 'administrationSite'),
        indication: nullableString(r, 'indication'),
        administeredAtExternalClinic: boolean(r, 'administeredAtExternalClinic'),
        externalClinicianName: nullableString(r, 'externalClinicianName'),
        externalClinicName: nullableString(r, 'externalClinicName'),
        externalNotes: nullableString(r, 'externalNotes'),
        notes: jsonbParam(r['notes']),
        idempotencyKey: migrationKey('clinical-order', r.legacyAppsheetId),
      })
    case 'transaction_items':
      return insertId(tx, transactionItems, {
        displayId: string(r, 'displayId'),
        tenantId: string(r, 'tenantId'),
        transactionId: number(r, 'transactionId'),
        serviceId: await resolveImportedServiceId(
          tx,
          string(r, 'tenantId'),
          string(r, 'serviceId'),
          importedServiceIds,
        ),
        clinicalOrderId: nullableNumber(r, 'clinicalOrderId'),
        quantity: string(r, 'quantity'),
        unitPrice: string(r, 'unitPrice'),
        discountAmount: string(r, 'discountAmount'),
        vatAmount: string(r, 'vatAmount'),
        subtotal: string(r, 'subtotal'),
        performedById: nullableNumber(r, 'performedById'),
      })
    case 'cash_drawer_sessions':
      throw new Error(
        'cash-balance migration requires an explicitly resolved operator; it is not part of the clinical/financial cutover writer',
      )
    case 'staff_time_logs':
      return insertId(tx, staffTimeLogs, {
        displayId: string(r, 'displayId'),
        tenantId: string(r, 'tenantId'),
        userId: number(r, 'userId'),
        branchId: number(r, 'branchId'),
        clockInAt: r['clockInAt'] as Date,
        clockOutAt: r['clockOutAt'] as Date | null,
        totalHours: nullableString(r, 'totalHours'),
        notes: nullableString(r, 'notes'),
      })
    case 'patient_tags': {
      const tenantId = string(r, 'tenantId')
      const [tag] = await tx
        .select({ id: tagDefinitions.id })
        .from(tagDefinitions)
        .where(
          and(eq(tagDefinitions.tenantId, tenantId), eq(tagDefinitions.tag, string(r, 'tagCode'))),
        )
        .limit(1)
      if (!tag) throw new Error(`missing tag definition ${string(r, 'tagCode')}`)
      await tx.insert(patientTags).values({
        tenantId,
        patientId: number(r, 'patientId'),
        tagDefinitionId: tag.id,
        appliedAt: r['appliedAt'] as Date,
      })
      return stableId(r.legacyAppsheetId)
    }
    case 'user_roles':
    case 'user_branches':
    case 'transactions':
    case 'payments':
      throw new Error(`${table} must be written through its parent stage`)
  }
}

async function resolveImportedServiceId(
  tx: Tx,
  tenantId: string,
  sourceServiceId: string,
  importedServiceIds: ReadonlyMap<string, string>,
): Promise<string> {
  const mapped = importedServiceIds.get(sourceServiceId)
  if (mapped) return mapped

  // Some transaction rows point straight at a seeded diagnostic/service which
  // is deliberately not reconstructed by transformCatalog. Permit that exact
  // physical id, but do not guess from a merely similar service name.
  const [existing] = await tx
    .select({ id: serviceCatalog.id })
    .from(serviceCatalog)
    .where(and(eq(serviceCatalog.tenantId, tenantId), eq(serviceCatalog.id, sourceServiceId)))
    .limit(1)
  if (existing) return existing.id
  throw new Error(
    `unresolved service reference ${sourceServiceId} for tenant ${tenantId}; catalog stage did not establish a compatible target service`,
  )
}

async function insertServicePrice(
  tx: Tx,
  r: Row,
  importedServiceIds: ReadonlyMap<string, string>,
): Promise<number> {
  const tenantId = string(r, 'tenantId')
  const serviceId = await resolveImportedServiceId(
    tx,
    tenantId,
    string(r, 'serviceId'),
    importedServiceIds,
  )
  const payerCode = nullableString(r, 'payerCode')
  const payerDisplayId = payerCode ? migrationPayerDisplayId(payerCode) : null
  if (payerCode && !payerDisplayId) {
    throw new Error(
      `service price payer reference ${payerCode} has no approved target payer-profile mapping; withholding this price rather than creating a payer`,
    )
  }
  const payerId = payerDisplayId ? await payer(tx, tenantId, payerDisplayId) : null
  const unitPrice = string(r, 'unitPrice')
  const effectiveFrom = string(r, 'effectiveFrom')
  const dimensions = [
    eq(servicePrices.tenantId, tenantId),
    eq(servicePrices.serviceId, serviceId),
    isNull(servicePrices.branchId),
    payerId === null ? isNull(servicePrices.payerId) : eq(servicePrices.payerId, payerId),
    isNull(servicePrices.productId),
    isNull(servicePrices.patientSegment),
    isNull(servicePrices.deletedAt),
  ]
  const existing = await tx
    .select({
      displayId: servicePrices.displayId,
      unitPrice: servicePrices.unitPrice,
      effectiveFrom: servicePrices.effectiveFrom,
      effectiveTo: servicePrices.effectiveTo,
    })
    .from(servicePrices)
    .where(and(...dimensions))
  const overlap = existing.find((price) =>
    importedPriceOverlapsExisting(effectiveFrom, price.effectiveTo),
  )
  if (overlap) {
    if (sameMoney(unitPrice, overlap.unitPrice)) return stableId(r.legacyAppsheetId)
    throw new Error(
      `service price conflict for tenant ${tenantId}, service ${serviceId}, payer ${payerCode ?? 'retail'}: ` +
        `source ${unitPrice} from ${effectiveFrom} overlaps ${overlap.displayId} at ${overlap.unitPrice} from ${overlap.effectiveFrom}; refusing to replace seeded price`,
    )
  }
  return insertId(tx, servicePrices, {
    displayId: `SVP_${stableId(r.legacyAppsheetId)}`,
    tenantId,
    serviceId,
    payerId,
    unitPrice,
    effectiveFrom,
  })
}

type UntypedInsertTx = {
  insert(table: object): {
    values(values: object): { returning(fields: object): Promise<Array<{ id: number }>> }
  }
}

async function insertId(tx: Tx, table: object, values: object): Promise<number> {
  // Drizzle's table-union overload is intentionally not expressible for the
  // importer switch. The switch above remains the typed column mapping; this
  // narrow bridge only preserves its common `RETURNING id` shape.
  const writer = tx as unknown as UntypedInsertTx
  const [inserted] = await writer
    .insert(table)
    .values(values)
    .returning({ id: (table as { id: unknown }).id })
  if (!inserted) throw new Error('migration insert returned no row')
  return inserted.id
}

async function payer(tx: Tx, tenantId: string, reference: string): Promise<number> {
  const displayId = migrationPayerDisplayId(reference)
  if (!displayId) throw new Error(`unresolved payer profile ${reference}`)
  const [row] = await tx
    .select({ id: payerProfiles.id })
    .from(payerProfiles)
    .where(and(eq(payerProfiles.tenantId, tenantId), eq(payerProfiles.displayId, displayId)))
    .limit(1)
  if (!row) throw new Error(`unresolved payer profile ${reference}`)
  return row.id
}

function string(r: Row, key: string): string {
  const value = r[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`missing ${key}`)
  return value
}
function nullableString(r: Row, key: string): string | null {
  const value = r[key]
  return typeof value === 'string' ? value : null
}
function number(r: Row, key: string): number {
  const value = r[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`missing ${key}`)
  return value
}
function nullableNumber(r: Row, key: string): number | null {
  const value = r[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function boolean(r: Row, key: string): boolean {
  const value = r[key]
  if (typeof value !== 'boolean') throw new Error(`missing ${key}`)
  return value
}
function serviceType(value: string): 'Vaccine' | 'Consultation' | 'Lab' | 'Procedure' | 'Product' {
  if (value === 'LabTest' || value === 'LabBundle') return 'Lab'
  if (value === 'MedicalCertificate' || value === 'Other') return 'Procedure'
  return value as 'Vaccine' | 'Consultation'
}
function migrationKey(kind: string, id: string): string {
  return `legacy-import:${kind}:${id}`
}
function stableId(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return Math.abs(hash) || 1
}
function nearlyEqual(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005
}
function jsonbParam(value: unknown) {
  return sql`${JSON.stringify(value ?? null)}::jsonb`
}
function sameMoney(a: string, b: string): boolean {
  return Number(a).toFixed(2) === Number(b).toFixed(2)
}

export function createMemoryAdapter(): DbAdapter & {
  recorded: Array<{ table: TableName; rows: ReadonlyArray<unknown> }>
  byTable: Record<TableName, Array<{ id: number; legacyAppsheetId: string }>>
} {
  const recorded: Array<{ table: TableName; rows: ReadonlyArray<unknown> }> = []
  const byTable = {} as Record<TableName, Array<{ id: number; legacyAppsheetId: string }>>
  const seen: Record<string, true> = {}
  const counters: Record<string, number> = {}
  const insertBatch = async <T extends LegacyRow>(
    table: TableName,
    rows: T[],
  ): Promise<InsertResult> => {
    recorded.push({ table, rows })
    if (!byTable[table]) byTable[table] = []
    counters[table] ??= 0
    const idByKey = new Map<string, number>()
    let inserted = 0
    for (const row of rows) {
      const key = `${table}::${row.legacyAppsheetId}`
      const existing = byTable[table].find(
        (entry) => entry.legacyAppsheetId === row.legacyAppsheetId,
      )
      if (seen[key] && existing) {
        idByKey.set(row.legacyAppsheetId, existing.id)
        continue
      }
      const id = ++counters[table]
      byTable[table].push({ id, legacyAppsheetId: row.legacyAppsheetId })
      seen[key] = true
      idByKey.set(row.legacyAppsheetId, id)
      inserted++
    }
    return { inserted, idByKey }
  }
  return {
    recorded,
    byTable,
    async resolvePlatformUserId() {
      return 1
    },
    insertBatch,
    async insertFinancialGraph(graph) {
      const transaction = await insertBatch('transactions', [graph.transaction])
      const items = await insertBatch('transaction_items', graph.items)
      const paymentRows = await insertBatch('payments', graph.payments)
      return { transaction, items, payments: paymentRows }
    },
  }
}
