/**
 * withRollback — per-test BEGIN/ROLLBACK isolation helper.
 *
 * PURPOSE
 * -------
 * Integration tests that share a post-seed Postgres database can interfere
 * with each other when one test's INSERT/UPDATE is visible to the next test's
 * SELECT. The canonical workaround (`Date.now()` suffixes on IDs) produces
 * leftover rows that accumulate across runs and occasionally leak across tests.
 *
 * `withRollback` opens a real Postgres transaction, runs the test body, then
 * unconditionally rolls back — so every row the test touched disappears and
 * the DB returns to seed state automatically.
 *
 * HOW IT WORKS
 * ------------
 * postgres-js `client.begin(async sql => { ... })` opens a transaction and
 * commits when the callback resolves. If the callback throws, postgres-js
 * rolls back instead. We exploit this: after the test body completes (even
 * if it resolves successfully), we throw a private `ROLLBACK_SENTINEL` symbol
 * to force the rollback path. The helper catches that specific symbol and
 * returns the test result normally.
 *
 * USAGE
 * -----
 * ```typescript
 * import postgres from 'postgres'
 * import { withRollback } from '../setup/withRollback'
 *
 * const client = postgres(process.env.DATABASE_URL!)
 *
 * it('my test', async () => {
 *   await withRollback(client, async (sql) => {
 *     // All writes in here are rolled back on exit.
 *     // Set RLS GUCs explicitly — withRollback does NOT set them automatically
 *     // because the tenant context varies per test.
 *     await sql`SELECT set_config('app.current_tenant_id', 'SVX', true)`
 *     await sql`SELECT set_config('app.current_user_id', '1', true)`
 *     await sql`SELECT set_config('app.current_branch_id', '', true)`
 *
 *     const rows = await sql`SELECT * FROM patients LIMIT 1`
 *     expect(rows.length).toBeGreaterThan(0)
 *   })
 * })
 * ```
 *
 * AUDIT TRIGGER CAVEAT
 * --------------------
 * The audit trigger raises an exception when `app.current_tenant_id` is unset
 * on a tenant-scoped write. `withRollback` does NOT set this GUC automatically
 * because the tenant context varies per test. Tests that write to audited
 * tenant-scoped tables MUST call:
 *
 *   await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
 *
 * inside the `withRollback` callback, BEFORE any INSERT/UPDATE/DELETE.
 *
 * DRIZZLE / withTenantTx CAVEAT
 * ------------------------------
 * The `sql` handle passed to the callback is a raw postgres-js transaction
 * handle — NOT a Drizzle instance. Code that calls `db.transaction(...)` or
 * `withTenantTx(...)` inside the callback will open its OWN connection from
 * the Drizzle pool and will NOT participate in this rollback. Such writes will
 * persist to the database.
 *
 * For tests that mix Drizzle helpers with rollback isolation, use the `sql`
 * handle directly for setup/teardown data and limit `db.transaction()` calls
 * to the assertions you WANT to persist — or use `beforeAll`/`afterAll` with
 * explicit cleanup for the outer data fixtures.
 *
 * SUPERTEST CAVEAT
 * ----------------
 * `withRollback` does not work with supertest-based tests. When the test fires
 * an HTTP request through supertest, the app's Express handlers run in the app's
 * own connection pool — completely separate from the `withRollback` transaction.
 * Those writes are NOT rolled back. For supertest tests, use:
 *   - Per-test sub-tenant fixtures with deterministic IDs (not Date.now())
 *   - Full `beforeAll`/`afterAll` cleanup with explicit DELETE/TRUNCATE
 */

import postgres from 'postgres'

const ROLLBACK_SENTINEL = Symbol('withRollback-sentinel')

/**
 * Run `fn` inside a Postgres transaction that ALWAYS rolls back on exit,
 * regardless of whether `fn` resolves or rejects.
 *
 * The callback receives a raw postgres-js transaction handle (`sql`). Use it
 * for all DB interactions that should be rolled back. See file-level JSDoc
 * for the Drizzle/withTenantTx and supertest caveats.
 *
 * @param client  A postgres-js client (NOT a Drizzle instance).
 * @param fn      Test body. Receives the transaction `sql` handle.
 * @returns       The resolved value of `fn` (after rollback has completed).
 */
export async function withRollback<T>(
  client: ReturnType<typeof postgres>,
  fn: (sql: ReturnType<typeof postgres<Record<string, unknown>[]>>) => Promise<T>,
): Promise<T> {
  let result: T | undefined
  let testError: unknown
  let testFailed = false

  try {
    await (client as postgres.Sql).begin(async (tx) => {
      try {
        result = await fn(tx as unknown as ReturnType<typeof postgres<Record<string, unknown>[]>>)
      } catch (err) {
        // Capture test failures so we can re-throw them after rollback.
        testError = err
        testFailed = true
      }
      // Always throw ROLLBACK_SENTINEL to force postgres-js to roll back.

      throw ROLLBACK_SENTINEL
    })
  } catch (err) {
    if (err !== ROLLBACK_SENTINEL) {
      // Unexpected error from postgres-js itself (connection failure, etc.)
      throw err
    }
    // ROLLBACK_SENTINEL is the expected path — rollback completed.
  }

  if (testFailed) throw testError
  return result as T
}
