import { Router, type Router as RouterType, type Request, type Response } from 'express'
import { and, eq, asc, sql } from 'drizzle-orm'
import { z } from 'zod'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import { branches, users, userBranches } from '../../shared/db/schema.js'
import { userPrimaryRoleSql } from '../../shared/db/userViews.js'
import { peekCounter } from '../../shared/db/counters.js'
import { validate } from '../../shared/middleware/validate.js'

export const adminBranchesRouter: RouterType = Router()

// Cross-Branch PHI RFC Step 6 (reconciled): this admin endpoint lists ALL
// branches in the tenant (scoped by `tenant_id` only). `branches` rows are
// tenant-wide reference data (not branch-scoped PHI), so listing every branch
// from any caller's branch is intentional ADMIN OPERATIONAL access, not
// clinical break-glass. No `cross_branch_access_grants` row is emitted (grants
// are reserved for genuine PHI chart reveals, D1). The RFC §4.4 synthetic-grant
// approach was rejected for admin reads.
//
// All reads run inside withTenantTx: under FORCE RLS a bare read has no
// app.current_tenant_id GUC and returns zero rows (2026-06-12 review Theme B).

/** GET /api/admin/branches: list branches in the caller's tenant (bare array).
 *  Returns the public branch display_id ({tenantSlug}.{code}) as `id`; bigint PK stays internal.
 *  Query params:
 *   - includeInactive=true  → include inactive branches (default: false = active only) */
adminBranchesRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const includeInactive = req.query['includeInactive'] === 'true'

  const whereClause = includeInactive
    ? eq(branches.tenantId, tenantId)
    : and(eq(branches.tenantId, tenantId), eq(branches.isActive, true))

  const rows = await withTenantTx(
    { tenantId, userId: req.tenant.userId ?? 0, branchId: null },
    async (tx) =>
      tx
        .select({
          id: branches.displayId,
          code: branches.code,
          name: branches.name,
          isActive: branches.isActive,
          address: branches.address,
          city: branches.city,
          province: branches.province,
          contactNumber: branches.contactNumber,
          email: branches.email,
          timezone: branches.timezone,
          settings: branches.settings,
          createdAt: branches.createdAt,
          updatedAt: branches.updatedAt,
        })
        .from(branches)
        .where(whereClause)
        .orderBy(asc(branches.code)),
  )

  res.json(rows)
})

/** GET /api/admin/branches/:id: branch detail with staff roster.
 *  :id is the display_id (e.g. SVX.HST). */
adminBranchesRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id

  const idParamSchema = z.string().min(1)
  const parseResult = idParamSchema.safeParse(req.params['id'])
  if (!parseResult.success) {
    res.status(400).json({ error: 'INVALID_ID' })
    return
  }
  const displayId = parseResult.data

  // Fetch branch row + TXN counter + staff roster in a single tenant-scoped
  // read transaction. peekCounter requires a Tx but is a non-locking SELECT.
  type BranchRow = {
    id: string
    code: string
    name: string
    isActive: boolean
    address: string | null
    city: string | null
    province: string | null
    contactNumber: string | null
    email: string | null
    timezone: string | null
    settings: Record<string, unknown> | null
    createdAt: Date
    updatedAt: Date
    _pk: number
  }

  const result = await withTenantTx(
    { tenantId, userId: req.tenant.userId ?? 0, branchId: null },
    async (tx) => {
      const rows = await tx
        .select({
          id: branches.displayId,
          code: branches.code,
          name: branches.name,
          isActive: branches.isActive,
          address: branches.address,
          city: branches.city,
          province: branches.province,
          contactNumber: branches.contactNumber,
          email: branches.email,
          timezone: branches.timezone,
          settings: branches.settings,
          createdAt: branches.createdAt,
          updatedAt: branches.updatedAt,
          _pk: branches.id,
        })
        .from(branches)
        .where(and(eq(branches.tenantId, tenantId), eq(branches.displayId, displayId)))

      if (rows.length === 0) return null

      const branch = rows[0] as BranchRow

      const [txnCounterValue, staffRows] = await Promise.all([
        peekCounter(tx, {
          tenantId,
          branchId: branch._pk,
          counterKind: 'TXN',
        }),
        tx
          .select({
            displayId: users.displayId,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            isActive: users.isActive,
            role: userPrimaryRoleSql(users.id),
          })
          .from(userBranches)
          .innerJoin(users, eq(users.id, userBranches.userId))
          .where(and(eq(userBranches.branchId, branch._pk), eq(userBranches.tenantId, tenantId)))
          .orderBy(asc(users.lastName), asc(users.firstName)),
      ])

      return { branch, txnCounterValue, staffRows }
    },
  )

  if (!result) {
    res.status(404).json({ error: 'BRANCH_NOT_FOUND' })
    return
  }
  const { branch, txnCounterValue, staffRows } = result

  const staff = staffRows.map((s) => ({
    displayId: s.displayId,
    name: `${s.firstName} ${s.lastName}`.trim(),
    email: s.email,
    role: s.role,
    isActive: s.isActive,
  }))

  const activeStaffCount = staff.filter((s) => s.isActive).length

  // Omit internal bigint PK from response
  const { _pk: _ignored, ...branchFields } = branch

  res.json({
    ...branchFields,
    staffCount: staff.length,
    activeStaffCount,
    staff,
    txnCounter: { kind: 'TXN', currentValue: txnCounterValue },
  })
})

// ── Branch receipt configuration ───────────────────────────────────────────────
//
// `branches.settings` (jsonb) is read by `extractBranchReceiptConfig`
// (apps/backend/src/modules/transactions/db.ts, ~line 581): a branch prints
// acknowledgement receipts unless `settings.receipt.bir.tin` is a non-empty
// string, in which case every receipt for that branch flips to BIR-official
// mode. This endpoint is the only write path for that block.
//
// The reader's own `BranchReceiptConfig` type draws the required/optional line
// for us: `tin` / `registeredName` / `permitNo` are typed as plain `string`
// there, `accreditationNo` / `orSeries` as `string | null`. This schema mirrors
// that split, so flipping to `bir_official` requires the three statutory core
// fields but not the two the reader already treats as optional. A half-filled
// config that flips the mode is worse than none: the receipt would print as
// "Official" with the TIN or registered-name line blank.
const branchReceiptConfigSchema = z
  .object({
    mode: z.enum(['acknowledgement', 'bir_official']),
    tin: z.string().trim().max(50).nullable().optional(),
    registeredName: z.string().trim().max(200).nullable().optional(),
    permitNo: z.string().trim().max(100).nullable().optional(),
    accreditationNo: z.string().trim().max(100).nullable().optional(),
    orSeries: z.string().trim().max(100).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode !== 'bir_official') return
    if (!val.tin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tin'],
        message: 'TIN is required to enable BIR official mode',
      })
    }
    if (!val.registeredName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['registeredName'],
        message: 'Registered name is required to enable BIR official mode',
      })
    }
    if (!val.permitNo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['permitNo'],
        message: 'Permit or ATP number is required to enable BIR official mode',
      })
    }
  })

/** PATCH /api/admin/branches/:id/receipt-config: write `settings.receipt.bir`.
 *  :id is the display_id. Flipping to `bir_official` requires tin,
 *  registeredName and permitNo; accreditationNo and orSeries stay optional
 *  (see rationale above). Flipping back to `acknowledgement` clears any
 *  previously-stored BIR block. Other keys under `settings` are preserved. */
adminBranchesRouter.patch(
  '/:id/receipt-config',
  validate(branchReceiptConfigSchema),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    if (userId === null) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }

    const idParamSchema = z.string().min(1)
    const parseResult = idParamSchema.safeParse(req.params['id'])
    if (!parseResult.success) {
      res.status(400).json({ error: 'INVALID_ID' })
      return
    }
    const displayIdParam = parseResult.data
    const body = req.body as z.infer<typeof branchReceiptConfigSchema>

    const nextBir =
      body.mode === 'bir_official'
        ? {
            tin: body.tin!,
            registeredName: body.registeredName!,
            permitNo: body.permitNo!,
            accreditationNo: body.accreditationNo || null,
            orSeries: body.orSeries || null,
          }
        : null

    // branchId: null, same tenant-wide admin operational access as the GET
    // handlers above (`branches` rows are tenant-wide reference data, not
    // branch-scoped PHI; see the file-header note).
    const result = await withTenantTx({ tenantId, userId, branchId: null }, async (tx) => {
      const [existing] = await tx
        .select({ id: branches.id, settings: branches.settings })
        .from(branches)
        .where(and(eq(branches.tenantId, tenantId), eq(branches.displayId, displayIdParam)))
        .limit(1)
      if (!existing) return null

      const currentSettings = (existing.settings ?? {}) as Record<string, unknown>
      const currentReceipt = (currentSettings['receipt'] ?? {}) as Record<string, unknown>
      const nextSettings = {
        ...currentSettings,
        receipt: { ...currentReceipt, bir: nextBir },
      }

      const [updated] = await tx
        .update(branches)
        .set({
          settings: JSON.stringify(nextSettings),
          updatedAt: new Date(),
          rowVersion: sql`${branches.rowVersion} + 1`,
        })
        .where(and(eq(branches.tenantId, tenantId), eq(branches.id, existing.id)))
        .returning({ updatedAt: branches.updatedAt, rowVersion: branches.rowVersion })
      return updated ?? null
    })

    if (!result) {
      res.status(404).json({ error: 'BRANCH_NOT_FOUND' })
      return
    }

    res.json({
      mode: body.mode,
      bir: nextBir,
      updatedAt: result.updatedAt.toISOString(),
      rowVersion: result.rowVersion,
    })
  },
)
