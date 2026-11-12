/**
 * Seed section — audit_logs sample rows for the dashboard timeline.
 *
 * Two-tier IDs (W3.c.3, 2026-05-19):
 *   - `audit_logs.id` is bigserial — Postgres assigns; the seed does NOT
 *     generate `AUD-…` strings.
 *   - `audit_logs.entity_id` (text) stores the parent row's display_id
 *     (e.g. `PAT_AAAAAAB0`). The audit trigger normally denormalizes
 *     `entity_display_id` from the target row, but here we bypass the
 *     trigger by inserting directly, so we set `entity_display_id`
 *     explicitly to the same value.
 *   - User/branch FKs are bigint internals passed in by the caller.
 *
 * Audit-action enum (W1.B, 2026-05-18): `READ` dropped; LOGIN_FAILED,
 * BREAK_GLASS, EXPORT, PRINT, PERMISSION_CHANGE, CONFIG_CHANGE,
 * AUDIT_ACCESS added. We use the new actions where they fit the seed
 * narrative.
 *
 * Soft-skips rows whose parent display_id isn't present in the
 * supplied `patients` map — the seed only opt-in wires the entities
 * referenced by the current wave.
 */

import { sql } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import { daysAgo, today } from './helpers.js'
import { PAT_AGUILAR_DISPLAY_ID, PAT_LUNA_DISPLAY_ID } from './constants.js'

export type AuditSeedUsers = {
  admin: number
  physician: number
  nurse: number
  /** Optional secondary nurse — soft-skipped if absent. */
  nurse2?: number | undefined
  cashier: number
}

export type SeedAuditArgs = {
  tenantId: string
  branchId: number
  users: AuditSeedUsers
  /**
   * Optional map of patient `display_id → bigint`. When present, audit rows
   * referencing patient display_ids are kept; when absent, those rows are
   * dropped (the seed still emits user-scoped rows like login/logout).
   */
  patients?: Map<string, number>
}

type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'LOGIN_FAILED'
  | 'BREAK_GLASS'
  | 'CROSS_BRANCH_ACCESS'
  | 'TRANSACTION_MODIFY'
  | 'SCHEDULE_CHANGE'
  | 'PERMISSION_CHANGE'
  | 'CONFIG_CHANGE'
  | 'EXPORT'
  | 'PRINT'
  | 'AUDIT_ACCESS'

type AuditRow = {
  action: AuditAction
  entityType: string
  /** Parent row display_id (e.g. `PAT_AAAAAAB0`). null for session-scoped rows. */
  entityId: string | null
  userId: number
  timestamp: Date
  changes: Record<string, unknown>
  /**
   * When set, soft-skip the row unless this patient display_id is present in
   * the supplied `patients` map.
   */
  requiresPatient?: string
}

export async function seedAudit({
  tenantId,
  branchId,
  users,
  patients,
}: SeedAuditArgs): Promise<void> {
  const auditRows: AuditRow[] = [
    // ── Session events (no entityId) ─────────────────────────────────────────
    {
      action: 'LOGIN',
      entityType: 'session',
      entityId: null,
      userId: users.admin,
      timestamp: today(8, 0),
      changes: { description: 'Admin logged in' },
    },
    {
      action: 'LOGIN',
      entityType: 'session',
      entityId: null,
      userId: users.physician,
      timestamp: today(7, 45),
      changes: { description: 'Physician logged in' },
    },
    {
      action: 'LOGIN',
      entityType: 'session',
      entityId: null,
      userId: users.nurse,
      timestamp: today(7, 30),
      changes: { description: 'Nurse logged in' },
    },
    {
      action: 'LOGIN',
      entityType: 'session',
      entityId: null,
      userId: users.cashier,
      timestamp: today(8, 15),
      changes: { description: 'Cashier logged in' },
    },
    {
      action: 'LOGIN_FAILED',
      entityType: 'session',
      entityId: null,
      userId: users.cashier,
      timestamp: daysAgo(1, 7, 55),
      changes: { description: 'Cashier failed login (wrong password)', attempt: 1 },
    },
    {
      action: 'LOGOUT',
      entityType: 'session',
      entityId: null,
      userId: users.nurse,
      timestamp: daysAgo(1, 16, 5),
      changes: { description: 'Nurse logged out' },
    },

    // ── Patient lifecycle events (require patient map) ──────────────────────
    {
      action: 'CREATE',
      entityType: 'patient',
      entityId: PAT_AGUILAR_DISPLAY_ID,
      userId: users.nurse,
      timestamp: daysAgo(5, 8, 20),
      changes: {
        description: 'Registered patient: Aguilar, Roberto',
        fields: ['firstName', 'lastName', 'dateOfBirth', 'contactNumber'],
      },
      requiresPatient: PAT_AGUILAR_DISPLAY_ID,
    },
    {
      action: 'CREATE',
      entityType: 'patient',
      entityId: PAT_LUNA_DISPLAY_ID,
      userId: users.nurse,
      timestamp: daysAgo(10, 8, 30),
      changes: {
        description: 'Registered patient: Luna, Dennis',
        fields: ['firstName', 'lastName', 'dateOfBirth', 'contactNumber', 'email'],
      },
      requiresPatient: PAT_LUNA_DISPLAY_ID,
    },
    {
      action: 'DELETE',
      entityType: 'patient',
      entityId: null,
      userId: users.admin,
      timestamp: daysAgo(3, 16, 0),
      changes: {
        description: 'Soft-deleted patient: Test Patient (duplicate registration)',
        reason: 'Duplicate',
      },
    },

    // ── Inventory + admin events (entityId-less; narrative only) ────────────
    {
      action: 'UPDATE',
      entityType: 'inventory_lot',
      entityId: null,
      userId: users.nurse,
      timestamp: daysAgo(1, 9, 0),
      changes: {
        description: 'Quarantined PVRV lot VRB-2025-099',
        before: { isQuarantined: false },
        after: { isQuarantined: true, reason: 'Near expiry' },
      },
    },
    {
      action: 'PERMISSION_CHANGE',
      entityType: 'user',
      entityId: null,
      userId: users.admin,
      timestamp: daysAgo(2, 14, 30),
      changes: {
        description: 'Granted BranchAdmin to nurse on Holy Spirit branch',
        before: { roles: ['Nurse'] },
        after: { roles: ['Nurse', 'BranchAdmin'] },
      },
    },
    {
      action: 'CONFIG_CHANGE',
      entityType: 'feature_flag',
      entityId: null,
      userId: users.admin,
      timestamp: daysAgo(4, 11, 0),
      changes: {
        description: 'Enabled stockout_alerts feature flag for SVX',
        before: { enabled: false },
        after: { enabled: true },
      },
    },
    {
      action: 'EXPORT',
      entityType: 'transaction',
      entityId: null,
      userId: users.cashier,
      timestamp: daysAgo(1, 17, 0),
      changes: {
        description: 'Exported day-end transactions CSV',
        rowCount: 42,
      },
    },
    {
      action: 'PRINT',
      entityType: 'transaction',
      entityId: null,
      userId: users.cashier,
      timestamp: today(10, 50),
      changes: {
        description: 'Printed official receipt',
      },
    },
    {
      action: 'AUDIT_ACCESS',
      entityType: 'audit_log',
      entityId: null,
      userId: users.admin,
      timestamp: daysAgo(2, 16, 30),
      changes: {
        description: 'Reviewed weekly audit timeline',
        rangeDays: 7,
      },
    },
    {
      action: 'BREAK_GLASS',
      entityType: 'patient',
      entityId: null,
      userId: users.physician,
      timestamp: daysAgo(6, 22, 15),
      changes: {
        description: 'Emergency PHI access (after hours)',
        justification: 'Suspected rabies exposure — bite history needed',
      },
    },
    {
      action: 'CROSS_BRANCH_ACCESS',
      entityType: 'patient',
      entityId: null,
      userId: users.physician,
      timestamp: daysAgo(1, 11, 0),
      changes: {
        description: 'Physician accessed patient from non-primary branch',
        targetBranchCode: 'TMG',
      },
    },
    {
      action: 'TRANSACTION_MODIFY',
      entityType: 'transaction',
      entityId: null,
      userId: users.cashier,
      timestamp: daysAgo(1, 14, 0),
      changes: {
        description: 'Voided duplicate charge',
        reason: 'Duplicate entry',
      },
    },
    {
      action: 'SCHEDULE_CHANGE',
      entityType: 'clinical_order',
      entityId: null,
      userId: users.physician,
      timestamp: daysAgo(2, 11, 0),
      changes: {
        description: 'Reschedule request — day 7 → day 10 (rejected)',
        decision: 'rejected',
      },
    },
    {
      action: 'CREATE',
      entityType: 'approval_request',
      entityId: null,
      userId: users.cashier,
      timestamp: daysAgo(1, 11, 30),
      changes: { description: 'Void request submitted (duplicate charge)' },
    },
    {
      action: 'UPDATE',
      entityType: 'approval_request',
      entityId: null,
      userId: users.admin,
      timestamp: daysAgo(1, 15, 0),
      changes: {
        description: 'Approved quarantine request for PVRV lot VRB-2025-099',
        decision: 'approved',
      },
    },
  ]

  // The audit trigger normally raises when app.current_tenant_id is unset, but
  // the seed already sets it via setSeedTenantContext. We insert directly into
  // audit_logs (bypassing the trigger that would normally populate
  // entity_display_id from the audited table) so set the column explicitly.
  let kept = 0
  let skipped = 0
  for (const log of auditRows) {
    if (log.requiresPatient && (!patients || !patients.has(log.requiresPatient))) {
      skipped++
      continue
    }
    await db
      .insert(s.auditLogs)
      .values({
        tenantId,
        branchId,
        userId: log.userId,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        // entity_display_id mirrors entity_id when set, since both are
        // already the parent row's display_id.
        entityDisplayId: log.entityId,
        ipAddress: `192.168.1.${10 + (kept % 25)}`,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        changes: sql`${JSON.stringify(log.changes)}::jsonb`,
        timestamp: log.timestamp,
      })
      .onConflictDoNothing()
    kept++
  }

  console.log(
    `  ✓ audit logs (${kept} inserted${skipped > 0 ? `, ${skipped} skipped — missing entity` : ''})`,
  )
}
