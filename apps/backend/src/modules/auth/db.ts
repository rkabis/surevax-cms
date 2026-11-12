import { and, eq, sql } from 'drizzle-orm'
import bcrypt from 'bcrypt'
import { withTenantTx, type TenantCtx } from '../../shared/db/withTenantTx.js'
import { branches, pinAttempts, refreshTokens, userRoles, users } from '../../shared/db/schema.js'

// Precedence order — highest privilege first.
// TenantAdmin is the canonical role; SuperAdmin remains in the enum for
// back-compat (Postgres cannot remove enum values) but is not seeded.
const ROLE_PRECEDENCE = [
  'TenantAdmin',
  'SuperAdmin',
  'BranchAdmin',
  'Branch',
  'Physician',
  'Nurse',
  'Cashier',
] as const

type UserRole = (typeof ROLE_PRECEDENCE)[number]

/**
 * Read all active roles for a user from `user_roles`, pick the highest-privilege
 * one according to ROLE_PRECEDENCE. Returns null if no rows found.
 *
 * Runs outside a transaction — `user_roles` is not audited so no tenant GUC
 * required for reads.
 */
export async function findPrimaryRole(
  tenantSlug: string,
  userId: number,
): Promise<UserRole | null> {
  // branchId: null + the implicit cross_branch_read='true' allow this read to
  // pierce branch_isolation — user_roles rows for the calling user may live on
  // any branch (or none).
  const rows = await withTenantTx({ tenantId: tenantSlug, userId, branchId: null }, async (tx) =>
    tx
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.tenantId, tenantSlug),
          eq(userRoles.userId, userId),
          sql`(${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > now())`,
        ),
      ),
  )

  if (rows.length === 0) return null

  const roleSet = new Set(rows.map((r) => r.role))
  const best = ROLE_PRECEDENCE.find((r) => roleSet.has(r))
  return best ?? null
}

const LOCK_THRESHOLD = 5
const LOCK_DURATION_MINUTES = 15

/**
 * Increment failed_login_count for a user.  If the updated count reaches the
 * threshold, also set locked_until = now() + 15 minutes.
 *
 * Runs inside a tenant transaction because `users` is an audited table.
 */
export async function incrementFailedLogin(ctx: TenantCtx): Promise<void> {
  await withTenantTx(ctx, async (tx) => {
    const [row] = await tx
      .update(users)
      .set({
        failedLoginCount: sql`${users.failedLoginCount} + 1`,
      })
      .where(eq(users.id, ctx.userId))
      .returning({ failedLoginCount: users.failedLoginCount })

    if (row && row.failedLoginCount >= LOCK_THRESHOLD) {
      await tx
        .update(users)
        .set({
          lockedUntil: sql`now() + interval '${sql.raw(String(LOCK_DURATION_MINUTES))} minutes'`,
        })
        .where(eq(users.id, ctx.userId))
    }
  })
}

/**
 * Reset failed_login_count and clear locked_until on successful login.
 */
export async function resetFailedLogin(ctx: TenantCtx): Promise<void> {
  await withTenantTx(ctx, async (tx) => {
    await tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, ctx.userId))
  })
}

export type { TenantCtx }

/**
 * Shape returned by `findUserByEmail` — joins users + primary branch so the
 * caller has both the internal bigint IDs (for FK writes) and the public
 * display_id / branch.code (for JWT claims).
 */
export type AuthUserLookup = {
  id: number // users.id (bigint)
  displayId: string // users.display_id, e.g. 'USR_AAAAAAA1'
  tenantId: string // tenants.id = slug, e.g. 'SVX'
  email: string
  passwordHash: string
  firstName: string
  lastName: string
  canLogin: boolean
  lockedUntil: Date | null
  primaryBranchId: number | null
  primaryBranchCode: string | null
  /** Joined `branches.name`. Null when no primary branch. */
  primaryBranchName: string | null
  /** Joined `branches.address`. Null when no primary branch / address unset. */
  primaryBranchAddress: string | null
  /** Joined `branches.contact_number`. Null when no primary branch / contact unset. */
  primaryBranchContactNumber: string | null
}

/**
 * Find a user by email scoped to a tenant. Joins branches so the caller can
 * populate the JWT payload's `branchCode` without a second query.
 */
export async function findUserByEmail(
  email: string,
  tenantSlug: string,
): Promise<AuthUserLookup | null> {
  // AUTH-2: pre-auth path. userId=0 (no caller yet) is OK because the audit
  // trigger only fires on row mutations and this is SELECT-only. branchId=null
  // + cross_branch_read='true' lets the lookup find users on any branch.
  const [row] = await withTenantTx(
    { tenantId: tenantSlug, userId: 0, branchId: null },
    async (tx) =>
      tx
        .select({
          id: users.id,
          displayId: users.displayId,
          tenantId: users.tenantId,
          email: users.email,
          passwordHash: users.passwordHash,
          firstName: users.firstName,
          lastName: users.lastName,
          canLogin: users.canLogin,
          lockedUntil: users.lockedUntil,
          primaryBranchId: users.primaryBranchId,
          primaryBranchCode: branches.code,
          primaryBranchName: branches.name,
          primaryBranchAddress: branches.address,
          primaryBranchContactNumber: branches.contactNumber,
        })
        .from(users)
        .leftJoin(branches, eq(branches.id, users.primaryBranchId))
        .where(and(eq(users.email, email), eq(users.tenantId, tenantSlug)))
        .limit(1),
  )

  return row ?? null
}

/**
 * Resolve a user by display_id (used by authMiddleware to populate req.user
 * with bigint IDs after verifying the JWT).
 */
export async function findUserByDisplayId(
  displayId: string,
  tenantSlug: string,
): Promise<AuthUserLookup | null> {
  // AUTH-2: authMiddleware calls this on every request before req.user is
  // populated, so userId=0 is the right sentinel. branchId=null lets us find
  // a user whose primary branch differs from the request branch.
  const [row] = await withTenantTx(
    { tenantId: tenantSlug, userId: 0, branchId: null },
    async (tx) =>
      tx
        .select({
          id: users.id,
          displayId: users.displayId,
          tenantId: users.tenantId,
          email: users.email,
          passwordHash: users.passwordHash,
          firstName: users.firstName,
          lastName: users.lastName,
          canLogin: users.canLogin,
          lockedUntil: users.lockedUntil,
          primaryBranchId: users.primaryBranchId,
          primaryBranchCode: branches.code,
          primaryBranchName: branches.name,
          primaryBranchAddress: branches.address,
          primaryBranchContactNumber: branches.contactNumber,
        })
        .from(users)
        .leftJoin(branches, eq(branches.id, users.primaryBranchId))
        .where(and(eq(users.displayId, displayId), eq(users.tenantId, tenantSlug)))
        .limit(1),
  )

  return row ?? null
}

/**
 * Update users.last_login_at after a successful auth.
 */
export async function updateLastLogin(ctx: TenantCtx) {
  await withTenantTx(ctx, async (tx) => {
    await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, ctx.userId))
  })
}

// ---------------------------------------------------------------------------
// Refresh-token rotation + family revocation
// ---------------------------------------------------------------------------

type InsertRefreshTokenArgs = TenantCtx & {
  jti: string
  familyId: string
  expiresAt: Date
}

export async function insertRefreshToken(args: InsertRefreshTokenArgs) {
  return withTenantTx(args, async (tx) => {
    const [row] = await tx
      .insert(refreshTokens)
      .values({
        tenantId: args.tenantId,
        userId: args.userId,
        jti: args.jti,
        familyId: args.familyId,
        expiresAt: args.expiresAt,
      })
      .returning()
    return row
  })
}

export type RefreshTokenRow = typeof refreshTokens.$inferSelect

export async function findRefreshTokenByJti(
  jti: string,
  ctx: TenantCtx,
): Promise<RefreshTokenRow | null> {
  // M6: bind jti to userId so a leaked jti from another tenant/user is
  // rejected even before the row-level RLS check. Defense-in-depth.
  return withTenantTx(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.jti, jti), eq(refreshTokens.userId, ctx.userId)))
      .limit(1)
    return row ?? null
  })
}

/**
 * CONC-3 fix: atomically lock + validate + rotate a refresh token in a single
 * transaction to prevent parallel replay attacks (double-spend).
 *
 * Uses `SELECT … FOR UPDATE` on the old token row to serialise concurrent
 * refreshes for the same jti. Both the new token insert and the old token
 * mark-replaced happen inside the same withTenantTx so they are atomic.
 *
 * Returns:
 *   - { status: 'ok', oldRow, newRow } on success
 *   - { status: 'not_found' } when jti is unknown / wrong user
 *   - { status: 'reused', oldRow } when the old token was already revoked
 *   - { status: 'expired' } when the token is past its expiry
 */
export type RotateResult =
  | { status: 'ok'; oldRow: RefreshTokenRow; newRow: RefreshTokenRow }
  | { status: 'not_found' }
  | { status: 'reused'; oldRow: RefreshTokenRow }
  | { status: 'expired' }

export async function rotateRefreshTokenAtomic(
  jti: string,
  ctx: TenantCtx,
  newJti: string,
  expiresAt: Date,
): Promise<RotateResult> {
  return withTenantTx(ctx, async (tx) => {
    // Lock the row so concurrent replays of the same jti are serialized.
    // SKIP LOCKED is intentionally NOT used: we want the second concurrent
    // request to wait and then see revokedAt is set, triggering family revocation.
    // Use Drizzle's .for('update') (not raw tx.execute) so columns deserialize
    // to camelCase (raw SQL returns snake_case → revokedAt/familyId would be
    // undefined and the rotated-row insert would violate NOT NULL on family_id).
    const [oldRow] = await tx
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.jti, jti), eq(refreshTokens.userId, ctx.userId)))
      .limit(1)
      .for('update')

    if (!oldRow) return { status: 'not_found' }

    if (oldRow.revokedAt) {
      return { status: 'reused', oldRow }
    }

    if (new Date(oldRow.expiresAt).getTime() <= Date.now()) {
      return { status: 'expired' }
    }

    // Insert the new token in the same family.
    const [newRow] = await tx
      .insert(refreshTokens)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        jti: newJti,
        familyId: oldRow.familyId,
        expiresAt,
      })
      .returning()

    if (!newRow) {
      // Should never happen (unique jti constraint would throw, not return null)
      throw new Error('Failed to insert rotated refresh token')
    }

    // Mark the old token replaced in the same transaction.
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedById: newRow.id })
      .where(eq(refreshTokens.id, oldRow.id))

    return { status: 'ok', oldRow, newRow }
  })
}

export async function revokeFamily(familyId: string, ctx: TenantCtx) {
  await withTenantTx(ctx, async (tx) => {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.familyId, familyId))
  })
}

export async function markReplaced(oldId: number, newId: number, ctx: TenantCtx) {
  await withTenantTx(ctx, async (tx) => {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedById: newId })
      .where(eq(refreshTokens.id, oldId))
  })
}

export async function revokeRefreshToken(id: number, ctx: TenantCtx) {
  await withTenantTx(ctx, async (tx) => {
    await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, id))
  })
}

// ---------------------------------------------------------------------------
// Kiosk PIN attempt lockout — DB-backed (H3).
// Replaces the process-local Map<string, PinAttemptRecord> in auth/routes.ts.
// ---------------------------------------------------------------------------

const PIN_DB_LOCK_1 = 5 // threshold 1: 60-second lockout
const PIN_DB_LOCK_2 = 10 // threshold 2: 5-minute lockout
const PIN_DB_LOCK_PERM = 20 // threshold 3 (M5): permanent — admin must unlock
const PIN_DB_LOCK_1_SECS = 60
const PIN_DB_LOCK_2_SECS = 300
// M5: "permanent" = ~100 years in the future. Distinguishable from a
// short-lived lockout via comparison to now() + 1 year and unambiguous in
// admin UI ("locked indefinitely until cleared"). Real unlock requires an
// admin to DELETE the pin_attempts row or set lockedUntil = NULL.
const PIN_DB_LOCK_PERM_MS = 100 * 365 * 24 * 60 * 60 * 1000

export type PinAttemptRow = {
  failedCount: number
  lockedUntil: Date | null
}

/**
 * Retrieve the current PIN-attempt record for a user (by bigint user_id).
 * Returns null when no record exists (i.e. the user has never failed a PIN).
 * Reads via RLS-protected SELECT — needs the tenant GUC set.
 */
export async function getPinAttempt(
  tenantId: string,
  userId: number,
): Promise<PinAttemptRow | null> {
  return withTenantTx({ tenantId, userId, branchId: null }, async (tx) => {
    const [row] = await tx
      .select({ failedCount: pinAttempts.failedCount, lockedUntil: pinAttempts.lockedUntil })
      .from(pinAttempts)
      .where(and(eq(pinAttempts.tenantId, tenantId), eq(pinAttempts.userId, userId)))
      .limit(1)
    return row ?? null
  })
}

/**
 * Increment the failed-PIN count for a user (UPSERT).
 * Applies the two-tier lockout:
 *   ≥ PIN_DB_LOCK_1 (5)  → locked for 60 s
 *   ≥ PIN_DB_LOCK_2 (10) → locked for 5 min
 * Returns the updated locked_until value (null if still below threshold).
 */
export async function recordPinFailure(
  tenantId: string,
  userId: number,
): Promise<{ lockedUntil: Date | null }> {
  return withTenantTx({ tenantId, userId, branchId: null }, async (tx) => {
    // Upsert: create on first failure, increment on subsequent.
    const [row] = await tx
      .insert(pinAttempts)
      .values({
        tenantId,
        userId,
        failedCount: 1,
        lastFailedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [pinAttempts.tenantId, pinAttempts.userId],
        set: {
          failedCount: sql`${pinAttempts.failedCount} + 1`,
          lastFailedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning({ failedCount: pinAttempts.failedCount })

    const newCount = row?.failedCount ?? 1
    let lockedUntil: Date | null = null

    if (newCount >= PIN_DB_LOCK_PERM) {
      // M5: permanent lock — admin must clear pin_attempts row to restore login.
      lockedUntil = new Date(Date.now() + PIN_DB_LOCK_PERM_MS)
    } else if (newCount >= PIN_DB_LOCK_2) {
      lockedUntil = new Date(Date.now() + PIN_DB_LOCK_2_SECS * 1000)
    } else if (newCount >= PIN_DB_LOCK_1) {
      lockedUntil = new Date(Date.now() + PIN_DB_LOCK_1_SECS * 1000)
    }

    if (lockedUntil !== null) {
      await tx
        .update(pinAttempts)
        .set({ lockedUntil, updatedAt: new Date() })
        .where(and(eq(pinAttempts.tenantId, tenantId), eq(pinAttempts.userId, userId)))
    }

    return { lockedUntil }
  })
}

/**
 * Delete the PIN-attempt row on successful PIN entry.
 * Missing row is a no-op.
 */
export async function clearPinAttempt(tenantId: string, userId: number): Promise<void> {
  await withTenantTx({ tenantId, userId, branchId: null }, async (tx) => {
    await tx
      .delete(pinAttempts)
      .where(and(eq(pinAttempts.tenantId, tenantId), eq(pinAttempts.userId, userId)))
  })
}

/**
 * Returns true when the user's PIN is currently locked out.
 * A null / past locked_until = not locked.
 */
export async function isPinLocked(
  tenantId: string,
  userId: number,
): Promise<{ locked: boolean; retryAfterSecs: number }> {
  const row = await getPinAttempt(tenantId, userId)
  if (!row || !row.lockedUntil || row.lockedUntil <= new Date()) {
    return { locked: false, retryAfterSecs: 0 }
  }
  const retryAfterSecs = Math.ceil((row.lockedUntil.getTime() - Date.now()) / 1000)
  return { locked: true, retryAfterSecs }
}

// ---------------------------------------------------------------------------
// Kiosk PIN verification
// ---------------------------------------------------------------------------

export type VerifyPinResult = { ok: true } | { ok: false; code: 'NO_PIN_SET' | 'INVALID_PIN' }

/**
 * Verify a kiosk PIN for the given user (lookup by display_id since the
 * frontend caller does not know the bigint).
 */
export async function verifyUserPin(
  userDisplayId: string,
  pin: string,
  tenantSlug: string,
): Promise<VerifyPinResult> {
  const [row] = await withTenantTx(
    { tenantId: tenantSlug, userId: 0, branchId: null },
    async (tx) =>
      tx
        .select({ pinHash: users.pinHash })
        .from(users)
        .where(and(eq(users.displayId, userDisplayId), eq(users.tenantId, tenantSlug)))
        .limit(1),
  )

  if (!row) return { ok: false, code: 'INVALID_PIN' }
  if (!row.pinHash) return { ok: false, code: 'NO_PIN_SET' }

  const match = await bcrypt.compare(pin, row.pinHash)
  return match ? { ok: true } : { ok: false, code: 'INVALID_PIN' }
}
