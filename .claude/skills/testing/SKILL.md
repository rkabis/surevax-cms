---
name: testing
description: SureVax CMS test-layer conventions — the frontend component layer (Vitest + Testing Library + MSW in jsdom, setupTests.ts, renderWithProviders, per-file cleanup, password-input query workaround) and backend integration isolation via the BEGIN/ROLLBACK withRollback helper, including its audit-trigger GUC, Drizzle/withTenantTx, and supertest caveats. Use when writing or fixing frontend component tests or backend integration tests.
---

# Test layers & isolation

Migrated out of `.claude/rules/patterns.md` on 2026-08-03 to keep the always-loaded budget
down. Content unchanged, and re-extracted after rebasing onto main so it
carries main's latest edits to these sections.

## Frontend test infrastructure (H11, landed Wave 4)

> This section is the **component/unit** layer (jsdom + MSW, no real backend).
> The **browser E2E** layer (Playwright, real Chromium against the full seeded
> stack) lives at repo root in [`e2e/`](../../e2e) with `playwright.config.ts` —
> see [`risks.md`](risks.md) #3. Auth state is established once per role by
> `e2e/auth.setup.ts`; the default persona is the `Branch` operator account.
> Run with `pnpm test:e2e`. Use E2E for cross-page journeys (login → administer →
> payment, the Arrivals wizard, the cashier flow); use the jsdom layer below for
> per-component logic.

The test scaffold lives in `apps/frontend/src/`:

| File                         | Purpose                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setupTests.ts`              | MSW server lifecycle (`beforeAll/afterEach/afterAll`), `@testing-library/jest-dom` matchers, `ResizeObserver` polyfill for Radix UI                  |
| `test-utils/msw-handlers.ts` | Default MSW v2 request handlers (`/api/auth/login`, `/api/auth/me`, `/api/patients`). Override per-test with `server.use(http.post(...))`.           |
| `test-utils/render.tsx`      | `renderWithProviders(ui, opts?)` — wraps with `QueryClientProvider` (retry-off) + `MemoryRouter`. Re-exports `@testing-library/react` + `userEvent`. |

**Key conventions:**

- `environment: 'jsdom'` in `vitest.config.ts`; `@vitejs/plugin-react` plugin required for JSX in tests.
- Each test file that renders components must call `afterEach(() => cleanup())` explicitly — vitest parallelizes files so the global RTL auto-cleanup may not fire between tests in the same file when using `screen` (use `within(container)` to scope queries to a specific render).
- MSW runs in **node** mode (not browser). Relative fetch URLs (`/api/...`) work when `API_BASE_URL` is empty (dev default).
- Password inputs aren't labellable via `getByLabelText` due to shadcn's FormItem wrapper. Use `container.querySelector('input[name="password"]')` instead.

## BEGIN/ROLLBACK test isolation (H14)

Integration tests share a post-seed Postgres database. Without isolation, one test's
INSERT is visible to the next test's SELECT, and `Date.now()` suffixes on IDs accumulate
as leftover rows across runs.

**Helper**: `apps/backend/tests/setup/withRollback.ts`

```typescript
import postgres from 'postgres'
import { withRollback } from '../setup/withRollback'

const pgClient = postgres(process.env['DATABASE_URL']!)

it('my isolated test', async () => {
  await withRollback(pgClient, async (sql) => {
    // Set RLS GUCs BEFORE writing to audited tenant-scoped tables:
    await sql`SELECT set_config('app.current_tenant_id', 'SVX', true)`
    await sql`SELECT set_config('app.current_user_id', ${String(userId)}, true)`
    await sql`SELECT set_config('app.current_branch_id', '', true)`

    // All INSERTs/UPDATEs/DELETEs here are rolled back on exit.
    const rows = await sql`SELECT * FROM patients LIMIT 1`
    expect(rows.length).toBeGreaterThan(0)
  })
})
```

**How it works**: postgres-js `client.begin(fn)` opens a transaction and commits when `fn`
resolves. `withRollback` always throws a private `ROLLBACK_SENTINEL` symbol after `fn`
completes, forcing postgres-js into the rollback path. The sentinel is caught and the test
result is returned normally.

**Audit trigger caveat**: The audit trigger raises when `app.current_tenant_id` is unset
on any audited tenant-scoped write. `withRollback` does NOT set this GUC automatically —
tests must set it explicitly via `sql\`SELECT set_config('app.current_tenant_id', ...)\``
BEFORE any INSERT/UPDATE/DELETE.

**Drizzle / `withTenantTx` caveat**: The `sql` handle is a raw postgres-js transaction
handle, NOT a Drizzle instance. Calls to `db.transaction()` or `withTenantTx()` inside
the callback open their own connection from the Drizzle pool and are NOT rolled back.
Use `beforeAll`/`afterAll` with explicit cleanup for fixture data that uses Drizzle helpers.

**`supertest` caveat**: `withRollback` does NOT work with supertest-based tests. Supertest
fires real HTTP requests through the app's own connection pool — those writes bypass the
`withRollback` transaction entirely. For supertest tests, use `beforeAll`/`afterAll` with
explicit DELETE/TRUNCATE cleanup, or deterministic sub-tenant fixtures.

**When to use `Date.now()` suffixes vs. `withRollback`**:

- Persistent DDL (Postgres roles) and outer fixture data (test tenants, branches) created
  in `beforeAll` → keep `Date.now()` suffix since they persist across tests.
- Ephemeral data created inside an `it()` body → use `withRollback` with a fixed
  deterministic ID; rollback guarantees no collision.

**Canonical**: `apps/backend/tests/integration/rls-multi-tenant.test.ts`

- Coverage thresholds are 1% — intentionally low baseline (3 tests cover ~3.6% of 6500+ lines). Raise incrementally as test files are added.
