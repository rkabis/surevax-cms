/**
 * Repository-native emergency account recovery.
 *
 * This tool does not create users, passwords, sessions, or roles. A grant is
 * tenant-bound, short-lived, one-time, revocable, and single-purpose: it can
 * only clear the login lockout counters of one existing active TenantAdmin and
 * revoke that user's existing refresh tokens. The activation token is read
 * from stdin and is never logged or printed.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { and, eq, gt, isNull, ne, or } from 'drizzle-orm'
import {
  approvalDecisions,
  approvalRequests,
  branches,
  emergencyAccessGrants,
  refreshTokens,
  userRoles,
  users,
} from '../shared/db/schema.js'
import { withSystemTx } from '../shared/db/withTenantTx.js'
import { auditLog } from '../shared/utils/auditLog.js'
import { displayId, prefixedDisplayIdSchema } from '../shared/utils/displayId.js'

const PURPOSE = 'restore_tenant_admin_login' as const
const MIN_DURATION_MINUTES = 5
const MAX_DURATION_MINUTES = 30

export type EmergencyGrantState = {
  expiresAt: Date
  usedAt: Date | null
  revokedAt: Date | null
  purpose: string
}

export type EmergencyAccessErrorCode =
  | 'INVALID_DURATION'
  | 'INVALID_REFERENCE'
  | 'REQUESTER_NOT_ELIGIBLE'
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_NOT_AUTHORIZED'
  | 'APPROVAL_SCOPE_MISMATCH'
  | 'TARGET_NOT_ELIGIBLE'
  | 'GRANT_NOT_FOUND'
  | 'INVALID_TOKEN'
  | 'GRANT_REPLAYED'
  | 'GRANT_EXPIRED'
  | 'GRANT_REVOKED'
  | 'WRONG_PURPOSE'

export class EmergencyAccessError extends Error {
  constructor(
    readonly code: EmergencyAccessErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'EmergencyAccessError'
  }
}

export function hashEmergencyToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function assertOpaqueReference(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,119}$/.test(value)) {
    throw new EmergencyAccessError('INVALID_REFERENCE', `${label} must be an opaque reference`)
  }
}

function parseApprovalDetails(
  value: string | null,
): { incidentId: string; purpose: string } | null {
  if (value === null) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return typeof parsed['incidentId'] === 'string' && typeof parsed['purpose'] === 'string'
      ? { incidentId: parsed['incidentId'], purpose: parsed['purpose'] }
      : null
  } catch {
    return null
  }
}

export function assertEmergencyGrantUsable(state: EmergencyGrantState, now = new Date()): void {
  if (state.purpose !== PURPOSE) {
    throw new EmergencyAccessError('WRONG_PURPOSE', 'Grant purpose is not account recovery')
  }
  if (state.revokedAt !== null) {
    throw new EmergencyAccessError('GRANT_REVOKED', 'Grant has been revoked')
  }
  if (state.usedAt !== null) {
    throw new EmergencyAccessError('GRANT_REPLAYED', 'Grant has already been consumed')
  }
  if (state.expiresAt <= now) {
    throw new EmergencyAccessError('GRANT_EXPIRED', 'Grant has expired')
  }
}

function tokensMatch(provided: string, expectedHash: string): boolean {
  const providedHash = Buffer.from(hashEmergencyToken(provided), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return providedHash.length === expected.length && timingSafeEqual(providedHash, expected)
}

/**
 * Create the repository approval record. The requester is an existing active
 * tenant user; two other active TenantAdmins must approve through the normal
 * authenticated approval API before a lease can be minted.
 */
export async function createEmergencyAccessRequest(args: {
  tenantId: string
  requesterUserDisplayId: string
  targetUserDisplayId: string
  incidentId: string
  now?: Date
}): Promise<{ approvalRequestDisplayId: string; expiresAt: Date }> {
  assertOpaqueReference(args.incidentId, 'Incident ID')
  const now = args.now ?? new Date()
  const expiresAt = new Date(now.getTime() + 60 * 60_000)
  const approvalRequestDisplayId = displayId('APR')

  await withSystemTx({ tenantId: args.tenantId }, async (tx) => {
    const [requester] = await tx
      .select({ id: users.id, primaryBranchId: users.primaryBranchId })
      .from(users)
      .where(
        and(
          eq(users.tenantId, args.tenantId),
          eq(users.displayId, args.requesterUserDisplayId),
          eq(users.isActive, true),
          eq(users.canLogin, true),
          eq(users.status, 'Active'),
          ne(users.displayId, args.targetUserDisplayId),
        ),
      )
      .limit(1)
    if (!requester) {
      throw new EmergencyAccessError(
        'REQUESTER_NOT_ELIGIBLE',
        'Requester must be an active login-enabled user in the named tenant',
      )
    }

    const [target] = await tx
      .select({ id: users.id, primaryBranchId: users.primaryBranchId })
      .from(users)
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.tenantId, args.tenantId),
          eq(userRoles.userId, users.id),
          eq(userRoles.role, 'TenantAdmin'),
          or(isNull(userRoles.expiresAt), gt(userRoles.expiresAt, now)),
        ),
      )
      .where(
        and(
          eq(users.tenantId, args.tenantId),
          eq(users.displayId, args.targetUserDisplayId),
          eq(users.isActive, true),
          eq(users.canLogin, true),
          eq(users.status, 'Active'),
        ),
      )
      .limit(1)
    if (!target || !target.id) {
      throw new EmergencyAccessError(
        'TARGET_NOT_ELIGIBLE',
        'Target must be an existing TenantAdmin in the named tenant',
      )
    }

    const requestedBranchId = requester.primaryBranchId ?? target.primaryBranchId
    const [fallbackBranch] = requestedBranchId
      ? [{ id: requestedBranchId }]
      : await tx
          .select({ id: branches.id })
          .from(branches)
          .where(and(eq(branches.tenantId, args.tenantId), eq(branches.isActive, true)))
          .limit(1)
    if (!fallbackBranch) {
      throw new EmergencyAccessError('REQUESTER_NOT_ELIGIBLE', 'Tenant has no active branch')
    }

    await tx.insert(approvalRequests).values({
      displayId: approvalRequestDisplayId,
      tenantId: args.tenantId,
      branchId: fallbackBranch.id,
      requestType: 'emergency_access',
      description: `Emergency account-recovery request ${args.incidentId}`,
      details: JSON.stringify({ incidentId: args.incidentId, purpose: PURPOSE }),
      entityType: 'users',
      entityId: args.targetUserDisplayId,
      requestedById: requester.id,
      requestedAt: now,
      expiresAt,
      requiredApprovers: 2,
      approverRole: 'TenantAdmin',
    })
  })

  return { approvalRequestDisplayId, expiresAt }
}

export async function createEmergencyGrant(args: {
  tenantId: string
  targetUserDisplayId: string
  incidentId: string
  approvalRequestDisplayId: string
  durationMinutes: number
  activationToken: string
  now?: Date
}): Promise<{ grantDisplayId: string; expiresAt: Date }> {
  if (
    !Number.isInteger(args.durationMinutes) ||
    args.durationMinutes < MIN_DURATION_MINUTES ||
    args.durationMinutes > MAX_DURATION_MINUTES
  ) {
    throw new EmergencyAccessError(
      'INVALID_DURATION',
      `Duration must be ${MIN_DURATION_MINUTES}-${MAX_DURATION_MINUTES} minutes`,
    )
  }
  assertOpaqueReference(args.incidentId, 'Incident ID')
  if (args.activationToken.length < 32) {
    throw new EmergencyAccessError(
      'INVALID_TOKEN',
      'Activation token must be at least 32 characters',
    )
  }
  const now = args.now ?? new Date()
  const expiresAt = new Date(now.getTime() + args.durationMinutes * 60_000)
  const grantDisplayId = displayId('EAG')

  await withSystemTx({ tenantId: args.tenantId }, async (tx) => {
    const [target] = await tx
      .select({
        id: users.id,
        isActive: users.isActive,
        canLogin: users.canLogin,
        status: users.status,
        role: userRoles.role,
      })
      .from(users)
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.tenantId, args.tenantId),
          eq(userRoles.userId, users.id),
          eq(userRoles.role, 'TenantAdmin'),
          or(isNull(userRoles.expiresAt), gt(userRoles.expiresAt, now)),
        ),
      )
      .where(and(eq(users.tenantId, args.tenantId), eq(users.displayId, args.targetUserDisplayId)))
      .limit(1)
    if (!target || !target.isActive || !target.canLogin || target.status !== 'Active') {
      throw new EmergencyAccessError(
        'TARGET_NOT_ELIGIBLE',
        'Target must be an active login-enabled TenantAdmin in the named tenant',
      )
    }

    const [approval] = await tx
      .select({
        id: approvalRequests.id,
        requestType: approvalRequests.requestType,
        entityType: approvalRequests.entityType,
        entityId: approvalRequests.entityId,
        details: approvalRequests.details,
        status: approvalRequests.status,
        requiredApprovers: approvalRequests.requiredApprovers,
        approverRole: approvalRequests.approverRole,
        expiresAt: approvalRequests.expiresAt,
      })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.tenantId, args.tenantId),
          eq(approvalRequests.displayId, args.approvalRequestDisplayId),
        ),
      )
      .for('update')
      .limit(1)
    if (!approval) {
      throw new EmergencyAccessError('APPROVAL_NOT_FOUND', 'Approval request not found')
    }

    const details = parseApprovalDetails(approval.details)
    if (
      approval.requestType !== 'emergency_access' ||
      approval.entityType !== 'users' ||
      approval.entityId !== args.targetUserDisplayId ||
      details?.incidentId !== args.incidentId ||
      details.purpose !== PURPOSE
    ) {
      throw new EmergencyAccessError(
        'APPROVAL_SCOPE_MISMATCH',
        'Approval request does not match the incident, purpose, or target',
      )
    }
    if (
      approval.status !== 'Approved' ||
      approval.requiredApprovers < 2 ||
      approval.approverRole !== 'TenantAdmin' ||
      approval.expiresAt === null ||
      approval.expiresAt <= now
    ) {
      throw new EmergencyAccessError(
        'APPROVAL_NOT_AUTHORIZED',
        'Approval request is not an active two-TenantAdmin authorization',
      )
    }

    const verifiedApprovers = await tx
      .selectDistinct({ id: approvalDecisions.decidedById })
      .from(approvalDecisions)
      .innerJoin(
        users,
        and(
          eq(users.id, approvalDecisions.decidedById),
          eq(users.tenantId, args.tenantId),
          eq(users.isActive, true),
          eq(users.canLogin, true),
          eq(users.status, 'Active'),
          ne(users.displayId, args.targetUserDisplayId),
        ),
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, approvalDecisions.decidedById),
          eq(userRoles.tenantId, args.tenantId),
          eq(userRoles.role, 'TenantAdmin'),
          or(isNull(userRoles.expiresAt), gt(userRoles.expiresAt, now)),
        ),
      )
      .where(
        and(
          eq(approvalDecisions.tenantId, args.tenantId),
          eq(approvalDecisions.approvalRequestId, approval.id),
          eq(approvalDecisions.decision, 'Approved'),
          isNull(approvalDecisions.deletedAt),
        ),
      )
    if (verifiedApprovers.length < approval.requiredApprovers) {
      throw new EmergencyAccessError(
        'APPROVAL_NOT_AUTHORIZED',
        'Two current TenantAdmin approvals are required',
      )
    }

    await tx.insert(emergencyAccessGrants).values({
      displayId: grantDisplayId,
      tenantId: args.tenantId,
      incidentId: args.incidentId,
      targetUserId: target.id,
      purpose: PURPOSE,
      approvalRequestId: approval.id,
      tokenHash: hashEmergencyToken(args.activationToken),
      expiresAt,
      createdAt: now,
    })
  })

  return { grantDisplayId, expiresAt }
}

export async function executeEmergencyGrant(args: {
  tenantId: string
  grantDisplayId: string
  activationToken: string
  now?: Date
}): Promise<{ targetUserDisplayId: string; revokedRefreshTokens: number }> {
  const now = args.now ?? new Date()
  return withSystemTx({ tenantId: args.tenantId }, async (tx) => {
    const [grant] = await tx
      .select({
        id: emergencyAccessGrants.id,
        incidentId: emergencyAccessGrants.incidentId,
        targetUserId: emergencyAccessGrants.targetUserId,
        purpose: emergencyAccessGrants.purpose,
        tokenHash: emergencyAccessGrants.tokenHash,
        expiresAt: emergencyAccessGrants.expiresAt,
        usedAt: emergencyAccessGrants.usedAt,
        revokedAt: emergencyAccessGrants.revokedAt,
      })
      .from(emergencyAccessGrants)
      .where(
        and(
          eq(emergencyAccessGrants.tenantId, args.tenantId),
          eq(emergencyAccessGrants.displayId, args.grantDisplayId),
        ),
      )
      .for('update')
      .limit(1)
    if (!grant) throw new EmergencyAccessError('GRANT_NOT_FOUND', 'Grant not found')
    assertEmergencyGrantUsable(grant, now)
    if (!tokensMatch(args.activationToken, grant.tokenHash)) {
      throw new EmergencyAccessError('INVALID_TOKEN', 'Activation token is invalid')
    }

    const [target] = await tx
      .select({
        displayId: users.displayId,
        isActive: users.isActive,
        canLogin: users.canLogin,
        status: users.status,
        role: userRoles.role,
      })
      .from(users)
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.tenantId, args.tenantId),
          eq(userRoles.userId, users.id),
          eq(userRoles.role, 'TenantAdmin'),
          or(isNull(userRoles.expiresAt), gt(userRoles.expiresAt, now)),
        ),
      )
      .where(and(eq(users.tenantId, args.tenantId), eq(users.id, grant.targetUserId)))
      .limit(1)
    if (!target || !target.isActive || !target.canLogin || target.status !== 'Active') {
      throw new EmergencyAccessError('TARGET_NOT_ELIGIBLE', 'Target is no longer eligible')
    }

    await tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: now })
      .where(and(eq(users.tenantId, args.tenantId), eq(users.id, grant.targetUserId)))
    const revoked = await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokens.tenantId, args.tenantId),
          eq(refreshTokens.userId, grant.targetUserId),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ id: refreshTokens.id })
    await tx
      .update(emergencyAccessGrants)
      .set({ usedAt: now })
      .where(eq(emergencyAccessGrants.id, grant.id))

    await auditLog(tx, {
      tenantId: args.tenantId,
      userId: null,
      action: 'BREAK_GLASS',
      entityType: 'users',
      entityId: target.displayId,
      metadata: {
        emergencyGrantId: args.grantDisplayId,
        incidentId: grant.incidentId,
        purpose: PURPOSE,
        revokedRefreshTokens: revoked.length,
      },
    })
    return { targetUserDisplayId: target.displayId, revokedRefreshTokens: revoked.length }
  })
}

export async function revokeEmergencyGrant(args: {
  tenantId: string
  grantDisplayId: string
  now?: Date
}): Promise<void> {
  const now = args.now ?? new Date()
  const updated = await withSystemTx({ tenantId: args.tenantId }, (tx) =>
    tx
      .update(emergencyAccessGrants)
      .set({ revokedAt: now })
      .where(
        and(
          eq(emergencyAccessGrants.tenantId, args.tenantId),
          eq(emergencyAccessGrants.displayId, args.grantDisplayId),
          isNull(emergencyAccessGrants.usedAt),
          isNull(emergencyAccessGrants.revokedAt),
        ),
      )
      .returning({ id: emergencyAccessGrants.id }),
  )
  if (updated.length === 0) {
    throw new EmergencyAccessError('GRANT_NOT_FOUND', 'Unused active grant not found')
  }
}

function option(args: string[], name: string): string {
  const index = args.indexOf(`--${name}`)
  const value = index >= 0 ? args[index + 1] : undefined
  if (!value || value.startsWith('--')) throw new Error(`Missing --${name}`)
  return value
}

async function readTokenFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error('Activation token must be piped on stdin; interactive echo is prohibited')
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  const token = Buffer.concat(chunks).toString('utf8').trim()
  if (token.length < 32) throw new Error('Activation token must be at least 32 characters')
  return token
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  const tenantId = option(args, 'tenant')
  if (command === 'request') {
    const result = await createEmergencyAccessRequest({
      tenantId,
      requesterUserDisplayId: prefixedDisplayIdSchema('USR').parse(option(args, 'requester')),
      targetUserDisplayId: prefixedDisplayIdSchema('USR').parse(option(args, 'user')),
      incidentId: option(args, 'incident'),
    })
    process.stdout.write(
      `Approval request ${result.approvalRequestDisplayId} created; expires ${result.expiresAt.toISOString()}. Two authenticated TenantAdmin approvals are required.\n`,
    )
    return
  }
  if (command === 'grant') {
    const activationToken = await readTokenFromStdin()
    const result = await createEmergencyGrant({
      tenantId,
      targetUserDisplayId: prefixedDisplayIdSchema('USR').parse(option(args, 'user')),
      incidentId: option(args, 'incident'),
      approvalRequestDisplayId: prefixedDisplayIdSchema('APR').parse(option(args, 'approval')),
      durationMinutes: Number(option(args, 'duration')),
      activationToken,
    })
    process.stdout.write(
      `Grant ${result.grantDisplayId} created; expires ${result.expiresAt.toISOString()}. Token was not stored or printed.\n`,
    )
    return
  }
  if (command === 'execute') {
    const grantDisplayId = prefixedDisplayIdSchema('EAG').parse(option(args, 'grant'))
    const result = await executeEmergencyGrant({
      tenantId,
      grantDisplayId,
      activationToken: await readTokenFromStdin(),
    })
    process.stdout.write(
      `Grant ${grantDisplayId} consumed for ${result.targetUserDisplayId}; ${result.revokedRefreshTokens} refresh token(s) revoked.\n`,
    )
    return
  }
  if (command === 'revoke') {
    const grantDisplayId = prefixedDisplayIdSchema('EAG').parse(option(args, 'grant'))
    await revokeEmergencyGrant({ tenantId, grantDisplayId })
    process.stdout.write(`Grant ${grantDisplayId} revoked.\n`)
    return
  }
  throw new Error('Usage: request|grant|execute|revoke with the documented options')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    const code = error instanceof EmergencyAccessError ? error.code : 'COMMAND_FAILED'
    process.stderr.write(`Emergency access failed (${code}).\n`)
    process.exitCode = 1
  })
}
