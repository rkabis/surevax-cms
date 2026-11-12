import type { LoadPlan, TargetTransactionItem } from './targets.js'

export type TransactionItemProjection = {
  items: TargetTransactionItem[]
  counts: {
    sourceItemRows: number
    projectedItemRows: number
    transactionsWithExactItemization: number
    transactionsWithNoSourceItems: number
    transactionsWithMismatchedItemsWithheld: number
    sourceItemRowsWithheld: number
    mixedUnitPriceGroups: number
  }
}

/**
 * Rebuild invoice detail under the transaction header's financial authority.
 *
 * Legacy `i_DosageCount` is a dose-in-series position, not a purchased
 * quantity. Each linked Immunization row is therefore one purchased unit.
 * Service identities may come from those links, but a transaction's item set
 * is admitted only when its reconstructed subtotal exactly equals the frozen
 * transaction gross. No proportional price scaling or balancing item is used.
 */
export function projectTransactionConstrainedItems(plan: LoadPlan): TransactionItemProjection {
  const transactionById = new Map(
    plan.transactions.map((transaction) => [transaction.legacyAppsheetId, transaction]),
  )
  const sourceByTransaction = new Map<string, LoadPlan['transactionItems']>()
  for (const item of plan.transactionItems) {
    if (!transactionById.has(item.transactionLegacyId)) continue
    sourceByTransaction.set(item.transactionLegacyId, [
      ...(sourceByTransaction.get(item.transactionLegacyId) ?? []),
      item,
    ])
  }

  const items: TargetTransactionItem[] = []
  let transactionsWithExactItemization = 0
  let transactionsWithNoSourceItems = 0
  let transactionsWithMismatchedItemsWithheld = 0
  let sourceItemRowsWithheld = 0
  let mixedUnitPriceGroups = 0

  for (const transaction of plan.transactions) {
    const sourceItems = sourceByTransaction.get(transaction.legacyAppsheetId) ?? []
    if (sourceItems.length === 0) {
      transactionsWithNoSourceItems += 1
      continue
    }
    const sourceSubtotal = sourceItems.reduce((sum, item) => sum + Number(item.unitPrice), 0)
    if (!moneyEqual(sourceSubtotal, Number(transaction.grossAmount))) {
      transactionsWithMismatchedItemsWithheld += 1
      sourceItemRowsWithheld += sourceItems.length
      continue
    }

    const groups = new Map<string, LoadPlan['transactionItems']>()
    for (const item of sourceItems) {
      const key = `${item.serviceId}::${item.performedByUserLegacyId ?? ''}`
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    const ordered = [...groups.values()].sort((left, right) => {
      const leftKey = `${left[0]!.serviceId}::${left[0]!.performedByUserLegacyId ?? ''}`
      const rightKey = `${right[0]!.serviceId}::${right[0]!.performedByUserLegacyId ?? ''}`
      return leftKey.localeCompare(rightKey)
    })
    for (const group of ordered) {
      const first = group[0]!
      const subtotal = group.reduce((sum, item) => sum + Number(item.unitPrice), 0)
      const prices = new Set(group.map((item) => Number(item.unitPrice).toFixed(2)))
      if (prices.size > 1) mixedUnitPriceGroups += 1
      items.push({
        displayId: first.displayId,
        tenantId: first.tenantId,
        transactionLegacyId: first.transactionLegacyId,
        serviceId: first.serviceId,
        clinicalOrderLegacyId: null,
        quantity: group.length.toFixed(2),
        unitPrice: (subtotal / group.length).toFixed(2),
        subtotal: subtotal.toFixed(2),
        discountAmount: '0.00',
        vatAmount: '0.00',
        performedByUserLegacyId: first.performedByUserLegacyId,
      })
    }
    transactionsWithExactItemization += 1
  }

  return {
    items,
    counts: {
      sourceItemRows: plan.transactionItems.length,
      projectedItemRows: items.length,
      transactionsWithExactItemization,
      transactionsWithNoSourceItems,
      transactionsWithMismatchedItemsWithheld,
      sourceItemRowsWithheld,
      mixedUnitPriceGroups,
    },
  }
}

function moneyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.005
}
