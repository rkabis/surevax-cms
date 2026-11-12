import { http, HttpResponse } from 'msw'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test-utils/msw-handlers'
import { renderWithProviders } from '@/test-utils/render'
import { TooltipProvider } from '@/components/ui/tooltip'
import DaySummaryPage from './DaySummaryPage'

vi.mock('@/lib/clinicDate', () => ({
  // 2026-08-22T16:30:00Z is already Aug 23 in the Philippine clinic.
  clinicCalendarDateString: () => '2026-08-23',
}))

afterEach(cleanup)

describe('DaySummaryPage clinic date', () => {
  it('requests the Manila calendar day before 08:00 PHT', async () => {
    let requestedDate: string | null = null
    server.use(
      http.get('/api/day-summary', ({ request }) => {
        requestedDate = new URL(request.url).searchParams.get('date')
        return HttpResponse.json({
          date: requestedDate,
          branchId: 'SVX.HST',
          branchName: 'Holy Spirit',
          generatedAt: '2026-08-22T16:30:00.000Z',
          transactions: {
            count: 0,
            totalRevenue: '0.00',
            totalUnsettled: '0.00',
            byMethod: [],
            byStatus: [],
          },
          administrations: { count: 0, rows: [] },
          encounters: { count: 0, byBundle: [], byWhoCategory: [] },
          inventory: { movementCount: 0, rows: [] },
          drawer: {
            sessionCount: 0,
            openingFloatTotal: '0.00',
            declaredTotalTotal: '0.00',
            varianceTotal: '0.00',
            depositCount: 0,
            depositsTotal: '0.00',
            rows: [],
          },
        })
      }),
      http.get('/api/day-summary/snapshot', () =>
        HttpResponse.json({ error: 'Not found' }, { status: 404 }),
      ),
      http.get('/api/day-summary/loose-ends', () =>
        HttpResponse.json({
          date: '2026-08-23',
          branchId: 'SVX.HST',
          unsettledTransactions: {
            count: 1,
            totalOutstanding: '500.00',
            asOfDate: '2026-08-22',
          },
          openPriorDrawers: { count: 0, rows: [] },
          undocumentedAdministrations: { count: 0, asOfDate: '2026-08-22' },
        }),
      ),
    )

    renderWithProviders(
      <TooltipProvider>
        <DaySummaryPage />
      </TooltipProvider>,
    )

    await waitFor(() => expect(requestedDate).toBe('2026-08-23'))
    expect(await screen.findByRole('button', { name: 'Snapshot report' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close day' })).not.toBeInTheDocument()
  })
})
