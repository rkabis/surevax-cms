import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders, userEvent } from '@/test-utils/render'
import { server } from '@/test-utils/msw-handlers'
import type { ReviewCenterListResponse } from '@/api/contracts/review-center.gen'
import ReviewCenterPage from '../ReviewCenterPage'

afterEach(() => cleanup())

vi.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    user: {
      id: 'USR_AAAAAAA1',
      role: 'Branch',
      firstName: 'Branch',
      lastName: 'Operator',
      branchId: 'SVX.HST',
    },
  }),
}))

function response(overrides: Partial<ReviewCenterListResponse> = {}): ReviewCenterListResponse {
  return {
    generatedAt: '2026-08-22T08:00:00.000Z',
    asOfDate: '2026-08-22',
    branchId: 'SVX.HST',
    counts: {
      missingGuardians: 1,
      yesterdayLooseEnds: 2,
      potentialDuplicates: 1,
      externalImmunizations: 1,
    },
    missingGuardians: {
      count: 1,
      rows: [
        {
          patientId: 'PAT_AAAAAAA1',
          mrn: 'MRN-000101',
          patientName: 'Minor Patient',
          dateOfBirth: '2016-02-03',
          age: 10,
          contactNumber: '09170000000',
          guardianName: null,
          guardianRelationship: null,
          guardianContact: null,
          rowVersion: 3,
        },
      ],
    },
    yesterdayLooseEnds: {
      count: 2,
      staleOpenEncounters: {
        count: 1,
        rows: [
          {
            encounterId: 'ENC_AAAAAAA1',
            patientId: 'PAT_AAAAAAA1',
            patientName: 'Minor Patient',
            specialty: 'Rabies',
            status: 'Open',
            startedAt: '2026-08-20T02:00:00.000Z',
          },
        ],
      },
      unsettledTransactions: {
        count: 1,
        totalOutstanding: '500.00',
        rows: [
          {
            transactionId: 'TXN_AAAAAAA1',
            patientId: 'PAT_AAAAAAA1',
            patientName: 'Minor Patient',
            status: 'Pending',
            outstandingAmount: '500.00',
            createdAt: '2026-08-20T03:00:00.000Z',
          },
        ],
      },
      openPriorDrawers: { count: 0, rows: [] },
      undocumentedAdministrations: { count: 0, rows: [] },
    },
    potentialDuplicates: {
      count: 1,
      rows: [
        {
          patientId: 'PAT_DUPL0001',
          mrn: 'MRN-000202',
          patientName: 'Possible Duplicate',
          dateOfBirth: '1990-04-02',
          contactNumber: '09171234567',
          flaggedAt: '2026-08-21T08:00:00.000Z',
        },
      ],
    },
    externalImmunizations: {
      count: 1,
      rows: [
        {
          patientId: 'PAT_EXT00001',
          mrn: 'MRN-000303',
          patientName: 'External Dose Patient',
          vaccineName: 'Rabies vaccine',
          administeredDate: '2026-07-20',
          administeredDatePrecision: 'Exact',
          administeredAtFacility: 'Barangay Health Center',
          source: 'RecordsTransfer',
          createdAt: '2026-08-20T08:00:00.000Z',
        },
      ],
    },
    ...overrides,
  }
}

describe('ReviewCenterPage', () => {
  it('renders truthful queue counts and row-level loose ends', async () => {
    server.use(http.get('*/api/review-center*', () => HttpResponse.json(response())))
    renderWithProviders(<ReviewCenterPage />)

    expect(await screen.findByText('Minor Patient · Rabies')).toBeInTheDocument()
    expect(screen.getByText('Minor Patient · ₱500.00 outstanding')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Loose ends (2)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Missing guardians (1)' })).toBeInTheDocument()
    expect(screen.getByText('Open encounter').closest('tr')).toHaveAttribute(
      'data-severity',
      'overdue',
    )
  })

  it('shows commit effects before issuing the accountable guardian update', async () => {
    const user = userEvent.setup()
    let patchBody: unknown = null
    server.use(
      http.get('*/api/review-center*', () => HttpResponse.json(response())),
      http.patch('*/api/review-center/missing-guardians/PAT_AAAAAAA1', async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({
          patientId: 'PAT_AAAAAAA1',
          patientName: 'Minor Patient',
          guardianName: 'Maria Patient',
          guardianRelationship: 'Mother',
          guardianContact: '09171234567',
          rowVersion: 4,
          reviewedById: 'USR_AAAAAAA1',
          reviewedAt: '2026-08-22T08:05:00.000Z',
        })
      }),
    )
    renderWithProviders(<ReviewCenterPage />)

    await user.click(await screen.findByRole('tab', { name: 'Missing guardians (1)' }))
    await user.click(await screen.findByRole('button', { name: 'Review' }))
    expect(screen.getByText('Commit effects')).toBeInTheDocument()
    expect(patchBody).toBeNull()

    await user.type(screen.getByLabelText('Guardian name'), 'Maria Patient')
    await user.type(screen.getByLabelText('Relationship'), 'Mother')
    await user.type(screen.getByLabelText('Contact number'), '09171234567')
    await user.click(screen.getByRole('button', { name: 'Confirm and save' }))

    await waitFor(() =>
      expect(patchBody).toEqual({
        guardianName: 'Maria Patient',
        guardianRelationship: 'Mother',
        guardianContact: '09171234567',
        expectedRowVersion: 3,
      }),
    )
  })

  it('surfaces duplicate and external-dose evidence queues without offering an unsafe merge', async () => {
    const user = userEvent.setup()
    server.use(http.get('*/api/review-center*', () => HttpResponse.json(response())))
    renderWithProviders(<ReviewCenterPage />)

    await user.click(await screen.findByRole('tab', { name: 'Possible duplicates (1)' }))
    expect(screen.getByText('Possible Duplicate')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open flagged record/ })).toHaveAttribute(
      'href',
      '/patients/PAT_DUPL0001',
    )
    expect(screen.queryByRole('button', { name: /merge/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /merge/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'External doses (1)' }))
    expect(screen.getByText('External Dose Patient')).toBeInTheDocument()
    expect(screen.getByText('Needs verification')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /verify/i })).not.toBeInTheDocument()
  })

  it('routes a prior open drawer to the kiosk workflow that can close it', async () => {
    const data = response()
    data.counts.yesterdayLooseEnds = 3
    data.yesterdayLooseEnds.count = 3
    data.yesterdayLooseEnds.openPriorDrawers = {
      count: 1,
      rows: [
        {
          sessionId: 'CSH_AAAAAAA1',
          openedAt: '2026-08-20T01:00:00.000Z',
          userName: 'Branch Operator',
          openingFloat: '1000.00',
        },
      ],
    }
    server.use(http.get('*/api/review-center*', () => HttpResponse.json(data)))
    renderWithProviders(<ReviewCenterPage />)

    const drawerBadge = await screen.findByText('Open drawer')
    const row = drawerBadge.closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByRole('link', { name: /Open/ })).toHaveAttribute(
      'href',
      '/branch/kiosk',
    )
  })

  it('does not mislabel an error as an empty worklist', async () => {
    server.use(
      http.get('*/api/review-center*', () =>
        HttpResponse.json({ error: 'Database unavailable' }, { status: 503 }),
      ),
    )
    renderWithProviders(<ReviewCenterPage />)

    expect(await screen.findByText('Couldn’t load Review Center')).toBeInTheDocument()
    expect(screen.queryByText('No loose ends in this category.')).not.toBeInTheDocument()
  })

  it('renders a truthful empty state after a successful zero response', async () => {
    const empty = response({
      counts: {
        missingGuardians: 0,
        yesterdayLooseEnds: 0,
        potentialDuplicates: 0,
        externalImmunizations: 0,
      },
      missingGuardians: { count: 0, rows: [] },
      yesterdayLooseEnds: {
        count: 0,
        staleOpenEncounters: { count: 0, rows: [] },
        unsettledTransactions: { count: 0, totalOutstanding: '0.00', rows: [] },
        openPriorDrawers: { count: 0, rows: [] },
        undocumentedAdministrations: { count: 0, rows: [] },
      },
      potentialDuplicates: { count: 0, rows: [] },
      externalImmunizations: { count: 0, rows: [] },
    })
    server.use(http.get('*/api/review-center*', () => HttpResponse.json(empty)))
    renderWithProviders(<ReviewCenterPage />)

    expect(await screen.findByText('No loose ends in this category.')).toBeInTheDocument()
  })
})
