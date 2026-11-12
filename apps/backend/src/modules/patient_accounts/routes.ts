import { Router, type Router as RouterType, type Request, type Response } from 'express'
import type { AuthUser } from '../../shared/middleware/auth.js'
import { idempotencyKeySchema } from '../../shared/middleware/idempotency.js'
import { env } from '../../shared/config/env.js'
import { wire } from '../../contracts/wire.js'
import { payOnAccount, applyCreditOnAccount } from '../transactions/db.js'
import { sendLifecycleError } from '../../shared/lib/lifecycleError.js'
import { isCrossBranchPatient, resolvePatientBranchContext } from '../patients/db.js'
import { getPatientBalance, getPatientLedger, listReceivables } from './db.js'
import {
  patDisplayId,
  balanceQuery,
  ledgerQuery,
  receivablesQuery,
  payOnAccountBody,
  applyCreditBody,
  type PatientAccountsBalanceResponse,
  type PatientAccountsLedgerResponse,
  type PatientAccountsPayOnAccountResponse,
  type PatientAccountsApplyCreditResponse,
  type PatientAccountsReceivablesResponse,
} from './contract.js'

/**
 * Patient-keyed account routes, mounted at `/api/patients` alongside the
 * patients router (the same double-mount pattern as healthCardsRouter).
 *
 * The path shape is load-bearing: `phiAccessLog`'s PATIENT_DETAIL regex matches
 * `/api/patients/:displayId/...` and resolves the patient FK for free, so these
 * reads are logged correctly with no extra work.
 */
export const patientAccountsRouter: RouterType = Router()

/**
 * Clinic-wide receivables. Deliberately NOT under `/api/patients`: that prefix
 * would match the PATIENT_DETAIL regex with displayId='accounts-receivable',
 * the lookup would miss, and writePhiLogWithSelect returns early WITHOUT
 * inserting, so a bulk PHI read of every debtor would go silently unlogged
 * (DPA §20(c)(4)). Under its own prefix it falls through to the bulk branch and
 * is logged with a null patient_id.
 */
export const receivablesRouter: RouterType = Router()

const ADMIN_ROLES = new Set(['TenantAdmin', 'BranchAdmin', 'SuperAdmin'])

/**
 * Postgres constraint violations that surface as user-recoverable conflicts.
 * 23514 is shared by the D2 branch invariant and the negative-inventory guard;
 * 23505 is the idempotency-key partial unique index losing a race.
 */
function sendPgConflict(res: Response, err: unknown): boolean {
  const code = (err as { code?: string })?.code
  if (code === '23514') {
    res.status(409).json({
      error: 'The write violated a database invariant',
      code: 'CONSTRAINT_VIOLATION',
      ...(env.EXPOSE_ERRORS ? { detail: (err as Error).message } : {}),
    })
    return true
  }
  if (code === '23505') {
    res.status(409).json({ error: 'Duplicate request in flight', code: 'IDEMPOTENCY_CONFLICT' })
    return true
  }
  return false
}

function parsePatientId(req: Request, res: Response): string | null {
  const parsed = patDisplayId.safeParse(req.params['displayId'])
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid patient id', code: 'INVALID_ID' })
    return null
  }
  return parsed.data
}

async function requireLocalPatientWrite(
  req: Request,
  res: Response,
  patientDisplayId: string,
): Promise<boolean> {
  const patient = await resolvePatientBranchContext(patientDisplayId, req.tenant.id)
  if (!patient) {
    res.status(404).json({ error: 'Patient not found', code: 'NOT_FOUND' })
    return false
  }
  if (isCrossBranchPatient(patient.homeBranchId, req.tenant.branchId)) {
    res.status(403).json({
      error: 'Cross-branch chart access is read-only; take payment at the patient home branch',
      code: 'CROSS_BRANCH_WRITE_FORBIDDEN',
    })
    return false
  }
  return true
}

/** GET /api/patients/:displayId/balance: owed, credit held, and net position. */
patientAccountsRouter.get('/:displayId/balance', async (req: Request, res: Response) => {
  const patientDisplayId = parsePatientId(req, res)
  if (!patientDisplayId) return

  const q = balanceQuery.safeParse(req.query)
  if (!q.success) {
    res.status(400).json({ error: 'Invalid query', code: 'INVALID_QUERY' })
    return
  }

  try {
    const balance = await getPatientBalance({
      tenantId: req.tenant.id,
      // SELECT-only, so userId is just the audit-GUC sentinel (no write fires).
      userId: req.tenant.userId ?? 0,
      branchId: req.tenant.branchId,
      patientDisplayId,
      ...(q.data.asOf ? { asOf: q.data.asOf } : {}),
    })
    res.json(wire(balance) satisfies PatientAccountsBalanceResponse)
  } catch (err) {
    if (sendLifecycleError(res, err)) return
    throw err
  }
})

/** GET /api/patients/:displayId/ledger: the statement of account payload. */
patientAccountsRouter.get('/:displayId/ledger', async (req: Request, res: Response) => {
  const patientDisplayId = parsePatientId(req, res)
  if (!patientDisplayId) return

  const q = ledgerQuery.safeParse(req.query)
  if (!q.success) {
    res.status(400).json({ error: 'Invalid query', code: 'INVALID_QUERY' })
    return
  }

  try {
    const ledger = await getPatientLedger({
      tenantId: req.tenant.id,
      userId: req.tenant.userId ?? 0,
      branchId: req.tenant.branchId,
      patientDisplayId,
      ...(q.data.asOf ? { asOf: q.data.asOf } : {}),
      ...(q.data.includeSettled ? { includeSettled: q.data.includeSettled === 'true' } : {}),
    })
    res.json(wire(ledger) satisfies PatientAccountsLedgerResponse)
  } catch (err) {
    if (sendLifecycleError(res, err)) return
    throw err
  }
})

/**
 * POST /api/patients/:displayId/payments: settle a tendered amount across the
 * patient's open bills, oldest-first. Any overage is banked as patient credit
 * when `allowCredit` is set, else 422 with the computed excess.
 */
patientAccountsRouter.post('/:displayId/payments', async (req: Request, res: Response) => {
  const patientDisplayId = parsePatientId(req, res)
  if (!patientDisplayId) return

  const user = (req as Request & { user: AuthUser }).user
  if (user.id === null) {
    res.status(403).json({ error: 'Platform admins cannot take payments', code: 'FORBIDDEN' })
    return
  }
  if (req.tenant.branchId === null) {
    res.status(400).json({ error: 'A branch is required to take a payment', code: 'NO_BRANCH' })
    return
  }
  if (!(await requireLocalPatientWrite(req, res, patientDisplayId))) return

  const parsed = payOnAccountBody.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid payment',
      code: 'VALIDATION_ERROR',
      issues: parsed.error.issues,
    })
    return
  }

  // Optional Idempotency-Key header, validated with the shared schema. The
  // shared idempotency() middleware is deliberately NOT mounted: its replay body
  // cannot carry an allocation plan, and with no overage no `transactions` row
  // holds the key, so it would re-execute and double-charge.
  const rawKey = req.get('idempotency-key')
  let idempotencyKey: string | undefined
  if (rawKey !== undefined) {
    const keyParsed = idempotencyKeySchema.safeParse(rawKey)
    if (!keyParsed.success) {
      res.status(400).json({ error: 'Invalid Idempotency-Key', code: 'INVALID_IDEMPOTENCY_KEY' })
      return
    }
    idempotencyKey = keyParsed.data
  }

  try {
    const result = await payOnAccount({
      tenantId: req.tenant.id,
      userId: user.id,
      branchId: req.tenant.branchId,
      patientDisplayId,
      ...('payments' in parsed.data
        ? {
            payments: parsed.data.payments.map((payment) => ({
              method: payment.method,
              amount: payment.amount,
              referenceNumber: payment.referenceNumber ?? null,
              payerDisplayId: payment.payerId ?? null,
              notes: payment.notes ?? null,
            })),
          }
        : {
            method: parsed.data.method,
            amount: parsed.data.amount,
            referenceNumber: parsed.data.referenceNumber ?? null,
            payerDisplayId: parsed.data.payerId ?? null,
            notes: parsed.data.notes ?? null,
          }),
      allowCredit: parsed.data.allowCredit ?? false,
      // Required caller context makes a future route omission fail closed.
      // Shared `Branch` sessions must still name a real person and prove the
      // attribution with that person's PIN.
      moneyCaller: { kind: 'http', role: user.role, displayId: user.displayId },
      ...(parsed.data.attestedById ? { attestedById: parsed.data.attestedById } : {}),
      ...(parsed.data.attestationPin ? { attestationPin: parsed.data.attestationPin } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    })
    if (result.idempotentReplay) res.set('X-Idempotent-Replay', 'true')
    res.status(201).json(wire(result) satisfies PatientAccountsPayOnAccountResponse)
  } catch (err) {
    if (sendLifecycleError(res, err)) return
    if (sendPgConflict(res, err)) return
    throw err
  }
})

/**
 * POST /api/patients/:displayId/apply-credit: spend deposit credit against the
 * patient's open bills, oldest-first. Optionally scoped to one bill.
 */
patientAccountsRouter.post('/:displayId/apply-credit', async (req: Request, res: Response) => {
  const patientDisplayId = parsePatientId(req, res)
  if (!patientDisplayId) return

  const user = (req as Request & { user: AuthUser }).user
  if (user.id === null) {
    res.status(403).json({ error: 'Platform admins cannot apply credit', code: 'FORBIDDEN' })
    return
  }
  if (!(await requireLocalPatientWrite(req, res, patientDisplayId))) return

  const parsed = applyCreditBody.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request',
      code: 'VALIDATION_ERROR',
      issues: parsed.error.issues,
    })
    return
  }

  try {
    const result = await applyCreditOnAccount({
      tenantId: req.tenant.id,
      userId: user.id,
      branchId: req.tenant.branchId,
      patientDisplayId,
      transactionDisplayId: parsed.data.transactionId ?? null,
      amount: parsed.data.amount ?? null,
    })
    res.status(201).json(wire(result) satisfies PatientAccountsApplyCreditResponse)
  } catch (err) {
    if (sendLifecycleError(res, err)) return
    if (sendPgConflict(res, err)) return
    throw err
  }
})

/**
 * GET /api/accounts-receivable: who owes what, with per-bill aging.
 *
 * Branch-scoped by default. `scope=tenant` is admin-gated in-handler rather than
 * with requireRole on the mount, because the branch-scoped view must stay usable
 * by a Cashier. Tighter than listTransactions' unconditional tenant-wide read on
 * purpose: a named list of patients who owe money is a stronger disclosure than
 * a transaction list, and D2 already keeps a patient's bills at one branch.
 */
receivablesRouter.get('/', async (req: Request, res: Response) => {
  const q = receivablesQuery.safeParse(req.query)
  if (!q.success) {
    res.status(400).json({ error: 'Invalid query', code: 'INVALID_QUERY' })
    return
  }

  const user = (req as Request & { user: AuthUser }).user
  const scope = q.data.scope ?? 'branch'
  if (scope === 'tenant' && !ADMIN_ROLES.has(user.role)) {
    res.status(403).json({
      error: 'Tenant-wide receivables require an admin role',
      code: 'FORBIDDEN',
    })
    return
  }

  try {
    const result = await listReceivables({
      tenantId: req.tenant.id,
      userId: req.tenant.userId ?? 0,
      branchId: req.tenant.branchId,
      scope,
      ...(q.data.q ? { q: q.data.q } : {}),
      ...(q.data.bucket ? { bucket: q.data.bucket } : {}),
      ...(q.data.sort ? { sort: q.data.sort } : {}),
      ...(q.data.order ? { order: q.data.order } : {}),
      ...(q.data.limit ? { limit: q.data.limit } : {}),
      ...(q.data.asOf ? { asOf: q.data.asOf } : {}),
    })
    res.set('X-Total-Count', String(result.totals.patientCount))
    res.json(wire(result) satisfies PatientAccountsReceivablesResponse)
  } catch (err) {
    if (sendLifecycleError(res, err)) return
    throw err
  }
})
