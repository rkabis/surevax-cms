import { sql } from 'drizzle-orm'
import { db } from './index.js'
import { displayId } from '../utils/displayId.js'
import { getRequestContext } from '../middleware/requestContext.js'

/** Break-glass reason categories — mirror the
 *  `cba_grants_reason_category_check` CHECK constraint (0003_invariants.sql)
 *  and the frontend BreakGlassReveal radio enum. Keep all three in sync. */
export type CrossBranchReason =
  | 'Continuity_of_care'
  | 'Emergency'
  | 'Patient_request'
  | 'Quality_review'
  | 'Other'

/**
 * Cross-Branch PHI break-glass intent (RFC §4.4, Step 4).
 *
 * When `crossBranchRead` is supplied on a {@link TenantCtx}, the transaction
 * sets `app.cross_branch_read='true'` AND emits both an `audit_logs` row
 * (action='CROSS_BRANCH_ACCESS', every call) and a `cross_branch_access_grants`
 * row (ON CONFLICT DO NOTHING, first call only per D1) BEFORE `fn` runs, so the
 * access intent is captured even if the subsequent read throws.
 */
export type CrossBranchReadCtx = {
  reason: CrossBranchReason
  /** Required free-text justification (route Zod enforces min 10 chars). */
  reasonDetail: string
  /** patients.id (bigint) — the patient whose cross-branch chart is revealed. */
  patientId: number
  /** branches.id (bigint) — the branch whose data is being read. */
  targetBranchId: number
  /** pino-http request id; links the audit row to the grant row. */
  correlationId?: string
}

export type TenantCtx = {
  /** Tenant slug (text PK on `tenants.id`). */
  tenantId: string
  /** users.id (bigint). */
  userId: number
  /** branches.id (bigint) or null when no primary branch / cross-branch. */
  branchId: number | null
  /**
   * Optional break-glass intent. When present, this transaction reads
   * cross-branch within the tenant (sets `app.cross_branch_read='true'`) and
   * emits the audit + grant rows. `branchId` is retained as the SOURCE branch
   * (where the caller is clocked in) and recorded on the audit/grant rows.
   *
   * DEVIATION FROM RFC §4.4 (intentional, documented in gotchas.md):
   * The RFC proposed making `withTenantTx` THROW on `branchId: null` without
   * `crossBranchRead`. We do NOT adopt that throw. `branchId: null` remains the
   * established tenant-wide-read convention (auth/db.ts login lookup, fhir/db.ts,
   * getPatientDemographicProjection, idempotency.ts, seed/db.ts). Adding the
   * throw would crash login + FHIR export. `crossBranchRead` is the AUDITED
   * break-glass path; `branchId: null` keeps its tenant-wide-read meaning.
   */
  crossBranchRead?: CrossBranchReadCtx
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Opens a Drizzle transaction, sets the three RLS GUCs required by the audit
 * trigger (`app.current_tenant_id`, `app.current_user_id`,
 * `app.current_branch_id`), then delegates to `fn`.
 *
 * Use this for every tenant-scoped write. The audit trigger raises an exception
 * if `app.current_tenant_id` is NULL — this helper makes the contract
 * impossible to skip by accident.
 *
 * Null `branchId` is coerced to an empty string (matches the existing
 * convention in auth/db.ts and transactions/db.ts).
 */
export async function withTenantTx<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const requestContext = getRequestContext()
    await tx.execute(sql`select set_config('app.current_tenant_id', ${ctx.tenantId}, true)`)
    await tx.execute(sql`select set_config('app.current_user_id', ${String(ctx.userId)}, true)`)
    await tx.execute(
      sql`select set_config('app.current_branch_id', ${ctx.branchId === null ? '' : String(ctx.branchId)}, true)`,
    )
    // M12: branch_isolation no longer default-opens on empty
    // `app.current_branch_id`. A null branchId is the existing "cross-branch
    // read for this tenant" convention — preserve those semantics by
    // explicitly flagging cross_branch_read when branchId is null. Tenant
    // isolation (app.current_tenant_id) still scopes the visibility.
    //
    // Step 4: an explicit `crossBranchRead` intent ALSO opens cross-branch
    // (even when branchId is a real source branch) — this is the audited
    // break-glass path.
    const crossBranchReadFlag = ctx.crossBranchRead !== undefined || ctx.branchId === null
    await tx.execute(
      sql`select set_config('app.cross_branch_read', ${crossBranchReadFlag ? 'true' : 'false'}, true)`,
    )
    await setAuditRequestContext(tx, requestContext)
    // Emit the audit + grant BEFORE the read so intent is captured even if the
    // subsequent read errors. The audit trigger's strict-mode tenant match
    // (0024) is satisfied because app.current_tenant_id == ctx.tenantId == the
    // row's tenant_id.
    if (ctx.crossBranchRead) {
      await emitCrossBranchAccessAudit(tx, ctx, ctx.crossBranchRead)
    }
    return fn(tx)
  })
}

/**
 * Emit the break-glass audit + grant rows for a cross-branch PHI access.
 *
 * - `audit_logs`: action='CROSS_BRANCH_ACCESS', entity_type='patients',
 *   entity_id=patient bigint (text column), correlation_id, metadata jsonb
 *   {reason_category, reason_detail, source_branch_id, target_branch_id}. Fires
 *   on EVERY break-glass call (HITECH §13405(c) accounting of disclosures).
 * - `cross_branch_access_grants`: ON CONFLICT (tenant_id, target_branch_id,
 *   patient_id) DO NOTHING — D1 persistent grant, only the first access per
 *   (tenant, branch, patient) creates a row; the app re-uses it thereafter.
 *
 * ip_address / user_agent are read from the request-context GUCs already set by
 * setAuditRequestContext (NULL-safe when no request context is present).
 */
async function emitCrossBranchAccessAudit(
  tx: Tx,
  ctx: TenantCtx,
  cbr: CrossBranchReadCtx,
): Promise<void> {
  const correlationId = cbr.correlationId ?? null
  const metadata = JSON.stringify({
    reason_category: cbr.reason,
    reason_detail: cbr.reasonDetail,
    source_branch_id: ctx.branchId,
    target_branch_id: cbr.targetBranchId,
  })
  await tx.execute(sql`
    INSERT INTO audit_logs (
      tenant_id, user_id, action, entity_type, entity_id,
      branch_id, correlation_id, metadata, ip_address, user_agent
    )
    VALUES (
      ${ctx.tenantId},
      ${ctx.userId},
      'CROSS_BRANCH_ACCESS',
      'patients',
      ${String(cbr.patientId)},
      ${cbr.targetBranchId},
      ${correlationId},
      ${metadata}::jsonb,
      NULLIF(current_setting('app.current_ip_address', true), ''),
      NULLIF(current_setting('app.current_user_agent', true), '')
    )
  `)
  await tx.execute(sql`
    INSERT INTO cross_branch_access_grants (
      display_id, tenant_id, user_id, source_branch_id, target_branch_id,
      patient_id, reason_category, reason_detail, correlation_id
    )
    VALUES (
      ${displayId('CBA')},
      ${ctx.tenantId},
      ${ctx.userId},
      ${ctx.branchId},
      ${cbr.targetBranchId},
      ${cbr.patientId},
      ${cbr.reason},
      ${cbr.reasonDetail},
      ${correlationId}
    )
    ON CONFLICT (tenant_id, target_branch_id, patient_id) DO NOTHING
  `)
}

export type PlatformCtx = {
  /** platform_users.id (bigint). */
  platformUserId: number
  /** targetTenantId is required when writing to audited tenant-scoped tables.
   *  The audit trigger raises if app.current_tenant_id is unset, so any
   *  platform admin operation that touches audited rows must supply this.
   *  Cross-tenant reads (no write) can omit it — the RLS bypass handles visibility.
   */
  targetTenantId?: string
}

/**
 * Opens a Drizzle transaction for a platform (cross-tenant) operator.
 *
 * Sets `app.is_platform_admin = 'true'` so the RLS tenant_isolation policy
 * grants visibility across all tenants. Does NOT set app.current_tenant_id
 * by default — cross-tenant reads work without it.
 *
 * IMPORTANT: if fn writes to any audited table, supply `targetTenantId`.
 * The audit trigger raises when app.current_tenant_id is unset on writes.
 * Canonical: POST /api/operator/login audit log write uses targetTenantId.
 */
export async function withPlatformTx<T>(ctx: PlatformCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const requestContext = getRequestContext()
    await tx.execute(sql`select set_config('app.is_platform_admin', 'true', true)`)
    await tx.execute(
      sql`select set_config('app.current_user_id', ${String(ctx.platformUserId)}, true)`,
    )
    // Platform admin bypasses both tenant_isolation and branch_isolation via
    // `is_platform_admin='true'`. The cross_branch_read flag isn't required
    // here, but set it explicitly so behavior stays predictable if any
    // policy gets reshaped (M12 invert).
    await tx.execute(sql`select set_config('app.cross_branch_read', 'true', true)`)
    if (ctx.targetTenantId) {
      // Required when writing to audited tenant-scoped tables inside this transaction.
      await tx.execute(sql`select set_config('app.current_tenant_id', ${ctx.targetTenantId}, true)`)
    }
    await setAuditRequestContext(tx, requestContext)
    return fn(tx)
  })
}

export type SystemCtx = {
  /** Tenant slug. Required — workers acting on multiple tenants loop per-iteration. */
  tenantId: string
  /** Optional branch scope. Null = tenant-wide (sets app.cross_branch_read='true'). */
  branchId?: number | null
}

/**
 * AUTH-2: transaction helper for system-initiated work that has no HTTP request
 * context (background workers, retention jobs, middleware running before
 * authMiddleware). Same GUC trio as `withTenantTx`, with:
 *   - `app.current_user_id = ''` — the audit trigger NULLIFs this to NULL,
 *     so audit_logs.user_id records NULL for system-initiated rows (vs. a
 *     sentinel bigint that would misleadingly point at a real user).
 *   - `app.is_system = 'true'` so future policies can distinguish system writes.
 *
 * Cross-tenant work loops over tenants and calls withSystemTx per iteration —
 * the audit trigger's strict-mode tenant_id match (0024) makes one tx spanning
 * multiple tenants unsafe.
 */
export async function withSystemTx<T>(ctx: SystemCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const branchId = ctx.branchId ?? null
  return db.transaction(async (tx) => {
    const requestContext = getRequestContext()
    await tx.execute(sql`select set_config('app.current_tenant_id', ${ctx.tenantId}, true)`)
    await tx.execute(sql`select set_config('app.current_user_id', '', true)`)
    await tx.execute(
      sql`select set_config('app.current_branch_id', ${branchId === null ? '' : String(branchId)}, true)`,
    )
    await tx.execute(
      sql`select set_config('app.cross_branch_read', ${branchId === null ? 'true' : 'false'}, true)`,
    )
    await tx.execute(sql`select set_config('app.is_system', 'true', true)`)
    await setAuditRequestContext(tx, requestContext)
    return fn(tx)
  })
}

async function setAuditRequestContext(
  tx: Tx,
  requestContext: ReturnType<typeof getRequestContext>,
): Promise<void> {
  await tx.execute(
    sql`select set_config('app.current_correlation_id', ${requestContext?.correlationId ?? ''}, true)`,
  )
  await tx.execute(
    sql`select set_config('app.current_ip_address', ${requestContext?.ipAddress ?? ''}, true)`,
  )
  await tx.execute(
    sql`select set_config('app.current_user_agent', ${requestContext?.userAgent ?? ''}, true)`,
  )
}
