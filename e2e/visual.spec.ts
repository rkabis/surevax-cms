import { test, expect } from '@playwright/test'

/**
 * Visual regression at the clinic's real resolution (2560×1440).
 *
 * The design-system gates check MARKUP (class strings); these snapshots
 * check PIXELS — a broken token value, font fallback, or layout collapse
 * passes lint/typecheck but fails here.
 *
 * LOCAL-ONLY by default (set VISUAL=1 to run): baselines are rendered on
 * the developer's platform and committed under e2e/visual.spec.ts-snapshots/.
 * CI skips until linux baselines are generated in CI. Rebaseline after an
 * intentional visual change:
 *
 *   VISUAL=1 pnpm test:e2e --project=visual --update-snapshots
 *
 * Keep this suite SMALL and stable: masked dynamic regions (dates, live
 * counts) and only the surfaces that define the design system.
 */

const RUN = !!process.env['VISUAL']

test.describe('visual snapshots @ 2560×1440', () => {
  test.skip(!RUN, 'visual suite is opt-in — set VISUAL=1')

  // Live numbers/dates change per seed-day; mask anything time-derived.
  const maskSelectors = ['[class*="tabular-nums"]', 'time'] as const

  for (const { name, path, settle } of [
    { name: 'today-cockpit', path: '/today', settle: 'text=In clinic' },
    { name: 'scheduled-orders', path: '/scheduled-orders', settle: 'tbody tr' },
    { name: 'patients', path: '/patients', settle: 'tbody tr' },
    { name: 'transactions', path: '/transactions?view=all', settle: 'tbody tr' },
    { name: 'receivables', path: '/receivables', settle: 'tbody tr' },
  ]) {
    test(name, async ({ page }) => {
      await page.goto(path)
      await page.waitForSelector(settle, { timeout: 15_000 })
      // Fonts + sparkline/strip paints settle fast; small grace beats flake.
      await page.waitForTimeout(600)
      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: false,
        mask: maskSelectors.map((s) => page.locator(s)),
        maxDiffPixelRatio: 0.02,
      })
    })
  }
})
