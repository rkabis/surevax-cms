// Canonical LifecycleError -> HTTP response translator.
//
// Moved here 2026-07-27 from `modules/transactions/routes.ts`, which is
// where it originally lived but was already imported cross-module by five
// other routers (scheduled_orders, patient_accounts, inventory, patients,
// encounters). Living in a feature module is why people kept reimplementing
// it locally instead of reaching into a sibling module: two of those local
// copies (scheduled_orders, patient_accounts) drifted, and one of them
// (scheduled_orders) was silently missing the `...err.details` spread. This
// file is the one obvious, neutral place to import from going forward.
// `transactions/routes.ts` keeps a re-export so existing imports (e.g.
// `inventory_transfers/routes.ts`) keep working unchanged.
import type { Response } from 'express'
import { LifecycleError } from '../../modules/transactions/db.js'

/**
 * Map a `LifecycleError` thrown by a module's db/service layer to its
 * structured HTTP response. Returns `true` if the error was handled (caller
 * should stop), `false` otherwise (caller should rethrow for the global
 * error handler).
 *
 * `err.details` carries recovery context the client needs to retry
 * successfully (e.g. the computed excess on `OVERPAYMENT_NOT_ALLOWED`, the
 * payable ceiling on `D2_CROSS_BRANCH_DEPOSIT`): always spread it into the
 * response body.
 */
export function sendLifecycleError(res: Response, err: unknown): boolean {
  if (err instanceof LifecycleError) {
    res.status(err.httpStatus).json({ error: err.message, code: err.code, ...(err.details ?? {}) })
    return true
  }
  return false
}
