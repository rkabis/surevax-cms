import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import {
  verifyAccess,
  verifyOperatorAccess,
  type OperatorTokenPayload,
} from '../../modules/auth/service.js'
import { findUserByDisplayId } from '../../modules/auth/db.js'
import { logger } from '../utils/logger.js'

// Public routes that skip JWT verification
const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/operator/login',
  '/health',
])

function isOperatorPayload(
  payload: ReturnType<typeof verifyAccess>,
): payload is OperatorTokenPayload {
  return 'isPlatformAdmin' in payload && payload.isPlatformAdmin === true
}

/**
 * Verify the access token. JWT carries display_ids / slugs / codes (W2,
 * 2026-05-19) — this middleware resolves them to internal bigint IDs so
 * downstream RLS GUCs and FK writes use the canonical PK form.
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (PUBLIC_PATHS.has(req.path)) {
    next()
    return
  }

  const token = req.cookies?.access_token as string | undefined
  if (!token) {
    res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
    return
  }

  try {
    // First pass: verify signature + issuer without audience constraint so we
    // can discriminate the token type. Second pass (below) re-verifies with the
    // correct audience for each path (H5 — explicit iss + aud enforcement).
    const payload = verifyAccess(token)

    if (isOperatorPayload(payload)) {
      // Re-verify with the operator audience to reject tenant tokens presented
      // to operator-guarded routes. JsonWebTokenError propagates to the catch.
      verifyOperatorAccess(token)

      // Platform admin token — cross-tenant, no tenant resolution needed.
      // `sub` is the platform user display_id (e.g. `PLU_…`). We do not
      // resolve to bigint here; withPlatformTx is the canonical DB-write path
      // and accepts the bigint via its own lookup when needed.
      ;(req as Request & { user: AuthUser }).user = {
        id: null,
        displayId: payload.sub,
        email: payload.email,
        firstName: '',
        lastName: '',
        role: 'PlatformAdmin',
        tenantId: null,
        branchId: null,
        branchCode: null,
        branchName: null,
        branchAddress: null,
        branchContactNumber: null,
        isPlatformAdmin: true,
      }
      next()
      return
    }

    // Tenant user token — resolve display_id → bigint via DB lookup so RLS
    // GUCs and FK writes carry the canonical bigint user/branch IDs.
    const user = await findUserByDisplayId(payload.sub, payload.tenantSlug)
    if (!user) {
      logger.warn(
        { sub: payload.sub, tenantSlug: payload.tenantSlug, path: req.path },
        'auth: user from JWT not found in DB',
      )
      res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' })
      return
    }

    ;(req as Request & { user: AuthUser }).user = {
      id: user.id, // bigint
      displayId: user.displayId, // text, e.g. 'USR_AAAAAAA1'
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: payload.role,
      tenantId: payload.tenantSlug, // tenant slug = tenants.id
      branchId: user.primaryBranchId, // bigint or null
      branchCode: user.primaryBranchCode, // text or null
      branchName: user.primaryBranchName, // joined branches.name
      branchAddress: user.primaryBranchAddress, // joined branches.address
      branchContactNumber: user.primaryBranchContactNumber, // joined branches.contact_number
      isPlatformAdmin: false,
    }
    next()
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' })
      return
    }
    logger.warn({ path: req.path, ip: req.ip }, 'invalid jwt')
    res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' })
  }
}

export type AuthUser = {
  /** users.id (bigint) — null for platform admins. */
  id: number | null
  /** users.display_id (text). */
  displayId: string
  email: string
  /** users.first_name. Empty string for platform admins (no DB row). */
  firstName: string
  /** users.last_name. Empty string for platform admins. */
  lastName: string
  role: string
  /** Tenant slug (text). Null for platform admins. */
  tenantId: string | null
  /** branches.id (bigint). Null when no primary branch / cross-branch. */
  branchId: number | null
  /** branches.code (3-letter text). Null when no primary branch. */
  branchCode: string | null
  /** branches.name (e.g. "Holy Spirit"). Null when no primary branch. */
  branchName: string | null
  /** branches.address. Null when no primary branch or address unset. */
  branchAddress: string | null
  /** branches.contact_number. Null when no primary branch or contact unset. */
  branchContactNumber: string | null
  isPlatformAdmin: boolean
}
