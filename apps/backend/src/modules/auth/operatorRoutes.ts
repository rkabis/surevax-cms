/**
 * operatorRoutes.ts — Platform admin authentication endpoints.
 *
 * POST /api/operator/login
 *   Authenticates a platform_users row (cross-tenant infrastructure operator).
 *   Issues a JWT with isPlatformAdmin:true — no tenantId/branchId.
 *   Sets the same access_token cookie name as regular tenant auth; the cookie
 *   is distinguished by the JWT payload (isPlatformAdmin flag), not by cookie name.
 *   This allows the existing authMiddleware to handle both token types.
 *
 * 4-column field-parity table for /operator/login request body:
 *   DB column        | Backend Zod        | Frontend type (stub) | Notes
 *   email            | z.string().email() | string               | citext, case-insensitive
 *   password_hash    | z.string().min(1)  | string (password)    | bcrypt-compared, not returned
 */

import { Router, type Router as RouterType, type Request, type Response } from 'express'
import bcrypt from 'bcrypt'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../shared/db/index.js'
import { platformUsers } from '../../shared/db/schema.js'
import { signOperatorAccess } from './service.js'
import { logger } from '../../shared/utils/logger.js'
import { generateSecret, verifyToken, qrCodeDataUrl } from './mfa.js'

export const operatorRouter: RouterType = Router()

const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  path: '/',
}

const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000 // 15 min

const operatorLoginLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
})

// Pre-computed bcrypt hash for timing equalization when the platform user is not found.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12)

// ---------------------------------------------------------------------------
// SEC-7: Operator login lockout (in-process, no schema change required).
// platform_users lacks failed_login_count / locked_until columns (no migration
// in scope). We use an in-process Map that mirrors the tenant pin-attempts
// pattern (5 failures → 15-min lockout). This is intentionally noted as a
// follow-up for DB-backed lockout once the platform_users schema is extended.
//
// DOC-DRIFT: DB-backed operator lockout requires adding failed_login_count and
// locked_until columns to platform_users. Tracked as a follow-up hardening step.
// ---------------------------------------------------------------------------
const OPERATOR_LOCK_THRESHOLD = 5
const OPERATOR_LOCK_DURATION_MS = 15 * 60 * 1000 // 15 minutes

type OperatorAttemptRecord = {
  failedCount: number
  lockedUntil: Date | null
}

const operatorAttempts = new Map<string, OperatorAttemptRecord>()

function getOperatorAttempt(email: string): OperatorAttemptRecord {
  return operatorAttempts.get(email.toLowerCase()) ?? { failedCount: 0, lockedUntil: null }
}

function recordOperatorFailure(email: string): void {
  const key = email.toLowerCase()
  const record = getOperatorAttempt(email)
  const newCount = record.failedCount + 1
  const lockedUntil =
    newCount >= OPERATOR_LOCK_THRESHOLD ? new Date(Date.now() + OPERATOR_LOCK_DURATION_MS) : null
  operatorAttempts.set(key, { failedCount: newCount, lockedUntil })
}

function clearOperatorAttempt(email: string): void {
  operatorAttempts.delete(email.toLowerCase())
}

function isOperatorLocked(email: string): boolean {
  const record = getOperatorAttempt(email)
  if (!record.lockedUntil) return false
  if (record.lockedUntil > new Date()) return true
  // Lockout expired — clear it
  operatorAttempts.delete(email.toLowerCase())
  return false
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaToken: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
})

operatorRouter.post('/login', operatorLoginLimiter, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid credentials', code: 'VALIDATION_ERROR' })
    return
  }

  const { email, password, mfaToken } = parsed.data

  // SEC-7: check in-process lockout before DB lookup (timing-safe: we still run
  // bcrypt equalization so the locked branch doesn't reveal account existence).
  if (isOperatorLocked(email)) {
    await bcrypt.compare(password, DUMMY_HASH)
    res.status(401).json({ error: 'Invalid email or password', code: 'AUTH_FAILED' })
    return
  }

  // Lookup platform user (citext = case-insensitive match)
  const [platformUser] = await db
    .select({
      id: platformUsers.id,
      displayId: platformUsers.displayId,
      email: platformUsers.email,
      displayName: platformUsers.displayName,
      passwordHash: platformUsers.passwordHash,
      isActive: platformUsers.isActive,
      canLogin: platformUsers.canLogin,
      mfaEnabled: platformUsers.mfaEnabled,
      mfaSecret: platformUsers.mfaSecret,
    })
    .from(platformUsers)
    .where(eq(platformUsers.email, email))
    .limit(1)

  if (!platformUser) {
    // Equalize timing
    await bcrypt.compare(password, DUMMY_HASH)
    recordOperatorFailure(email)
    res.status(401).json({ error: 'Invalid email or password', code: 'AUTH_FAILED' })
    return
  }

  if (!platformUser.isActive || !platformUser.canLogin) {
    await bcrypt.compare(password, DUMMY_HASH)
    recordOperatorFailure(email)
    res.status(401).json({ error: 'Invalid email or password', code: 'AUTH_FAILED' })
    return
  }

  const valid = await bcrypt.compare(password, platformUser.passwordHash)
  if (!valid) {
    recordOperatorFailure(email)
    res.status(401).json({ error: 'Invalid email or password', code: 'AUTH_FAILED' })
    return
  }

  if (platformUser.mfaEnabled) {
    if (!mfaToken) {
      res.status(403).json({
        error: 'MFA code required',
        code: 'MFA_REQUIRED',
      })
      return
    }
    if (!platformUser.mfaSecret || !verifyToken(platformUser.mfaSecret, mfaToken)) {
      recordOperatorFailure(email)
      res.status(403).json({
        error: 'Invalid MFA code',
        code: 'MFA_INVALID',
      })
      return
    }
  }

  // Successful auth — clear lockout counter.
  clearOperatorAttempt(email)

  // Update last_login_at — platform_users is NOT audited, so no GUC needed.
  await db
    .update(platformUsers)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(platformUsers.id, platformUser.id))

  const accessToken = signOperatorAccess({
    sub: platformUser.displayId,
    email: platformUser.email,
    isPlatformAdmin: true,
  })

  // Intentionally short-lived (15 min, no refresh token).
  // Platform admin sessions do not use refresh tokens — operators re-authenticate
  // after token expiry. This limits blast radius if a platform admin token is stolen.
  res.cookie('access_token', accessToken, { ...COOKIE_OPTS, maxAge: ACCESS_COOKIE_MAX_AGE })

  logger.info(
    { platformUserDisplayId: platformUser.displayId, mfa: platformUser.mfaEnabled },
    'Platform admin logged in',
  )

  // SEC-8 fix: do NOT return accessToken in the JSON body. It is already set as
  // an HttpOnly Secure cookie (same as tenant login). Returning it in the body
  // exposes it to XSS — any JS running on the page could steal it. The cookie
  // is the only delivery channel.
  res.json({
    user: {
      id: platformUser.displayId,
      email: platformUser.email,
      displayName: platformUser.displayName,
      mfaEnabled: platformUser.mfaEnabled,
    },
  })
})

// ─── MFA enrollment ─────────────────────────────────────────────────────────
// Two-step: POST /mfa/enroll generates + stores a fresh secret (mfa_enabled
// stays false); POST /mfa/verify validates a code from the user's TOTP app
// and flips mfa_enabled to true with mfa_enrolled_at = now().

type OperatorAuthUser = {
  id: string
  email: string
  isPlatformAdmin: boolean
}

function requirePlatformAdmin(req: Request, res: Response): OperatorAuthUser | null {
  const user = (req as Request & { user?: OperatorAuthUser }).user
  if (!user || !user.isPlatformAdmin) {
    res.status(403).json({ error: 'NOT_PLATFORM_ADMIN' })
    return null
  }
  return user
}

operatorRouter.post('/mfa/enroll', async (req: Request, res: Response) => {
  const user = requirePlatformAdmin(req, res)
  if (!user) return

  const [row] = await db
    .select({
      id: platformUsers.id,
      email: platformUsers.email,
      mfaEnabled: platformUsers.mfaEnabled,
    })
    .from(platformUsers)
    .where(eq(platformUsers.displayId, user.id))
    .limit(1)

  if (!row) {
    res.status(404).json({ error: 'PLATFORM_USER_NOT_FOUND' })
    return
  }

  if (row.mfaEnabled) {
    res.status(409).json({
      error: 'MFA is already enabled. Disable before re-enrolling.',
      code: 'MFA_ALREADY_ENABLED',
    })
    return
  }

  const { base32, otpauthUrl } = generateSecret(row.email)
  const qr = await qrCodeDataUrl(otpauthUrl)

  await db
    .update(platformUsers)
    .set({ mfaSecret: base32, updatedAt: new Date() })
    .where(eq(platformUsers.id, row.id))

  res.json({ base32Secret: base32, qrCodeDataUrl: qr, otpauthUrl })
})

const verifySchema = z.object({ token: z.string().regex(/^\d{6}$/) })

operatorRouter.post('/mfa/verify', async (req: Request, res: Response) => {
  const user = requirePlatformAdmin(req, res)
  if (!user) return

  const parsed = verifySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_TOKEN', code: 'VALIDATION_ERROR' })
    return
  }

  const [row] = await db
    .select({
      id: platformUsers.id,
      mfaSecret: platformUsers.mfaSecret,
      mfaEnabled: platformUsers.mfaEnabled,
    })
    .from(platformUsers)
    .where(eq(platformUsers.displayId, user.id))
    .limit(1)

  if (!row || !row.mfaSecret) {
    res.status(409).json({ error: 'No MFA enrollment in progress', code: 'NOT_ENROLLED' })
    return
  }

  if (!verifyToken(row.mfaSecret, parsed.data.token)) {
    res.status(400).json({ error: 'Invalid TOTP code', code: 'INVALID_TOKEN' })
    return
  }

  await db
    .update(platformUsers)
    .set({ mfaEnabled: true, mfaEnrolledAt: new Date(), updatedAt: new Date() })
    .where(eq(platformUsers.id, row.id))

  logger.info({ platformUserDisplayId: user.id }, 'Platform admin enrolled MFA')

  res.json({ mfaEnabled: true })
})
