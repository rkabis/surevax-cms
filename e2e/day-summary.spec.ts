import { test, expect } from '@playwright/test'
import { manilaCalendarDate } from './fixtures/manila-date'

/**
 * End-of-day reconciliation, the closing half of the clinic's daily loop
 * (register → administer → pay → **reconcile**). The `/day-summary` page IS the
 * generated end-of-day report (A4 print stylesheet), aggregating the day's
 * transactions, administrations, encounters, inventory movements, and cash
 * drawer, then persisting an archival snapshot. Snapshotting is deliberately
 * distinct from operationally closing the clinic day.
 *
 * Runs as the `Branch` operator persona (project storageState) — the single
 * clinic account that also does the reconciliation (the branch-day session is
 * shared, not per-user). The spec is ordered after `daily-loop.spec.ts`
 * (alphabetically `daily-loop` < `day-summary`), so today already has at least
 * the administration + payment that loop produced; but it deliberately asserts
 * only on always-present structure (the five report blocks) and the snapshot
 * action, never on counts from sibling tests.
 *
 * Mutating: "Snapshot report" writes a `day_summary_snapshots` row for (tenant,
 * branch, today). Replacing a snapshot overwrites it, so the spec is re-run-safe
 * and asserts success via the persistent archival badge rather than a toast.
 */
test.describe('end of day: day-summary reconciliation + archival snapshot', () => {
  test('the day-summary report renders every block and archives a snapshot', async ({ page }) => {
    // ── 1. Open the end-of-day report (defaults to today). "Day Summary" also
    //       appears in the sidebar nav + breadcrumb, so target the page heading. ──
    await page.goto('/day-summary')
    await expect(page.getByRole('heading', { name: 'Day Summary' })).toBeVisible()
    await expect(page.getByLabel('Summary date')).toHaveValue(manilaCalendarDate())

    // ── 2. All five reconciliation blocks render (each shows data or an empty
    //       state, but the block itself is always present once data loads).
    //       Scope to main content — several block titles double as sidebar nav
    //       labels (Transactions, Encounters, Inventory). ──
    const main = page.locator('#main-content')
    for (const block of [
      'Transactions',
      'Administrations',
      'Encounters',
      'Inventory movements',
      'Cash drawer',
    ]) {
      await expect(main.getByText(block, { exact: true })).toBeVisible()
    }

    // ── 3. Archive the report. The trigger is explicit that this is a snapshot,
    //       not an operational close-day action. ──
    await page.getByRole('button', { name: /^(snapshot report|replace snapshot)$/i }).click()

    // Scope confirmation to the AlertDialog so the footer trigger cannot match.
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    const refreshedSnapshot = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/day-summary/snapshot?') &&
        response.status() === 200,
    )
    await dialog.getByRole('button', { name: /^(snapshot report|replace snapshot)$/i }).click()

    // ── 4. Success: the archival badge appears once the snapshot query refetches.
    //       This is the persistent counterpart to the transient toast, and proves
    //       the POST /api/day-summary/snapshot write path landed. ──
    await expect(page.getByText(/^Archived snapshot ·/)).toBeVisible({ timeout: 15_000 })

    // Public contracts expose the branch display_id, never the internal
    // bigint. This specifically covers the GET-after-POST handoff used by the
    // page, where a bare branch lookup used to fail under FORCE RLS and fall
    // back to a numeric string.
    const snapshotResponse = await refreshedSnapshot
    const snapshot = (await snapshotResponse.json()) as { branchId: string }
    expect(snapshot.branchId).toMatch(/^SVX\.[A-Z0-9]+$/)

    // The trigger now reflects the persisted snapshot.
    await expect(page.getByRole('button', { name: /^replace snapshot$/i })).toBeVisible()
  })
})
