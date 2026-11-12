import { randomUUID } from 'node:crypto'
import { Router, type Router as RouterType, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import {
  login,
  verifyRefresh,
  signAccess,
  signRefresh,
  REFRESH_TTL_MS,
  type RefreshPayload,
  type RequestContext,
} from './service.js'
import {
  clearPinAttempt,
  findRefreshTokenByJti,
  findUserByDisplayId,
  findPrimaryRole,
  isPinLocked,
  recordPinFailure,
  rotateRefreshTokenAtomic,
  revokeFamily,
  revokeRefreshToken,
  verifyUserPin,
} from './db.js'
import { displayIdSchema } from '../../shared/utils/displayId.js'
import { logger } from '../../shared/utils/logger.js'
import type { AuthUser } from '../../shared/middleware/auth.js'

export const authRouter: RouterType = Router()

// Per-route limiter for credential-handling endpoints.
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
})

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  path: '/',
}

const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000
const REFRESH_COOKIE_MAX_AGE = REFRESH_TTL_MS

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

authRouter.post('/login', authLimiter, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid credentials', code: 'VALIDATION_ERROR' })
    return
  }

  // req.tenant.id is the tenant slug (text), matching tenants.id PK.
  const reqCtx: RequestContext = {
    ipAddress: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  }
  const result = await login(parsed.data.email, parsed.data.password, req.tenant.id, reqCtx)
  if (!result.ok) {
    // AUTH-4: return 401 for all failures (bad credentials AND account locked)
    // so the response status code does not reveal whether the account exists.
    // The internal audit log records the true reason (ACCOUNT_LOCKED vs
    // INVALID_CREDENTIALS) for security review without leaking it to the client.
    res.status(401).json({ error: 'Invalid email or password', code: 'AUTH_FAILED' })
    return
  }

  res.cookie('access_token', result.accessToken, { ...COOKIE_OPTS, maxAge: ACCESS_COOKIE_MAX_AGE })
  res.cookie('refresh_token', result.refreshToken, {
    ...COOKIE_OPTS,
    maxAge: REFRESH_COOKIE_MAX_AGE,
  })

  logger.info({ userDisplayId: result.user.id }, 'User logged in')
  res.json({ user: result.user })
})

authRouter.post('/logout', async (req: Request, res: Response) => {
  // Best-effort: if a refresh cookie is present, revoke its row before clearing.
  const token = req.cookies?.refresh_token as string | undefined
  if (token) {
    try {
      const payload = verifyRefresh(token)
      const ctx = await ctxFromRefreshPayload(payload)
      if (ctx) {
        const row = await findRefreshTokenByJti(payload.jti, ctx)
        if (row && !row.revokedAt) {
          await revokeRefreshToken(row.id, ctx)
        }
      }
    } catch (err) {
      logger.debug({ err }, 'logout: refresh token invalid, skipping revoke')
    }
  }

  res.clearCookie('access_token', COOKIE_OPTS)
  res.clearCookie('refresh_token', COOKIE_OPTS)
  res.json({ ok: true })
})

/**
 * Resolve the refresh-payload's display-id-based principal back to a bigint
 * TenantCtx so DB writes (refresh-token rows, etc.) carry the right FKs.
 * Returns null if the user can't be resolved (deleted, wrong tenant).
 */
async function ctxFromRefreshPayload(payload: RefreshPayload) {
  const user = await findUserByDisplayId(payload.sub, payload.tenantSlug)
  if (!user) return null
  return {
    tenantId: payload.tenantSlug,
    userId: user.id,
    branchId: user.primaryBranchId,
  }
}

authRouter.post('/refresh', authLimiter, async (req: Request, res: Response) => {
  const token = req.cookies?.refresh_token as string | undefined
  if (!token) {
    res.status(401).json({ error: 'No refresh token', code: 'AUTH_REQUIRED' })
    return
  }

  let payload: RefreshPayload
  try {
    payload = verifyRefresh(token)
  } catch {
    res.status(401).json({ error: 'Invalid refresh token', code: 'AUTH_REQUIRED' })
    return
  }

  // AUTH-1 fix: re-fetch the user from DB to get current role/branch/can_login.
  // The JWT payload may carry stale claims (role changed, branch reassigned,
  // can_login revoked) — these would remain active for up to 7 days if we
  // reissued from the JWT claims directly. Rebuilding from DB closes that window.
  const user = await findUserByDisplayId(payload.sub, payload.tenantSlug)
  if (!user) {
    res.status(401).json({ error: 'Invalid refresh token', code: 'INVALID_TOKEN' })
    return
  }

  // AUTH-1: reject if can_login was revoked since the token was issued.
  if (!user.canLogin) {
    res.status(401).json({ error: 'Invalid refresh token', code: 'INVALID_TOKEN' })
    return
  }

  const ctx = {
    tenantId: user.tenantId,
    userId: user.id,
    branchId: user.primaryBranchId ?? null,
  }

  // AUTH-1: re-read the current primary role from user_roles junction.
  const currentRole = await findPrimaryRole(user.tenantId, user.id)
  if (!currentRole) {
    res.status(401).json({ error: 'Invalid refresh token', code: 'INVALID_TOKEN' })
    return
  }

  const newJti = randomUUID()
  const expiresAt = new Date(Date.now() + REFRESH_COOKIE_MAX_AGE)

  // CONC-3 fix: lock the old token row and perform insert+markReplaced atomically
  // in a single transaction, preventing parallel replay from minting two live tokens.
  const result = await rotateRefreshTokenAtomic(payload.jti, ctx, newJti, expiresAt)

  if (result.status === 'not_found') {
    res.status(401).json({ error: 'Invalid refresh token', code: 'INVALID_TOKEN' })
    return
  }

  if (result.status === 'reused') {
    // Catastrophic-loss defense: kill the whole token family.
    await revokeFamily(result.oldRow.familyId, ctx)
    logger.warn(
      { userDisplayId: payload.sub, familyId: result.oldRow.familyId, jti: payload.jti },
      'Refresh token reuse detected — family revoked',
    )
    res.status(401).json({ error: 'Refresh token reuse detected', code: 'TOKEN_REUSED' })
    return
  }

  if (result.status === 'expired') {
    res.status(401).json({ error: 'Refresh token expired', code: 'TOKEN_EXPIRED' })
    return
  }

  // AUTH-1: build the new token payload from current DB state, not stale JWT claims.
  const basePayload = {
    sub: user.displayId,
    email: user.email,
    role: currentRole,
    tenantSlug: user.tenantId,
    branchCode: user.primaryBranchCode ?? null,
  }
  const accessToken = signAccess(basePayload)
  const refreshToken = signRefresh({
    ...basePayload,
    jti: newJti,
    familyId: result.oldRow.familyId,
  })

  res.cookie('access_token', accessToken, { ...COOKIE_OPTS, maxAge: ACCESS_COOKIE_MAX_AGE })
  res.cookie('refresh_token', refreshToken, { ...COOKIE_OPTS, maxAge: REFRESH_COOKIE_MAX_AGE })
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// Kiosk PIN verification — DB-backed lockout (H3)
// The old process-local Map<string, PinAttemptRecord> has been replaced with
// DB helpers in auth/db.ts backed by the `pin_attempts` table so lockout
// survives restarts and is consistent across replicas.
// ---------------------------------------------------------------------------

const verifyPinSchema = z.object({
  // User display_id (e.g. `USR_AAAAAAA1`).
  userId: displayIdSchema,
  pin: z.string().regex(/^\d{4}$/, '4 digits required'),
})

authRouter.post('/verify-pin', authLimiter, async (req: Request, res: Response) => {
  const parsed = verifyPinSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', code: 'VALIDATION_ERROR' })
    return
  }

  const { userId: userDisplayId, pin } = parsed.data
  const tenantSlug = req.tenant.id

  // Resolve display_id → bigint so DB helpers can use FK-safe IDs.
  const user = await findUserByDisplayId(userDisplayId, tenantSlug)
  if (!user) {
    res.status(401).json({ code: 'INVALID_PIN', error: 'Incorrect PIN' })
    return
  }

  // Check DB-backed lockout state (survives restarts, consistent across replicas).
  const lockState = await isPinLocked(tenantSlug, user.id)
  if (lockState.locked) {
    res.status(429).json({ code: 'LOCKED_OUT', retryAfter: lockState.retryAfterSecs })
    return
  }

  const result = await verifyUserPin(userDisplayId, pin, tenantSlug)

  if (result.ok) {
    await clearPinAttempt(tenantSlug, user.id)
    res.json({ ok: true })
    return
  }

  if (result.code === 'NO_PIN_SET') {
    res.status(404).json({ code: 'NO_PIN_SET', error: 'No PIN configured for this user' })
    return
  }

  const { lockedUntil } = await recordPinFailure(tenantSlug, user.id)
  if (lockedUntil && lockedUntil > new Date()) {
    const retryAfter = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)
    logger.warn({ userDisplayId }, 'PIN rate limit triggered')
    res.status(429).json({ code: 'LOCKED_OUT', retryAfter })
    return
  }

  res.status(401).json({ code: 'INVALID_PIN', error: 'Incorrect PIN' })
})

authRouter.get('/me', (req: Request, res: Response) => {
  const user = (req as Request & { user?: AuthUser }).user
  if (!user) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
    return
  }
  res.json({ user })
})
