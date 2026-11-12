import { eq } from 'drizzle-orm'
import type { Request, Response, NextFunction } from 'express'
import { tenants } from '../db/schema.js'
import { withPlatformTx } from '../db/withTenantTx.js'
import { isProduction } from '../config/env.js'
import { logger } from '../utils/logger.js'
import type { AuthUser } from './auth.js'

// Slugs that are infrastructure subdomains, not tenant identifiers.
// Module-level so the Set is constructed once, not per request.
const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'app', 'staging', 'admin'])

async function resolveTenantBySlug(slug: string): Promise<string | null> {
  // AUTH-2: tenants table has RLS (0022) — the policy requires either
  // `app.is_platform_admin='true'` or `id = app.current_tenant_id`. Pre-auth
  // lookup has neither, so go through `withPlatformTx` which sets the
  // platform-admin GUC. Platform sentinel userId=-1 is fine — this is SELECT-only
  // and the audit trigger doesn't fire on reads.
  const [row] = await withPlatformTx({ platformUserId: -1 }, async (tx) =>
    tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1),
  )
  return row?.id ?? null
}

/**
 * Tenant resolution — Phase 2 dynamic tenant middleware.
 *
 * Resolution priority (highest → lowest):
 *
 * 1. JWT claim  — if authMiddleware already ran and set req.user.tenantId,
 *    use it unconditionally. This is the canonical path for authenticated
 *    requests post-login.
 *
 * 2. Subdomain / X-Tenant-Slug header — for unauthenticated paths (login,
 *    refresh). Parses the first label of the Host header as the slug (e.g.
 *    "clinicname.surevax.com" → slug "clinicname") OR reads the
 *    X-Tenant-Slug header directly (useful in dev/test and for API clients).
 *    The slug is looked up in the `tenants` table.
 *
 * 3. X-Dev-Tenant-Id header — development only (NODE_ENV ≠ production).
 *    Allows bypassing the slug lookup during local dev. The header value is
 *    used verbatim as the tenant ID. Document here to prevent accidental use
 *    in production — the guard below makes it a no-op there.
 *
 * 4. 400 Bad Request — no fallback to a hardcoded default. Removing the
 *    silent TEN-SUREVAX fallback is the whole point of this change.
 *
 * IMPORTANT: this middleware intentionally does NOT validate that the resolved
 * tenant ID exists in the DB when it comes from a JWT. The JWT was signed by
 * our auth service from a real tenant row — we trust the claim. The slug path
 * does a DB lookup, which implicitly validates the tenant exists.
 *
 * Cross-tenant safety: if a request provides both a JWT (tenantId in claim)
 * AND an X-Tenant-Slug header, the JWT tenant takes priority. This prevents
 * an attacker from using tenant-1 credentials to probe tenant-2 data via
 * the slug header.
 */
export async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  const user = (req as Request & { user?: AuthUser }).user

  // Priority 0: Platform admin — bypass tenant requirement entirely.
  // Platform admins operate cross-tenant; withPlatformTx sets the GUC when needed.
  if (user?.isPlatformAdmin === true) {
    // Set a sentinel tenant so downstream code that reads req.tenant doesn't crash.
    // Routes that run under platform admin context should use withPlatformTx, not
    // req.tenant.id, for any DB writes.
    req.tenant = { id: '', userId: null, branchId: null }
    next()
    return
  }

  // Priority 1: JWT already decoded by authMiddleware
  const jwtTenantId = user?.tenantId ?? undefined
  if (jwtTenantId) {
    req.tenant = {
      id: jwtTenantId,
      userId: user?.id ?? null,
      branchId: user?.branchId ?? null,
    }
    next()
    return
  }

  // Priority 2: X-Tenant-Slug header or subdomain
  const slugHeader = req.headers['x-tenant-slug'] as string | undefined
  const hostSlug = parseSubdomainSlug(req.hostname)
  const slug = slugHeader ?? hostSlug

  if (slug) {
    try {
      const tenantId = await resolveTenantBySlug(slug)
      if (!tenantId) {
        logger.warn({ slug, path: req.path }, 'tenant slug not found')
        res.status(404).json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' })
        return
      }
      req.tenant = { id: tenantId, userId: null, branchId: null }
      next()
      return
    } catch (err) {
      logger.error({ err, slug, path: req.path }, 'tenant slug DB lookup failed')
      res.status(500).json({ error: 'Tenant resolution failed', code: 'INTERNAL_ERROR' })
      return
    }
  }

  // Priority 3: dev/test only — X-Dev-Tenant-Id header (raw ID, no DB lookup)
  if (!isProduction) {
    const devTenantId = req.headers['x-dev-tenant-id'] as string | undefined
    if (devTenantId) {
      req.tenant = { id: devTenantId, userId: null, branchId: null }
      next()
      return
    }
  }

  // No silent fallback — every request must supply tenant context.
  logger.warn({ path: req.path, method: req.method }, 'no tenant context — rejecting request')
  res.status(400).json({
    error: 'Tenant context required. Supply X-Tenant-Slug header or authenticate first.',
    code: 'TENANT_REQUIRED',
  })
}

/**
 * Parse the subdomain from the Host header as a potential tenant slug.
 * Returns the first label only if it is not "www", "api", "localhost",
 * or a raw IP address. Returns null when the host is a flat/IP domain.
 *
 * Examples:
 *   "clinicname.surevax.com"  → "clinicname"
 *   "surevax.com"             → null (no subdomain)
 *   "localhost"               → null
 *   "api.surevax.com"         → null (reserved)
 */
function parseSubdomainSlug(hostname: string): string | null {
  const host = hostname.split(':')[0] ?? ''

  if (!host || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null

  const parts = host.split('.')
  if (parts.length < 2) return null

  const subdomain = parts[0]!
  if (RESERVED_SUBDOMAINS.has(subdomain)) return null

  return subdomain
}

declare global {
  namespace Express {
    interface Request {
      tenant: {
        /** Tenant slug (text PK on `tenants.id`). */
        id: string
        /** users.id (bigint) — null on pre-auth paths. */
        userId: number | null
        /** branches.id (bigint) — null when no primary branch or cross-branch. */
        branchId: number | null
      }
    }
  }
}
