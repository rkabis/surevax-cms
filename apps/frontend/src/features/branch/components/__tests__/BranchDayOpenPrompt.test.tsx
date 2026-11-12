import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@/test-utils/render'
import { server } from '@/test-utils/msw-handlers'
import { BranchDayOpenPrompt } from '../BranchDayOpenPrompt'

vi.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    user: {
      id: 'USR_AAAAAAA7',
      role: 'Branch',
      branchId: 'SVX.HST',
    },
  }),
}))

describe('BranchDayOpenPrompt', () => {
  it('does not offer a second drawer when a prior-day branch drawer is still Open', async () => {
    let drawerResolved = false
    server.use(
      http.get('*/api/cash-drawer/current', () => {
        drawerResolved = true
        return HttpResponse.json({
          id: 'CSH_AAAAAAA1',
          openingFloat: '1000.00',
          closingTotalDeclared: null,
          expectedTotal: null,
          variance: null,
          state: 'Open',
          openedAt: '2026-08-21T01:00:00.000Z',
          closedAt: null,
          cashCollected: '0.00',
          depositsTotal: '0.00',
          onHandCash: '1000.00',
          deposits: [],
        })
      }),
      http.get('*/api/day-summary/loose-ends*', () =>
        HttpResponse.json({
          date: '2026-08-23',
          unsettledTransactions: { count: 0, totalOutstanding: '0.00' },
          openPriorDrawers: { count: 1 },
          undocumentedAdministrations: { count: 0 },
        }),
      ),
    )

    renderWithProviders(<BranchDayOpenPrompt />)

    await waitFor(() => expect(drawerResolved).toBe(true))
    expect(screen.queryByText(/Opening clinic for/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open clinic for/ })).not.toBeInTheDocument()
  })
})
