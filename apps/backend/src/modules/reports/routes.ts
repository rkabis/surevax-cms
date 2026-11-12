import { Router, type Request, type Response, type Router as RouterType } from 'express'
import { sql } from 'drizzle-orm'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import type * as SharedReports from '@surevax/shared/reports'
import type {
  ArAgingResponse,
  DailyRevenueExportResponse,
  DailyRevenueResponse,
  PaymentExceptionsResponse,
  ReportsOptionsResponse,
  UnbilledResponse,
} from '@surevax/shared/reports'
import type { AuthUser } from '../../shared/middleware/auth.js'
import { requireRole } from '../../shared/middleware/requireRole.js'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { clinicCalendarDateString } from '../../shared/utils/clinicDate.js'
import { auditLogStandalone } from '../../shared/utils/auditLog.js'
import {
  getArAging,
  getDailyRevenue,
  getPaymentExceptions,
  getReportOptions,
  getUnbilled,
} from './db.js'

const reportSchemas = createRequire(import.meta.url)(
  '@surevax/shared/reports',
) as typeof SharedReports

export const reportsRouter: RouterType = Router()

const ADMIN_ROLES = new Set(['TenantAdmin', 'BranchAdmin', 'SuperAdmin'])
const FINANCE_ROLES = new Set([...ADMIN_ROLES, 'Cashier', 'Branch'])
const ALL_REPORT_ROLES = [...FINANCE_ROLES, 'Nurse', 'Physician']

type ScopeInput = { scope: 'branch' | 'tenant'; branchId?: string }
type ResolvedScope =
  | { branchId: number | null; isAdmin: boolean }
  | { error: { status: 400 | 403 | 404; body: { error: string; code: string } } }

async function resolveScope(req: Request, input: ScopeInput): Promise<ResolvedScope> {
  const user = (req as Request & { user: AuthUser }).user
  const isAdmin = ADMIN_ROLES.has(user.role)
  if (input.scope === 'tenant' && !isAdmin) {
    return {
      error: {
        status: 403,
        body: { error: 'Tenant-wide reports require an admin role', code: 'FORBIDDEN' },
      },
    } as const
  }

  if (!input.branchId) {
    if (input.scope === 'tenant') return { branchId: null, isAdmin } as const
    if (user.branchId === null) {
      return {
        error: {
          status: 400,
          body: { error: 'A branch filter is required', code: 'BRANCH_REQUIRED' },
        },
      } as const
    }
    return { branchId: user.branchId, isAdmin } as const
  }

  const lookupBranchId = isAdmin ? null : user.branchId
  const [branch] = await withTenantTx(
    { tenantId: req.tenant.id, userId: user.id ?? 0, branchId: lookupBranchId },
    async (tx) =>
      tx.execute<{ id: number }>(sql`
      SELECT id::int AS id FROM branches
      WHERE tenant_id = ${req.tenant.id} AND display_id = ${input.branchId}
      ${!isAdmin && user.branchId !== null ? sql`AND id = ${user.branchId}` : sql``}
      LIMIT 1
    `),
  )
  if (!branch) {
    return {
      error: {
        status: 404,
        body: { error: 'Branch not found or not permitted', code: 'BRANCH_NOT_FOUND' },
      },
    } as const
  }
  return { branchId: branch.id, isAdmin } as const
}

function isScopeError(scope: ResolvedScope): scope is Extract<ResolvedScope, { error: unknown }> {
  return 'error' in scope
}

function invalidQuery(res: Response, issues: unknown) {
  res.status(400).json({ error: 'Invalid report query', code: 'INVALID_QUERY', issues })
}

function csvValue(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function dailyRevenueCsv(data: DailyRevenueResponse): string {
  const rows: unknown[][] = [
    ['Date', data.date],
    ['Branch', `${data.branch.code} - ${data.branch.name}`],
    ['Transaction net total', data.revenue.transactionNetTotal],
    ['Outstanding', data.revenue.outstanding],
    ['Actual deposits', data.deposits.total],
    ['Drawer declared', data.drawer.declaredTotal],
    ['Drawer variance', data.drawer.variance],
    [],
    ['Tender method', 'Count', 'Total'],
    ...data.tenders.map((row) => [row.method, row.count, row.total]),
  ]
  return rows.map((row) => row.map(csvValue).join(',')).join('\r\n')
}

reportsRouter.get('/options', requireRole(...ALL_REPORT_ROLES), async (req, res) => {
  const user = (req as Request & { user: AuthUser }).user
  const isAdmin = ADMIN_ROLES.has(user.role)
  const result = await getReportOptions({
    tenantId: req.tenant.id,
    userId: user.id ?? 0,
    branchId: isAdmin ? null : user.branchId,
    scope: isAdmin ? 'tenant' : 'branch',
    isAdmin,
    canViewFinancial: FINANCE_ROLES.has(user.role),
  })
  res.json(result satisfies ReportsOptionsResponse)
})

reportsRouter.get('/ar-aging', requireRole(...FINANCE_ROLES), async (req, res) => {
  const parsed = reportSchemas.arAgingQuerySchema.safeParse(req.query)
  if (!parsed.success) return invalidQuery(res, parsed.error.issues)
  const scope = await resolveScope(req, parsed.data)
  if (isScopeError(scope)) return res.status(scope.error.status).json(scope.error.body)
  const user = (req as Request & { user: AuthUser }).user
  const result = await getArAging({
    ...parsed.data,
    tenantId: req.tenant.id,
    userId: user.id ?? 0,
    branchId: scope.branchId,
  })
  res.json(result satisfies ArAgingResponse)
})

reportsRouter.get('/administered-unbilled', requireRole(...ALL_REPORT_ROLES), async (req, res) => {
  const parsed = reportSchemas.unbilledQuerySchema.safeParse(req.query)
  if (!parsed.success) return invalidQuery(res, parsed.error.issues)
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
    return invalidQuery(res, [{ message: 'from must be on or before to' }])
  }
  const scope = await resolveScope(req, parsed.data)
  if (isScopeError(scope)) return res.status(scope.error.status).json(scope.error.body)
  const user = (req as Request & { user: AuthUser }).user
  const result = await getUnbilled({
    ...parsed.data,
    tenantId: req.tenant.id,
    userId: user.id ?? 0,
    branchId: scope.branchId,
  })
  res.json(result satisfies UnbilledResponse)
})

reportsRouter.get('/payment-exceptions', requireRole(...FINANCE_ROLES), async (req, res) => {
  const parsed = reportSchemas.paymentExceptionsQuerySchema.safeParse(req.query)
  if (!parsed.success) return invalidQuery(res, parsed.error.issues)
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
    return invalidQuery(res, [{ message: 'from must be on or before to' }])
  }
  const scope = await resolveScope(req, parsed.data)
  if (isScopeError(scope)) return res.status(scope.error.status).json(scope.error.body)
  const user = (req as Request & { user: AuthUser }).user
  const result = await getPaymentExceptions({
    ...parsed.data,
    tenantId: req.tenant.id,
    userId: user.id ?? 0,
    branchId: scope.branchId,
  })
  res.json(result satisfies PaymentExceptionsResponse)
})

reportsRouter.get('/daily-revenue', requireRole(...FINANCE_ROLES), async (req, res) => {
  const parsed = reportSchemas.dailyRevenueQuerySchema.safeParse(req.query)
  if (!parsed.success) return invalidQuery(res, parsed.error.issues)
  const scope = await resolveScope(req, parsed.data)
  if (isScopeError(scope)) return res.status(scope.error.status).json(scope.error.body)
  if (scope.branchId === null) {
    return res
      .status(400)
      .json({ error: 'Daily revenue requires one branch', code: 'BRANCH_REQUIRED' })
  }
  const user = (req as Request & { user: AuthUser }).user
  const result = await getDailyRevenue({
    tenantId: req.tenant.id,
    userId: user.id ?? 0,
    branchId: scope.branchId,
    date: parsed.data.date ?? clinicCalendarDateString(),
  })
  res.json(result satisfies DailyRevenueResponse)
})

reportsRouter.post('/daily-revenue/export', requireRole(...FINANCE_ROLES), async (req, res) => {
  const parsed = reportSchemas.dailyRevenueExportBodySchema.safeParse(req.body)
  if (!parsed.success) return invalidQuery(res, parsed.error.issues)
  const scope = await resolveScope(req, parsed.data)
  if (isScopeError(scope)) return res.status(scope.error.status).json(scope.error.body)
  if (scope.branchId === null) {
    return res
      .status(400)
      .json({ error: 'Daily revenue export requires one branch', code: 'BRANCH_REQUIRED' })
  }

  const user = (req as Request & { user: AuthUser }).user
  const date = parsed.data.date ?? clinicCalendarDateString()
  const data = await getDailyRevenue({
    tenantId: req.tenant.id,
    userId: user.id ?? 0,
    branchId: scope.branchId,
    date,
  })
  const csv = dailyRevenueCsv(data)
  const sha256 = createHash('sha256').update(csv, 'utf8').digest('hex')
  const fileName = `surevax-daily-revenue-${data.branch.code}-${date}.csv`

  // Persist the semantic export event before returning the bytes. If this
  // write fails, Express returns an error and the browser never receives a
  // downloadable artifact. The content hash binds the audit row to the exact
  // server-generated CSV without retaining financial contents in the log.
  await auditLogStandalone({
    tenantId: req.tenant.id,
    userId: user.id,
    branchId: scope.branchId,
    action: 'EXPORT',
    entityType: 'day_summary',
    entityId: `${data.branch.id}:${date}`,
    metadata: {
      documentType: 'daily_revenue_csv',
      branchId: data.branch.id,
      date,
      fileName,
      sha256,
    },
    ipAddress: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  })

  res.status(201).json({
    fileName,
    contentType: 'text/csv;charset=utf-8',
    csv,
    sha256,
  } satisfies DailyRevenueExportResponse)
})
