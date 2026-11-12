import { createHash } from 'node:crypto'
import type { DisplayPrefix } from '../../shared/utils/displayId.js'
import type { LoadPlan } from './targets.js'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Migration targets must be stable across fresh processes. The normal runtime
 * displayId() helper is intentionally random, but random IDs make a frozen
 * source pack impossible to resume because its canonical target identity
 * changes on every extraction.
 */
export function deterministicMigrationDisplayId(prefix: DisplayPrefix, stableKey: string): string {
  if (!stableKey.trim()) throw new Error('deterministic migration display id requires a stable key')
  const digest = createHash('sha256').update(`${prefix}\0${stableKey}`).digest()
  let value = 0n
  for (const byte of digest.subarray(0, 5)) value = (value << 8n) | BigInt(byte)
  let suffix = ''
  for (let index = 0; index < 8; index++) {
    suffix = CROCKFORD[Number(value & 31n)] + suffix
    value >>= 5n
  }
  return `${prefix}_${suffix}`
}

/** Return a new plan whose externally visible target IDs are retry-stable. */
export function stabilizeMigrationTargetIds(plan: LoadPlan): LoadPlan {
  const userIds = allocateDeterministicIds(
    'USR',
    plan.users.map((row) => row.legacyAppsheetId),
  )
  const productIds = allocateDeterministicIds(
    'PRD',
    plan.products.map((row) => row.legacyAppsheetId),
  )
  const patientIds = allocateDeterministicIds(
    'PAT',
    plan.patients.map((row) => row.legacyAppsheetId),
  )
  const consentIds = allocateDeterministicIds(
    'CNS',
    plan.legacyImportConsents.map((row) => row.legacyAppsheetId),
  )
  const encounterIds = allocateDeterministicIds(
    'ENC',
    plan.encounters.map((row) => row.legacyAppsheetId),
  )
  const psoIds = allocateDeterministicIds(
    'PSO',
    plan.patientStandingOrders.map((row) => row.legacyAppsheetId),
  )
  const orderIds = allocateDeterministicIds(
    'ORD',
    plan.clinicalOrders.map((row) => row.legacyAppsheetId),
  )
  const transactionIds = allocateDeterministicIds(
    'TXN',
    plan.transactions.map((row) => row.legacyAppsheetId),
  )
  const cashIds = allocateDeterministicIds(
    'CSH',
    plan.cashDrawerSessions.map((row) => row.legacyAppsheetId),
  )
  const timeLogIds = allocateDeterministicIds(
    'TLG',
    plan.staffTimeLogs.map((row) => row.legacyAppsheetId),
  )
  const stabilized: LoadPlan = {
    ...plan,
    branches: plan.branches.map((row) => ({ ...row })),
    users: plan.users.map((row) => ({
      ...row,
      displayId: userIds.get(row.legacyAppsheetId)!,
    })),
    products: plan.products.map((row) => ({
      ...row,
      displayId: productIds.get(row.legacyAppsheetId)!,
    })),
    services: plan.services.map((row) => ({ ...row })),
    serviceEligibleProducts: plan.serviceEligibleProducts.map((row) => ({ ...row })),
    servicePrices: plan.servicePrices.map((row) => ({ ...row })),
    patients: plan.patients.map((row) => ({
      ...row,
      displayId: patientIds.get(row.legacyAppsheetId)!,
    })),
    legacyImportConsents: plan.legacyImportConsents.map((row) => ({
      ...row,
      displayId: consentIds.get(row.legacyAppsheetId)!,
    })),
    encounters: plan.encounters.map((row) => ({
      ...row,
      displayId: encounterIds.get(row.legacyAppsheetId)!,
    })),
    patientStandingOrders: plan.patientStandingOrders.map((row) => ({
      ...row,
      displayId: psoIds.get(row.legacyAppsheetId)!,
    })),
    clinicalOrders: plan.clinicalOrders.map((row) => ({
      ...row,
      displayId: orderIds.get(row.legacyAppsheetId)!,
    })),
    transactions: plan.transactions.map((row) => ({
      ...row,
      displayId: transactionIds.get(row.legacyAppsheetId)!,
    })),
    transactionItems: plan.transactionItems.map((row, index) => ({
      ...row,
      displayId: deterministicMigrationDisplayId(
        'TXI',
        `${row.transactionLegacyId}::${row.serviceId}::${index}`,
      ),
    })),
    payments: plan.payments.map((row, index) => ({
      ...row,
      displayId: deterministicMigrationDisplayId(
        'PMT',
        `${row.transactionLegacyId}::${row.method}::${index}`,
      ),
    })),
    cashDrawerSessions: plan.cashDrawerSessions.map((row) => ({
      ...row,
      displayId: cashIds.get(row.legacyAppsheetId)!,
    })),
    staffTimeLogs: plan.staffTimeLogs.map((row) => ({
      ...row,
      displayId: timeLogIds.get(row.legacyAppsheetId)!,
    })),
    patientTags: plan.patientTags.map((row) => ({ ...row })),
  }

  assertUnique(
    stabilized.users.map((row) => row.displayId),
    'users',
  )
  assertUnique(
    stabilized.products.map((row) => row.displayId),
    'products',
  )
  assertUnique(
    stabilized.patients.map((row) => row.displayId),
    'patients',
  )
  assertUnique(
    stabilized.encounters.map((row) => row.displayId),
    'encounters',
  )
  assertUnique(
    stabilized.patientStandingOrders.map((row) => row.displayId),
    'patient standing orders',
  )
  assertUnique(
    stabilized.clinicalOrders.map((row) => row.displayId),
    'clinical orders',
  )
  assertUnique(
    stabilized.transactions.map((row) => row.displayId),
    'transactions',
  )
  assertUnique(
    stabilized.transactionItems.map((row) => row.displayId),
    'transaction items',
  )
  assertUnique(
    stabilized.payments.map((row) => row.displayId),
    'payments',
  )
  assertUnique(
    stabilized.staffTimeLogs.map((row) => row.displayId),
    'staff time logs',
  )
  return stabilized
}

/**
 * Public IDs intentionally carry only 40 hash bits, so a large migration can
 * encounter a rare collision. Resolve it by stable-key order and a
 * deterministic nonce; duplicate stable keys remain a hard error.
 */
function allocateDeterministicIds(
  prefix: DisplayPrefix,
  stableKeys: readonly string[],
): Map<string, string> {
  const unique = [...new Set(stableKeys)].sort()
  if (unique.length !== stableKeys.length) {
    throw new Error(`duplicate stable migration key in ${prefix}`)
  }
  const used = new Set<string>()
  const result = new Map<string, string>()
  for (const stableKey of unique) {
    let nonce = 0
    let candidate = deterministicMigrationDisplayId(prefix, stableKey)
    while (used.has(candidate)) {
      nonce += 1
      candidate = deterministicMigrationDisplayId(prefix, `${stableKey}\0collision:${nonce}`)
    }
    used.add(candidate)
    result.set(stableKey, candidate)
  }
  return result
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`deterministic migration display id collision in ${label}`)
  }
}
