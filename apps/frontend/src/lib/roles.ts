/**
 * Role predicates, in one place.
 *
 * These sets are security-relevant and were previously copy-pasted into six
 * components, which is how they drifted apart. Each set below states which
 * backend gate it mirrors; keep them in step when that gate changes.
 */

/**
 * May reach `/admin/*` pages and see the admin nav group.
 *
 * `SuperAdmin` is the legacy enum value from the Wave 2.2 rename. It is kept
 * here because a pre-rename `user_roles` row would otherwise lose admin
 * navigation entirely; `TenantAdmin` is the canonical name for new code.
 */
export const ADMIN_ROLES: ReadonlySet<string> = new Set([
  'TenantAdmin',
  'SuperAdmin',
  'BranchAdmin',
])

/**
 * May create a service or change a price.
 *
 * Exact mirror of `requireRole('TenantAdmin', 'BranchAdmin')` on the write
 * routes in `apps/backend/src/modules/service_catalog/routes.ts`. `SuperAdmin`
 * is deliberately absent: the backend gate does not accept it, so including it
 * here would render a create/edit affordance whose save returns 403.
 */
export const CATALOG_WRITE_ROLES: ReadonlySet<string> = new Set(['TenantAdmin', 'BranchAdmin'])

/**
 * May access corporate group billing. Mirrors the group-bills backend mount;
 * keep this a UI guard only—the route layer remains the authoritative control.
 */
export const BILLING_ROLES: ReadonlySet<string> = new Set([
  'Cashier',
  'Branch',
  'BranchAdmin',
  'TenantAdmin',
])

/**
 * May open the branch-scoped runtime Review Center.
 * Mirrors the `/api/review-center` mount in `apps/backend/src/app.ts`.
 */
export const REVIEW_CENTER_ROLES: ReadonlySet<string> = new Set([
  'TenantAdmin',
  'BranchAdmin',
  'Physician',
  'Nurse',
  'Branch',
])

/**
 * May operate the shared physical cash drawer.
 * Mirrors the `/api/cash-drawer` mount in `apps/backend/src/app.ts`.
 */
export const CASH_DRAWER_ROLES: ReadonlySet<string> = new Set([
  'TenantAdmin',
  'BranchAdmin',
  'Cashier',
  'Branch',
])

/** True when the user is signed in and holds one of `roles`. */
export function hasRole(
  user: { role: string } | null | undefined,
  roles: ReadonlySet<string>,
): boolean {
  return !!user && roles.has(user.role)
}
