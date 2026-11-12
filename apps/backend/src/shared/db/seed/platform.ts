/**
 * Seed section — platform_users (cross-tenant infrastructure operators).
 *
 * platform_users is NOT tenant-scoped and has NO audit trigger, so no tenant
 * GUC is needed. Two-tier IDs (W2, 2026-05-19): `id` is bigserial,
 * `display_id` is `PLU_<8 base32>`.
 */

import { sql } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import { PLATFORM_ADMIN_DISPLAY_ID } from './constants.js'

export async function seedPlatformUsers(
  passwordHash: string,
): Promise<{ platformAdminId: number }> {
  const inserted = await db
    .insert(s.platformUsers)
    .values({
      displayId: PLATFORM_ADMIN_DISPLAY_ID,
      email: 'platform@surevax.com',
      passwordHash,
      displayName: 'Platform Operator',
      isActive: true,
      canLogin: true,
    })
    .onConflictDoNothing()
    .returning({ id: s.platformUsers.id })

  let id = inserted[0]?.id
  if (id === undefined) {
    const [existing] = await db
      .select({ id: s.platformUsers.id })
      .from(s.platformUsers)
      .where(sql`${s.platformUsers.displayId} = ${PLATFORM_ADMIN_DISPLAY_ID}`)
      .limit(1)
    if (!existing) throw new Error('seedPlatformUsers: failed to resolve platform admin')
    id = existing.id
  }

  console.log('  ✓ platform_users (1)')
  return { platformAdminId: id }
}
