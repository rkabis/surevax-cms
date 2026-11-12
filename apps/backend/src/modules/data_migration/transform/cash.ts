import { displayId } from '../../../shared/utils/displayId.js'
import { money, str, ts } from '../normalize.js'
import type { SrcCashBalanceLog } from '../types.js'
import type { TargetCashDrawerSession } from '../targets.js'

/**
 * CashBalanceLog sheet → cash_drawer_sessions (opening-float deposits).
 *
 * 10 rows of manually-entered "padding" deposits. Each becomes one closed
 * cash_drawer_session with `opening_float` = deposit and `state='Reconciled'`
 * (so the daily-reconcile worker doesn't revisit them).
 */
export function transformCashBalance(
  src: SrcCashBalanceLog[],
  tenantSlug: string,
): TargetCashDrawerSession[] {
  const out: TargetCashDrawerSession[] = []
  for (const row of src) {
    const rowId = str(row['Row ID'])
    const openedAt = ts(row.cbl_Timestamp)
    const branch = str(row.cbl_BranchRef)
    if (!rowId || !openedAt || !branch) continue
    out.push({
      displayId: displayId('CSH'),
      tenantId: tenantSlug,
      branchDisplayId: branch,
      openedByUserLegacyId: null,
      openingFloat: money(row.cbl_DepositAmount),
      state: 'Reconciled',
      openedAt,
      closedAt: openedAt,
      legacyAppsheetId: rowId,
    })
  }
  return out
}
