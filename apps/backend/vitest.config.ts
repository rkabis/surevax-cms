import { defineConfig } from 'vitest/config'

// Two test suites:
// - unit: pure in-process tests (no DB): `tests/unit/**` and `tests/money.test.ts`
// - integration: supertest + Postgres, the rest of `tests/**`; requires `pnpm run setup` first.
//
// `pnpm test` runs both. `pnpm test --project unit` runs only the unit suite.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/money.test.ts', 'tests/unit/**/*.test.ts'],
          // No globalSetup — these tests are pure in-process.
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/money.test.ts', 'tests/unit/**/*.test.ts'],
          globalSetup: ['./tests/setup/global-setup.ts'],
          // Run all integration files in a single process — they share a Postgres
          // database and concurrent writes would race.
          fileParallelism: false,
          // Tests do real I/O (DB + supertest); 30s gives plenty of headroom.
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/shared/db/migrate.ts',
        'src/shared/db/seed.ts',
        'src/shared/db/schema.ts',
      ],
      // M15: enforce a minimum line + function coverage so coverage erosion
      // is visible. Current baseline is intentionally low — raise as new
      // tests land. Run via `pnpm test:coverage` or in CI when wired.
      thresholds: {
        lines: 60,
        functions: 50,
        statements: 60,
        branches: 50,
      },
    },
  },
})
