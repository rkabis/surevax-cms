import { http, HttpResponse } from 'msw'
import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '@/test-utils/msw-handlers'
import { renderWithProviders, screen } from '@/test-utils/render'
import ReportsPage from './ReportsPage'

afterEach(cleanup)

describe('ReportsPage', () => {
  it('shows a least-privileged unbilled worklist and an honest empty state', async () => {
    server.use(
      http.get('/api/reports/options', () =>
        HttpResponse.json({
          allowedScopes: ['branch'],
          canViewFinancial: false,
          branches: [{ id: 'SVX.HST', code: 'HST', name: 'Holy Spirit' }],
          payers: [],
        }),
      ),
      http.get('/api/reports/administered-unbilled', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('scope')).toBe('branch')
        expect(url.searchParams.get('branchId')).toBeNull()
        expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(100)
        return HttpResponse.json({
          scope: 'branch',
          rows: [],
          totals: { count: 0, reconciliationRequiredCount: 0 },
          pagination: { page: 1, limit: 50, total: 0 },
        })
      }),
    )

    renderWithProviders(<ReportsPage />)

    expect(await screen.findByRole('heading', { name: 'Revenue integrity reports' })).toBeVisible()
    expect(
      await screen.findByText('No completed clinical work is missing an active billing link.'),
    ).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Unbilled work' })).toBeVisible()
    expect(screen.queryByRole('tab', { name: 'AR aging' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Payment exceptions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export daily CSV' })).not.toBeInTheDocument()
  })

  it('reports permission-loading failures instead of rendering zeroed data', async () => {
    server.use(
      http.get('/api/reports/options', () =>
        HttpResponse.json({ error: 'Unavailable' }, { status: 503 }),
      ),
    )

    renderWithProviders(<ReportsPage />)

    expect(await screen.findByText('Server error. Try again in a moment.')).toBeVisible()
  })
})
