import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright end-to-end config for the SureVax CMS frontend.
 *
 * These tests drive a real Chromium browser against the running app
 * (`pnpm dev`): the Vite frontend on its per-worktree port, which proxies
 * `/api/*` to the Express backend, which talks to the seeded Postgres DB.
 * This is true end-to-end — RLS, the audit trigger, FEFO, and the real
 * tenant-resolution middleware are all exercised, not mocked. The Vitest +
 * Testing Library + MSW suite under `apps/frontend/src` covers the
 * component layer; this suite covers cross-page user journeys.
 *
 * Local run (servers auto-start via `webServer`, or reuse a running
 * `pnpm dev`):  `pnpm test:e2e`: the port is read from
 * `apps/frontend/.env.local`, so this works in any worktree without a flag.
 *
 * Override the base URL explicitly when needed:
 *   PLAYWRIGHT_BASE_URL=http://localhost:5173 pnpm test:e2e
 *
 * Auth state is established once by `e2e/auth.setup.ts` (the `setup`
 * project) and reused via storageState — see `e2e/fixtures/test-data.ts`.
 */

/**
 * The frontend's dev port is computed per worktree by
 * `scripts/setup-worktree.sh` (sha1 of the worktree name → 0..99 offset) and
 * written to `apps/frontend/.env.local` as `VITE_DEV_PORT`. Read it from there
 * rather than hard-coding one worktree's number: a literal default means
 * `pnpm test:e2e` waits on a port nothing is serving and dies with an opaque
 * "Timed out waiting 180000ms from config.webServer" in every worktree whose
 * offset differs. `PLAYWRIGHT_BASE_URL` still wins (CI serves on 5173).
 */
function resolveDevPort(): string {
  try {
    // cwd-relative, not `import.meta.url`: Playwright loads this config through
    // a CJS-compatible path, and `import.meta` forces ESM interpretation, which
    // fails with "exports is not defined in ES module scope". `pnpm test:e2e`
    // always runs from the repo root.
    const env = readFileSync(resolve(process.cwd(), 'apps/frontend/.env.local'), 'utf8')
    return /^VITE_DEV_PORT=(\d+)$/m.exec(env)?.[1] ?? '5173'
  } catch {
    // No .env.local yet (fresh clone, CI): fall back to Vite's own default.
    return '5173'
  }
}

const baseURL = process.env['PLAYWRIGHT_BASE_URL'] ?? `http://localhost:${resolveDevPort()}`
const isCI = !!process.env['CI']

export default defineConfig({
  testDir: './e2e',
  // Mutating journeys (administer, register, take payment) run against a
  // shared seeded DB; serialise so two tests never race for the same row.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    timezoneId: 'Asia/Manila',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    // Logs in once per role and writes storageState files the other
    // projects load. Runs before everything else via `dependencies`.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Front-desk clinic Mac is 2560×1440; KPI strips assume the wide
        // viewport (see memory: KPI strips overlap below ~1200px).
        viewport: { width: 1440, height: 900 },
        // Default persona is the shared per-branch `Branch` service account —
        // the real single-operator clinic login. The nurse on duty signs in as
        // the branch and does everything: register walk-ins, administer doses,
        // take payment, record which physician authorised a standing order.
        // The TenantAdmin storageState (admin.json) is still produced by the
        // setup project for any admin-only test.
        storageState: 'e2e/.auth/branch.json',
      },
      dependencies: ['setup'],
      // `readiness/` is excluded on purpose: it is the nurse-testing readiness
      // checklist, not a merge gate. See the `readiness` project below.
      testIgnore: [/auth\.setup\.ts/, /visual\.spec\.ts/, /readiness\//],
    },
    // Visual-regression project — pixel snapshots at the real clinic
    // resolution (2560×1440). LOCAL-ONLY by default: baselines are
    // platform-specific (font rasterisation differs darwin vs linux), so
    // CI skips it until linux baselines are generated in CI itself. Run:
    //   VISUAL=1 pnpm test:e2e --project=visual
    //   VISUAL=1 pnpm test:e2e --project=visual --update-snapshots  # rebaseline
    {
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 2560, height: 1440 },
        storageState: 'e2e/.auth/branch.json',
      },
      dependencies: ['setup'],
    },
    // Nurse-testing readiness checklist (`e2e/readiness/`). OPT-IN via
    // READINESS=1, so it is never registered during a plain `pnpm test:e2e`
    // and cannot gate a merge:
    //
    //   pnpm test:readiness
    //
    // Rationale: these specs answer "can a nurse do their job yet?", not "did
    // this commit regress?". Several are `test.fixme` placeholders describing
    // capabilities that do not exist yet, and the passing ones assert against
    // seeded stock that a pilot consumes. A red checklist is a status report
    // for the owner, not a broken build. Runs as the same `Branch` persona,
    // because that is the only login a real clinic uses.
    ...(process.env['READINESS']
      ? [
          {
            name: 'readiness',
            testMatch: /readiness\/.*\.spec\.ts/,
            use: {
              ...devices['Desktop Chrome'],
              // The clinic's real front-desk Mac is 2560x1440, and that is not a
              // cosmetic detail here: `DetailRail` is non-modal only at `2xl`
              // (Pattern 6), so below that breakpoint Radix marks the rest of
              // the page `aria-hidden` while a rail is open and every
              // role-based query against the list returns nothing. Testing at
              // 1440 would test a configuration no clinic uses, and would make
              // "administer and collect without leaving the worklist" look
              // broken when it is not.
              viewport: { width: 2560, height: 1440 },
              storageState: 'e2e/.auth/branch.json',
            },
            dependencies: ['setup'],
          },
        ]
      : []),
  ],
  // Reuses an already-running `pnpm dev` (local + CI where the workflow
  // starts the stack as a prior step); otherwise boots it.
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
