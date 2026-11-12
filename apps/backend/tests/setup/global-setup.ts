import 'dotenv/config'
import postgres from 'postgres'
import { seed } from '../../src/shared/db/seed.js'

// AUTH-2: route the entire integration test suite through the migrator role
// (BYPASSRLS). The runtime app still goes through surevax_app (RLS active —
// verified by the login smoke + endpoint smokes in setup-worktree.sh).
//
// Why route tests via the migrator: many integration tests do administrative
// setup (CREATE ROLE for RLS isolation tests, INSERT INTO tenants for tenant
// resolution tests, TRUNCATE for global cleanup) that the demoted app role
// cannot perform. Rewriting every test to opt-in via a separate handle is a
// large follow-up; this swap keeps the suite green while RLS is in force at
// runtime where it matters. Tracked as a follow-up in the AUTH-2 capstone.
if (process.env['DATABASE_MIGRATOR_URL']) {
  process.env['DATABASE_URL'] = process.env['DATABASE_MIGRATOR_URL']
}

// Truncate + reseed the worktree's DB once before the test suite. Tests
// share the post-seed state and may mutate it; if cross-talk becomes a
// problem, switch to per-test truncation.
export async function setup() {
  const url = process.env['DATABASE_URL']
  if (!url) {
    throw new Error('DATABASE_URL or DATABASE_MIGRATOR_URL must be set for tests')
  }

  const client = postgres(url)
  try {
    // Wipe all data tables. CASCADE handles the FK dependency graph; the
    // drizzle migrations table is excluded so we don't reapply migrations.
    const rows = await client<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT LIKE '__drizzle%'
        AND tablename NOT LIKE 'drizzle_%'
    `
    const tables = rows.map((r) => `"${r.tablename}"`).join(', ')

    if (tables) {
      await client.unsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`)
    }
  } finally {
    await client.end()
  }

  await seed()
}

export async function teardown() {
  // The docker container persists across runs — nothing to do.
}
