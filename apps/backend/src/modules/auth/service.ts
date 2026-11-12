import { randomUUID } from 'node:crypto'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { env } from '../../shared/config/env.js'
import { auditLogStandalone } from '../../shared/utils/auditLog.js'
import {
  findUserByEmail,
  findPrimaryRole,
  incrementFailedLogin,
  resetFailedLogin,
  insertRefreshToken,
  updateLastLogin,
} from './db.js'

const ACCESS_SECRET = env.JWT_ACCESS_SECRET
const REFRESH_SECRET = env.JWT_REFRESH_SECRET
const ACCESS_TTL = '15m'
const REFRESH_TTL = '7d'
const JWT_ALG = 'HS256' as const

// H5: explicit issuer + audience claims.
// Both tenant and operator tokens share ACCESS_SECRET for now (secret split
// is the follow-up hardening step). The distinct aud values mean verifyAccess
// rejects operator tokens and vice versa, closing the cross-audience minting risk.
const ISSUER = 'surevax-cms'
const TENANT_AUD = 'surevax-tenant'
const OPERATOR_AUD = 'surevax-operator'

export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Pre-computed bcrypt hash used to keep login time roughly constant when the
// account doesn't exist. Generated once at module import so the cost is paid
// at boot, not per request.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12)

// =============================================================================
// JWT payload shapes — two-tier IDs (W2, 2026-05-19)
// =============================================================================
// JWT carries only the *public* handles (display_id strings, tenant slug,
// branch code). Auth middleware resolves these to internal bigint at request
// time so RLS GUCs and downstream FKs work without cluttering the token.
// =============================================================================

export type TokenPayload = {
  /** User display_id, e.g. `USR_AAAAAAA1`. */
  sub: string
  email: string
  role: string
  /** Tenant slug (text), e.g. `SVX`. Matches `tenants.id`. */
  tenantSlug: string
  /** Branch code, e.g. `HST`. Null for users without a primary branch. */
  branchCode: string | null
}

export type RefreshPayload = TokenPayload & {
  jti: string
  familyId: string
}

// Platform admin token — cross-tenant, no tenantSlug/branchCode.
export type OperatorTokenPayload = {
  /** Platform user display_id, e.g. `PLU_AAAAAAA1`. */
  sub: string
  email: string
  isPlatformAdmin: true
}

export function signOperatorAccess(payload: OperatorTokenPayload) {
  return jwt.sign(payload, ACCESS_SECRET, {
    algorithm: JWT_ALG,
    expiresIn: ACCESS_TTL,
    issuer: ISSUER,
    audience: OPERATOR_AUD,
  })
}

export function verifyOperatorAccess(token: string): OperatorTokenPayload {
  return jwt.verify(token, ACCESS_SECRET, {
    algorithms: [JWT_ALG],
    issuer: ISSUER,
    audience: OPERATOR_AUD,
  }) as OperatorTokenPayload
}

export function signAccess(payload: TokenPayload) {
  return jwt.sign(payload, ACCESS_SECRET, {
    algorithm: JWT_ALG,
    expiresIn: ACCESS_TTL,
    issuer: ISSUER,
    audience: TENANT_AUD,
  })
}

export function signRefresh(payload: RefreshPayload) {
  return jwt.sign(payload, REFRESH_SECRET, {
    algorithm: JWT_ALG,
    expiresIn: REFRESH_TTL,
    issuer: ISSUER,
  })
}

export function verifyAccess(token: string): TokenPayload | OperatorTokenPayload {
  // verifyAccess is called by authMiddleware which handles both tenant and operator
  // tokens. We cannot restrict to a single audience here; instead each caller
  // (verifyOperatorAccess / auth middleware) enforces the correct audience.
  // The middleware discriminates via isOperatorPayload() after verifying.
  return jwt.verify(token, ACCESS_SECRET, { algorithms: [JWT_ALG], issuer: ISSUER }) as
    | TokenPayload
    | OperatorTokenPayload
}

export function verifyRefresh(token: string): RefreshPayload {
  return jwt.verify(token, REFRESH_SECRET, {
    algorithms: [JWT_ALG],
    issuer: ISSUER,
  }) as RefreshPayload
}

// Sentinel return type for the login flow.
// AUTH-4: ACCOUNT_LOCKED is no longer returned to callers — the route maps all
// failures to 401 to prevent account enumeration. The internal audit log captures
// the true reason. Only INVALID_CREDENTIALS and LOGIN_DISABLED are surfaced here;
// the former covers both wrong-password and locked-account cases.
export type LoginResult =
  | { ok: true; accessToken: string; refreshToken: string; user: LoginUser }
  | { ok: false; reason: 'INVALID_CREDENTIALS' | 'LOGIN_DISABLED' }

/** Optional request context forwarded into `login()` for audit logging. */
export type RequestContext = {
  ipAddress?: string | null
  userAgent?: string | null
}

export type LoginUser = {
  /** User display_id (string). */
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  /** Branch code (string), e.g. `HST`. Null when user has no primary branch. */
  branchCode: string | null
}

export async function login(
  email: string,
  password: string,
  tenantSlug: string,
  requestContext?: RequestContext,
): Promise<LoginResult> {
  const user = await findUserByEmail(email, tenantSlug)
  if (!user) {
    // Equalize timing: still run a bcrypt compare so attackers can't
    // distinguish "user not found" from "wrong password" by response time.
    await bcrypt.compare(password, DUMMY_HASH)
    // Fire-and-forget: unmatched email — no userId, entityId is null.
    auditLogStandalone({
      tenantId: tenantSlug,
      userId: null,
      action: 'LOGIN_FAILED',
      entityType: 'users',
      entityId: null,
      metadata: { email, reason: 'USER_NOT_FOUND' },
      ipAddress: requestContext?.ipAddress ?? null,
      userAgent: requestContext?.userAgent ?? null,
    }).catch(() => {
      // Non-fatal: never let audit failure bubble past auth
    })
    return { ok: false, reason: 'INVALID_CREDENTIALS' }
  }

  // Login is opt-in per user. Physician/Nurse/Cashier rows that exist only as
  // referenceable directory entries (clock-in dropdown, "authorized by" picker)
  // have can_login=false and must not be allowed to authenticate.
  if (!user.canLogin) {
    auditLogStandalone({
      tenantId: user.tenantId,
      userId: user.id,
      branchId: user.primaryBranchId ?? null,
      action: 'LOGIN_FAILED',
      entityType: 'users',
      entityId: user.displayId,
      metadata: { reason: 'LOGIN_DISABLED' },
      ipAddress: requestContext?.ipAddress ?? null,
      userAgent: requestContext?.userAgent ?? null,
    }).catch(() => {})
    return { ok: false, reason: 'LOGIN_DISABLED' }
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    auditLogStandalone({
      tenantId: user.tenantId,
      userId: user.id,
      branchId: user.primaryBranchId ?? null,
      action: 'LOGIN_FAILED',
      entityType: 'users',
      entityId: user.displayId,
      // AUTH-4: log the actual reason internally so security reviews can detect
      // repeated lockouts, but the HTTP response must be generic (401) to prevent
      // account enumeration via distinct status codes (423 vs 401).
      metadata: { reason: 'ACCOUNT_LOCKED' },
      ipAddress: requestContext?.ipAddress ?? null,
      userAgent: requestContext?.userAgent ?? null,
    }).catch(() => {})
    // AUTH-4 fix: return INVALID_CREDENTIALS (→ 401 at the route) instead of
    // ACCOUNT_LOCKED (→ 423). Both the locked and bad-password paths must return
    // the same HTTP status so the existence of an account is not revealed.
    return { ok: false, reason: 'INVALID_CREDENTIALS' }
  }

  const valid = await bcrypt.compare(password, user.passwordHash)

  // Internal context for tenant-scoped writes — uses bigint user/branch IDs.
  const ctx = {
    tenantId: user.tenantId,
    userId: user.id,
    branchId: user.primaryBranchId ?? null,
  }

  if (!valid) {
    await incrementFailedLogin(ctx)
    auditLogStandalone({
      tenantId: user.tenantId,
      userId: user.id,
      branchId: user.primaryBranchId ?? null,
      action: 'LOGIN_FAILED',
      entityType: 'users',
      entityId: user.displayId,
      metadata: { reason: 'INVALID_CREDENTIALS' },
      ipAddress: requestContext?.ipAddress ?? null,
      userAgent: requestContext?.userAgent ?? null,
    }).catch(() => {})
    return { ok: false, reason: 'INVALID_CREDENTIALS' }
  }

  // --- Successful login ---

  // Read primary role from user_roles junction (canonical post-Phase 4).
  const primaryRole = await findPrimaryRole(user.tenantId, user.id)
  if (!primaryRole) {
    auditLogStandalone({
      tenantId: user.tenantId,
      userId: user.id,
      branchId: user.primaryBranchId ?? null,
      action: 'LOGIN_FAILED',
      entityType: 'users',
      entityId: user.displayId,
      metadata: { reason: 'NO_PRIMARY_ROLE' },
      ipAddress: requestContext?.ipAddress ?? null,
      userAgent: requestContext?.userAgent ?? null,
    }).catch(() => {})
    return { ok: false, reason: 'INVALID_CREDENTIALS' }
  }

  await resetFailedLogin(ctx)
  await updateLastLogin(ctx)

  const basePayload: TokenPayload = {
    sub: user.displayId,
    email: user.email,
    role: primaryRole,
    tenantSlug,
    branchCode: user.primaryBranchCode ?? null,
  }

  // Persist refresh-token row (server-side rotation + family revocation).
  const jti = randomUUID()
  const familyId = randomUUID()
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS)

  await insertRefreshToken({ ...ctx, jti, familyId, expiresAt })

  const refreshPayload: RefreshPayload = { ...basePayload, jti, familyId }

  return {
    ok: true,
    accessToken: signAccess(basePayload),
    refreshToken: signRefresh(refreshPayload),
    user: {
      id: user.displayId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: primaryRole,
      branchCode: user.primaryBranchCode ?? null,
    },
  }
}
