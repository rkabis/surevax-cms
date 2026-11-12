/**
 * Shared constants for the E2E suite — seeded credentials, storageState
 * paths, and the tenant slug. Mirrors the seed in
 * `apps/backend/src/shared/db/seed.ts` and the test-credentials table in
 * `.claude/rules/gotchas.md`.
 */

export const TENANT_SLUG = 'SVX'

export interface SeededUser {
  email: string
  password: string
  role: string
  /** Where the LoginPage navigates this role after a successful sign-in. */
  landing: string
}

export const USERS: Record<'admin' | 'branch', SeededUser> = {
  // TenantAdmin — full nav access, ungated. Primary E2E persona.
  admin: {
    email: 'admin@surevax.com',
    password: 'TestPass123!',
    role: 'TenantAdmin',
    // LoginPage.tsx: non-Branch roles land on /patients.
    landing: '/patients',
  },
  // Branch service account — the real single-operator clinic persona.
  branch: {
    email: 'branch-main@surevax.com',
    password: 'TestPass123!',
    role: 'Branch',
    // LoginPage.tsx: Branch role lands on /branch/kiosk.
    landing: '/branch/kiosk',
  },
}

export const STORAGE = {
  admin: 'e2e/.auth/admin.json',
  branch: 'e2e/.auth/branch.json',
} as const
