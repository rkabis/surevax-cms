import { sql } from 'drizzle-orm'
import { withPlatformTx } from './withTenantTx.js'
import { env } from '../config/env.js'
import { runtimeRoleIsPrivileged } from '../config/productionGuards.js'

type RuntimeRoleRow = {
  role_name: string
  is_superuser: boolean
  bypasses_rls: boolean
  can_create_db: boolean
  can_create_role: boolean
  can_replicate: boolean
}

export type DatabaseReadiness =
  | { ready: true; runtimeRole: string }
  | { ready: false; reason: 'database_unavailable' | 'privileged_runtime_role' }

export async function checkDatabaseReadiness(): Promise<DatabaseReadiness> {
  try {
    const rows = await withPlatformTx({ platformUserId: -1 }, (tx) =>
      tx.execute<RuntimeRoleRow>(sql`
        SELECT current_user::text AS role_name,
               r.rolsuper AS is_superuser,
               r.rolbypassrls AS bypasses_rls,
               r.rolcreatedb AS can_create_db,
               r.rolcreaterole AS can_create_role,
               r.rolreplication AS can_replicate
          FROM pg_roles r
         WHERE r.rolname = current_user
      `),
    )
    const role = Array.from(rows)[0]
    if (!role) return { ready: false, reason: 'database_unavailable' }
    if (
      env.NODE_ENV === 'production' &&
      runtimeRoleIsPrivileged({
        isSuperuser: role.is_superuser,
        bypassesRls: role.bypasses_rls,
        canCreateDb: role.can_create_db,
        canCreateRole: role.can_create_role,
        canReplicate: role.can_replicate,
      })
    ) {
      return { ready: false, reason: 'privileged_runtime_role' }
    }
    return { ready: true, runtimeRole: role.role_name }
  } catch {
    return { ready: false, reason: 'database_unavailable' }
  }
}
