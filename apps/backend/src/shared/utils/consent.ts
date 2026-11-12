/**
 * assertActiveConsent — DPA §19 + §34(b) enforcement gate.
 *
 * Throws when no active (non-revoked, non-deleted) consent row exists for the
 * given patient within the tenant.  Must be called at the START of every
 * clinical-write transaction (administer, lab-order create, encounter create,
 * bundle fan-out) BEFORE any mutation.
 *
 * Runs inside the CALLER's existing `withTenantTx` — do NOT open a new tx.
 *
 * Scope semantics (Phase 1): any non-revoked, non-deleted consent row for
 * (tenantId, patientId) satisfies the gate.  Type/scope discrimination is a
 * follow-up once an ops decision on which consentType values gate which
 * clinical acts has been made.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { consents } from '../db/schema.js'
import { LifecycleError } from '../../modules/transactions/db.js'
import type { Tx } from '../db/withTenantTx.js'

export async function assertActiveConsent(
  tx: Tx,
  tenantId: string,
  patientId: number,
): Promise<void> {
  const [row] = await tx
    .select({ id: consents.id })
    .from(consents)
    .where(
      and(
        eq(consents.tenantId, tenantId),
        eq(consents.patientId, patientId),
        isNull(consents.revokedAt),
        isNull(consents.deletedAt),
      ),
    )
    .limit(1)

  if (!row) {
    throw new LifecycleError(
      'Active patient consent required (consent revoked or never obtained)',
      'CONSENT_REVOKED',
      403,
    )
  }
}
