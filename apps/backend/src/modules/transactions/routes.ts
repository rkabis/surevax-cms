import {
  Router,
  type Router as RouterType,
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import { z } from 'zod'
import { validate } from '../../shared/middleware/validate.js'
import { idempotency } from '../../shared/middleware/idempotency.js'
import type { AuthUser } from '../../shared/middleware/auth.js'
import { env } from '../../shared/config/env.js'
import { logger } from '../../shared/utils/logger.js'
import {
  listTransactions,
  getTransactionStats,
  getTransactionDayStats,
  getTransaction,
  createTransaction,
  addPayment,
  addPayments,
  voidTransaction,
  refundTransaction,
  correctPaymentMethod,
  applyPrepayment,
  LifecycleError,
  TRANSACTION_SORT_COLUMNS,
  type TransactionStatusFilter,
  type TransactionSortCol,
} from './db.js'
import { BundleFanOutError } from '../clinical_orders/bundleFanOut.js'
import { sendLifecycleError } from '../../shared/lib/lifecycleError.js'
// Schemas live in the module contract (./contract.ts) so codegen and the
// runtime validators share one source — see docs/specs/api-contract-codegen.md.
import {
  txnDisplayId,
  patientDisplayId,
  encounterDisplayId,
  paymentDisplayId,
  createTransactionSchema,
  addPaymentBodySchema,
  addPaymentBatchBodySchema,
  voidBodySchema,
  refundBodySchema,
  correctPaymentMethodBodySchema,
  applyPrepaymentBodySchema,
  type TransactionsListResponse,
  type TransactionsCreateResponse,
  type TransactionsDetailResponse,
  type TransactionsAddPaymentResponse,
  type TransactionsAddPaymentBatchResponse,
  type TransactionsVoidResponse,
  type TransactionsRefundResponse,
  type TransactionsCorrectPaymentMethodResponse,
  type TransactionsApplyPrepaymentResponse,
} from './contract.js'

export const transactionsRouter: RouterType = Router()

/**
 * A payment batch has no persisted batch identity from which all legs can be
 * reconstructed. Reject a replay key instead of returning the generic
 * single-row idempotency shape or silently allowing a duplicate tender.
 */
export function rejectUnsupportedBatchIdempotency(req: Request, res: Response, next: NextFunction) {
  if (req.get('Idempotency-Key')) {
    res.status(400).json({
      error: 'Idempotency-Key is not supported for payment batches',
      code: 'IDEMPOTENCY_UNSUPPORTED',
    })
    return
  }
  next()
}

const VALID_STATUSES = new Set(['all', 'Draft', 'Pending', 'Paid', 'Voided', 'Refunded'])

// Canonical LifecycleError → HTTP response translator now lives in
// shared/lib/lifecycleError.ts (2026-07-27) so every module has one obvious,
// neutral place to import from, instead of reaching into this feature
// module. Re-exported here (imported above) so existing imports
// (inventory_transfers/routes.ts) keep working unchanged.
export { sendLifecycleError }

type LifecycleHandlerArgs<TBody> = {
  user: AuthUser
  tenantId: string
  /** Transaction display_id parsed from :id param. */
  transactionDisplayId: string
  body: TBody
  idempotencyKey?: string
}

/** Wrap a lifecycle action as an Express handler. */
function lifecycleHandler<TBody, TResult = unknown>(
  successStatus: number,
  action: (args: LifecycleHandlerArgs<TBody>) => Promise<TResult>,
) {
  return async (req: Request, res: Response) => {
    const parsed = txnDisplayId.safeParse(req.params['id'])
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid transaction id', code: 'INVALID_ID' })
      return
    }
    const user = (req as Request & { user: AuthUser }).user
    try {
      const result = await action({
        user,
        tenantId: req.tenant.id,
        transactionDisplayId: parsed.data,
        body: req.body as TBody,
        idempotencyKey: req.idempotencyKey,
      })
      res.status(successStatus).json(result satisfies TResult)
    } catch (err) {
      if (sendLifecycleError(res, err)) return
      throw err
    }
  }
}

// Derived from the db.ts column map, not re-declared: a literal list here drifts
// the moment a sortable column is added and the route then silently ignores it.
const TRANSACTION_SORTABLE_COLUMNS = TRANSACTION_SORT_COLUMNS

/** GET /api/transactions — billing records with optional search, status filter, and sort */
transactionsRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const q = typeof req.query['q'] === 'string' ? req.query['q'] : undefined
  const statusParam = typeof req.query['status'] === 'string' ? req.query['status'] : 'all'
  const status = VALID_STATUSES.has(statusParam) ? (statusParam as TransactionStatusFilter) : 'all'

  // Filters arrive as display_ids; reject with 400 if the caller supplies a
  // value but it doesn't match the expected prefix — a silent drop would return
  // the full tenant list instead of the filtered subset the caller expected.
  const patientParam = typeof req.query['patient'] === 'string' ? req.query['patient'] : undefined
  const encounterParam =
    typeof req.query['encounter'] === 'string' ? req.query['encounter'] : undefined

  if (patientParam !== undefined) {
    const parsed = patientDisplayId.safeParse(patientParam)
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Invalid patient filter: expected PAT_ display id', code: 'INVALID_FILTER' })
      return
    }
  }
  if (encounterParam !== undefined) {
    const parsed = encounterDisplayId.safeParse(encounterParam)
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid encounter filter: expected ENC_ display id',
        code: 'INVALID_FILTER',
      })
      return
    }
  }

  const limitRaw = typeof req.query['limit'] === 'string' ? Number(req.query['limit']) : NaN
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : undefined

  const dateRaw = typeof req.query['date'] === 'string' ? req.query['date'] : undefined
  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : undefined

  const sortRaw = typeof req.query['sort'] === 'string' ? req.query['sort'] : undefined
  const sort = TRANSACTION_SORTABLE_COLUMNS.includes(sortRaw as TransactionSortCol)
    ? (sortRaw as TransactionSortCol)
    : undefined
  const orderRaw = typeof req.query['order'] === 'string' ? req.query['order'] : undefined
  const order = orderRaw === 'asc' || orderRaw === 'desc' ? orderRaw : undefined

  const [data, stats, dayStats] = await Promise.all([
    listTransactions({
      tenantId,
      q,
      status,
      // safeParse already confirmed valid above; pass through directly
      patientDisplayId: patientParam,
      encounterDisplayId: encounterParam,
      date,
      limit,
      sort,
      order,
    }),
    getTransactionStats(tenantId),
    date ? getTransactionDayStats(tenantId, date) : Promise.resolve(null),
  ])

  res.json({ data, stats, dayStats } satisfies TransactionsListResponse)
})

/** POST /api/transactions — create a new billing record (header + items) */
transactionsRouter.post(
  '/',
  // statusColumn: null — a transactions row that can be READ is a committed
  // create, so its existence is the completed operation. The previous default
  // compared `status` against a lower-case list while transaction_status is
  // capitalized (Draft/Pending/Paid/...), so nothing ever matched and a replayed
  // key answered 409 IDEMPOTENCY_IN_FLIGHT instead of replaying. In-flight
  // detection was never reachable anyway: the row is invisible until commit.
  idempotency({ tableName: 'transactions', statusColumn: null }),
  validate(createTransactionSchema),
  async (req: Request, res: Response) => {
    const user = (req as Request & { user: AuthUser }).user
    const tenantId = req.tenant.id

    if (user.id === null) {
      res
        .status(403)
        .json({ error: 'Platform admins cannot create transactions', code: 'FORBIDDEN' })
      return
    }
    if (user.branchId === null) {
      res.status(400).json({ error: 'User has no branch assignment', code: 'NO_BRANCH' })
      return
    }

    const payload = req.body as z.infer<typeof createTransactionSchema>

    try {
      const result = await createTransaction({
        tenantId,
        userId: user.id,
        branchId: user.branchId,
        moneyCaller: { kind: 'http', role: user.role, displayId: user.displayId },
        idempotencyKey: req.idempotencyKey,
        payload,
      })

      if (!result.ok) {
        res.status(result.status).json({
          error: result.error,
          code: result.code,
          ...(result.details ? { details: result.details } : {}),
        })
        return
      }

      res.status(201).json({
        id: result.id,
        status: result.status,
        receiptNo: result.receiptNo,
        paymentId: result.paymentId,
      } satisfies TransactionsCreateResponse)
    } catch (err) {
      // Bundle fan-out failure — return 409 naming the offending constituent.
      if (err instanceof BundleFanOutError) {
        res.status(409).json({
          error: err.message,
          code: `BUNDLE_${err.reason}`,
          details: { constituentServiceId: err.constituentServiceId },
        })
        return
      }
      // LifecycleErrors from nested helpers (e.g. consent revocation, FEFO) bubble up.
      if (sendLifecycleError(res, err)) return

      // Map known Postgres error codes to structured responses.
      // 23514 = check_violation — raised by the D2 branch-isolation trigger (RAISE
      //         EXCEPTION … USING ERRCODE = 'check_violation') and the negative-
      //         inventory CHECK on inventory_lot_balances.quantity_on_hand.
      // 23505 = unique_violation — e.g. a duplicate idempotency key race.
      const pgCode = (err as { code?: string }).code
      if (pgCode === '23514') {
        res.status(409).json({
          error: 'Transaction rejected by a branch or inventory constraint',
          code: 'CONSTRAINT_VIOLATION',
          ...(env.EXPOSE_ERRORS ? { detail: String(err) } : {}),
        })
        return
      }
      if (pgCode === '23505') {
        res.status(409).json({
          error: 'Duplicate transaction — a matching record already exists',
          code: 'DUPLICATE_TRANSACTION',
          ...(env.EXPOSE_ERRORS ? { detail: String(err) } : {}),
        })
        return
      }

      // Unexpected error — log server-side, return generic 500 without leaking internals.
      logger.error({ err }, 'Unexpected error in createTransaction')
      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        ...(env.EXPOSE_ERRORS ? { detail: String(err) } : {}),
      })
    }
  },
)

/** POST /api/transactions/:id/payments/batch — atomic split tender. */
transactionsRouter.post(
  '/:id/payments/batch',
  rejectUnsupportedBatchIdempotency,
  validate(addPaymentBatchBodySchema),
  lifecycleHandler<z.infer<typeof addPaymentBatchBodySchema>, TransactionsAddPaymentBatchResponse>(
    201,
    ({ user, tenantId, transactionDisplayId, body }) => {
      if (user.id === null) {
        throw new LifecycleError('Platform admins cannot record payments', 'FORBIDDEN', 403)
      }
      return addPayments({
        tenantId,
        userId: user.id,
        branchId: user.branchId,
        moneyCaller: { kind: 'http', role: user.role, displayId: user.displayId },
        transactionDisplayId,
        payments: body.payments.map((payment) => ({
          method: payment.method,
          amount: payment.amount,
          referenceNumber: payment.referenceNumber,
          payerDisplayId: payment.payerId,
          notes: payment.notes,
        })),
        attestedById: body.attestedById,
        attestationPin: body.attestationPin,
      })
    },
  ),
)

/** GET /api/transactions/:id — full detail with items, payments, parties */
transactionsRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const parsed = txnDisplayId.safeParse(req.params['id'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid transaction id', code: 'INVALID_ID' })
    return
  }

  const txn = await getTransaction({ tenantId, displayId: parsed.data })
  if (!txn) {
    res.status(404).json({ error: 'Transaction not found', code: 'NOT_FOUND' })
    return
  }

  res.json(txn satisfies TransactionsDetailResponse)
})

/** POST /api/transactions/:id/payments — record a payment, transition status */
transactionsRouter.post(
  '/:id/payments',
  // statusColumn: null is REQUIRED here — `payments` has no `status` column at
  // all (only reconciliation_status), so the default projection raised Postgres
  // 42703 and this route 500'd for every request carrying an Idempotency-Key.
  idempotency({ tableName: 'payments', statusColumn: null }),
  validate(addPaymentBodySchema),
  lifecycleHandler<z.infer<typeof addPaymentBodySchema>, TransactionsAddPaymentResponse>(
    201,
    ({ user, tenantId, transactionDisplayId, body, idempotencyKey }) => {
      if (user.id === null) {
        throw new LifecycleError('Platform admins cannot record payments', 'FORBIDDEN', 403)
      }
      return addPayment({
        tenantId,
        userId: user.id,
        branchId: user.branchId,
        moneyCaller: { kind: 'http', role: user.role, displayId: user.displayId },
        transactionDisplayId,
        method: body.method,
        amount: body.amount,
        referenceNumber: body.referenceNumber,
        payerDisplayId: body.payerId,
        notes: body.notes,
        attestedById: body.attestedById,
        attestationPin: body.attestationPin,
        idempotencyKey,
      })
    },
  ),
)

/** POST /api/transactions/:id/void — soft-cancel a non-Paid transaction */
transactionsRouter.post(
  '/:id/void',
  validate(voidBodySchema),
  lifecycleHandler<z.infer<typeof voidBodySchema>, TransactionsVoidResponse>(
    200,
    ({ user, tenantId, transactionDisplayId, body }) => {
      if (user.id === null) {
        throw new LifecycleError('Platform admins cannot void transactions', 'FORBIDDEN', 403)
      }
      return voidTransaction({
        tenantId,
        userId: user.id,
        branchId: user.branchId,
        callerRole: user.role,
        transactionDisplayId,
        reason: body.reason,
      })
    },
  ),
)

/** POST /api/transactions/:id/refund — refund a Paid transaction */
transactionsRouter.post(
  '/:id/refund',
  validate(refundBodySchema),
  lifecycleHandler<z.infer<typeof refundBodySchema>, TransactionsRefundResponse>(
    200,
    ({ user, tenantId, transactionDisplayId, body }) => {
      if (user.id === null) {
        throw new LifecycleError('Platform admins cannot refund transactions', 'FORBIDDEN', 403)
      }
      return refundTransaction({
        tenantId,
        userId: user.id,
        branchId: user.branchId,
        callerRole: user.role,
        transactionDisplayId,
        reason: body.reason,
      })
    },
  ),
)

/**
 * POST /api/transactions/:id/payments/:paymentId/correct-method, void a
 * posted payment's method and reissue the replacement. Two path params
 * (transaction + payment), so this doesn't go through `lifecycleHandler`
 * (which only parses `:id`): same shape, hand-rolled.
 */
transactionsRouter.post(
  '/:id/payments/:paymentId/correct-method',
  validate(correctPaymentMethodBodySchema),
  async (req: Request, res: Response) => {
    const txnParsed = txnDisplayId.safeParse(req.params['id'])
    if (!txnParsed.success) {
      res.status(400).json({ error: 'Invalid transaction id', code: 'INVALID_ID' })
      return
    }
    const paymentParsed = paymentDisplayId.safeParse(req.params['paymentId'])
    if (!paymentParsed.success) {
      res.status(400).json({ error: 'Invalid payment id', code: 'INVALID_ID' })
      return
    }
    const user = (req as Request & { user: AuthUser }).user
    if (user.id === null) {
      res.status(403).json({ error: 'Platform admins cannot correct payments', code: 'FORBIDDEN' })
      return
    }
    const body = req.body as z.infer<typeof correctPaymentMethodBodySchema>
    try {
      const result = await correctPaymentMethod({
        tenantId: req.tenant.id,
        userId: user.id,
        branchId: user.branchId,
        moneyCaller: { kind: 'http', role: user.role, displayId: user.displayId },
        transactionDisplayId: txnParsed.data,
        paymentDisplayId: paymentParsed.data,
        newMethod: body.newMethod,
        newReferenceNumber: body.newReferenceNumber,
        reason: body.reason,
        attestedById: body.attestedById,
        attestationPin: body.attestationPin,
      })
      res.status(200).json(result satisfies TransactionsCorrectPaymentMethodResponse)
    } catch (err) {
      if (sendLifecycleError(res, err)) return
      throw err
    }
  },
)

/** POST /api/transactions/:id/apply-prepayment — apply prepayment to consuming txn */
transactionsRouter.post(
  '/:id/apply-prepayment',
  validate(applyPrepaymentBodySchema),
  lifecycleHandler<z.infer<typeof applyPrepaymentBodySchema>, TransactionsApplyPrepaymentResponse>(
    200,
    ({ user, tenantId, transactionDisplayId, body }) => {
      if (user.id === null) {
        throw new LifecycleError('Platform admins cannot apply prepayments', 'FORBIDDEN', 403)
      }
      return applyPrepayment({
        tenantId,
        userId: user.id,
        branchId: user.branchId,
        prepaymentDisplayId: transactionDisplayId,
        consumingDisplayId: body.consumingTransactionId,
      })
    },
  ),
)
