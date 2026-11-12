import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test-utils/msw-handlers'
import { renderWithProviders } from '@/test-utils/render'
import TodayPage, { canAutoRefreshToday } from './TodayPage'

vi.mock('@/lib/clinicDate', () => ({ clinicCalendarDateString: () => '2026-08-23' }))
vi.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    user: {
      id: 'USR_BRANCH01',
      email: 'branch@surevax.com',
      firstName: 'Holy Spirit',
      lastName: 'Branch',
      role: 'Branch',
      branchId: 'SVX.HST',
    },
  }),
}))

const emptyOrderStats = {
  todayCount: 0,
  missedCount: 0,
  completedToday: 0,
  overdueCount: 0,
  backfillCount: 0,
  upcomingCount: 0,
  activeCoursesCount: 0,
  recomputeNeededCount: 0,
  administered7d: [0, 0, 0, 0, 0, 0, 0],
}

function installTodayHandlers() {
  server.use(
    http.get('/api/day-summary/today-roster', () =>
      HttpResponse.json({
        date: '2026-08-23',
        branchId: 'SVX.HST',
        branchName: 'Holy Spirit',
        generatedAt: '2026-08-23T03:15:00.000Z',
        roster: [
          {
            id: 'ENC_TODAY006',
            patientId: 'PAT_TODAY006',
            patientName: 'Dela Cruz, Ana',
            patientMrn: 'HST-0006',
            specialty: 'Vaccination',
            status: 'Open',
            startedAt: '2026-08-23T02:45:00.000Z',
            completedAt: null,
            claimedBy: { id: 'USR_NURSE001', name: 'Maria Nurse', role: 'Nurse' },
            waitingSince: '2026-08-23T02:45:00.000Z',
            lastActionAt: '2026-08-23T03:05:00.000Z',
            rowVersion: 3,
            nextOwner: { role: 'Nurse', label: 'Maria Nurse' },
            handoffState: 'in_care',
            pendingTransactionId: null,
          },
        ],
      }),
    ),
    http.get('/api/dashboard', () =>
      HttpResponse.json({
        stats: {
          patientsToday: 1,
          encountersToday: 1,
          scheduledOrdersDueToday: 0,
          pendingPayments: 0,
          walkInCount: 1,
          bookedCount: 0,
          unsettledTotal: '0.00',
          cashCollectedToday: '0.00',
          nonCashCollectedToday: '0.00',
          trend7d: { arrivals: [], revenue: [], unsettled: [] },
        },
        scheduledOrderStats: { dueCount: 0, overdueCount: 0, backfillCount: 0, upcomingCount: 0 },
        // This is intentionally different: Today must never source its roster
        // from the dashboard's latest-five list again.
        recentEncounters: [
          {
            id: 'ENC_WRONG001',
            patientDisplayId: 'PAT_WRONG001',
            patientName: 'Wrong, Dashboard',
            specialty: 'General',
            status: 'Open',
            attendingClinicianName: null,
            time: '8:00 AM',
            completedAt: null,
          },
        ],
        scheduledOrdersDue: [],
        lowStock: [],
      }),
    ),
    http.get('/api/scheduled-orders', ({ request }) => {
      const filter = new URL(request.url).searchParams.get('filter')
      if (filter !== 'completed_today') {
        return HttpResponse.json({ data: [], stats: emptyOrderStats })
      }
      const order = {
        patientMrn: 'HST-0042',
        patientDateOfBirth: '1990-01-01',
        contactNumber: null,
        service: 'Rabies vaccine',
        doseNumber: 1,
        totalDoses: 4,
        scheduledDate: '2026-08-23',
        status: 'Completed',
        standingOrderName: 'Rabies PEP',
        indication: null,
        paymentStatus: 'Paid',
        hasBlockingOverdue: false,
        priorityState: 'completed',
        smsOptIn: false,
      }
      return HttpResponse.json({
        data: [
          {
            ...order,
            id: 'ORD_OBSERVE001',
            patientName: 'Observation, Ready',
            observation: {
              id: 'OBS_READY001',
              durationMinutes: 15,
              observeUntil: '2026-08-23T03:10:00.000Z',
              outcome: 'NoReaction',
              outcomeNotes: null,
              outcomeRecordedAt: '2026-08-23T03:10:00.000Z',
              outcomeRecordedBy: { displayId: 'USR_NURSE001', fullName: 'Maria Nurse' },
              dischargedAt: null,
              dischargedBy: null,
              state: 'ReadyForDischarge',
            },
          },
          {
            ...order,
            id: 'ORD_DISCHARGED001',
            patientName: 'Observation, Discharged',
            observation: {
              id: 'OBS_DISCHARGED001',
              durationMinutes: 15,
              observeUntil: '2026-08-23T02:30:00.000Z',
              outcome: 'NoReaction',
              outcomeNotes: null,
              outcomeRecordedAt: '2026-08-23T02:30:00.000Z',
              outcomeRecordedBy: { displayId: 'USR_NURSE001', fullName: 'Maria Nurse' },
              dischargedAt: '2026-08-23T02:31:00.000Z',
              dischargedBy: { displayId: 'USR_NURSE001', fullName: 'Maria Nurse' },
              state: 'Discharged',
            },
          },
          {
            ...order,
            id: 'ORD_REACTION001',
            patientName: 'Observation, Reaction',
            observation: {
              id: 'OBS_REACTION001',
              durationMinutes: 15,
              observeUntil: '2026-08-23T03:00:00.000Z',
              outcome: 'Reaction',
              outcomeNotes: 'Rash observed',
              outcomeRecordedAt: '2026-08-23T03:01:00.000Z',
              outcomeRecordedBy: { displayId: 'USR_NURSE001', fullName: 'Maria Nurse' },
              dischargedAt: null,
              dischargedBy: null,
              state: 'Reaction',
            },
          },
        ],
        stats: emptyOrderStats,
      })
    }),
    http.get('/api/transactions', () =>
      HttpResponse.json({
        data: [],
        stats: {
          todayCount: 0,
          todayRevenue: '0.00',
          pendingCount: 0,
          trend7d: { revenue: [] },
          revenueVsPrevDay: '0.00',
        },
        dayStats: null,
      }),
    ),
    http.get('/api/branch/staff', () =>
      HttpResponse.json({
        data: [
          {
            id: 'USR_NURSE001',
            firstName: 'Maria',
            lastName: 'Nurse',
            email: 'maria@surevax.com',
            role: 'Nurse',
            licenseNumber: 'RN-123',
            isActive: true,
            canLogin: false,
            activeShift: { id: 'SHF_001', clockInAt: '2026-08-23T00:00:00.000Z' },
          },
        ],
      }),
    ),
  )
}

afterEach(() => {
  cleanup()
})

describe('TodayPage branch-day snapshot', () => {
  it('renders the complete roster source and visible ownership/handoff metadata', async () => {
    installTodayHandlers()
    let submitted: Record<string, unknown> | undefined
    server.use(
      http.post('/api/day-summary/today-roster/:encounterId/owner', async ({ request }) => {
        submitted = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          ok: true,
          encounterId: 'ENC_TODAY006',
          claimedById: 'USR_NURSE001',
        })
      }),
    )
    renderWithProviders(<TodayPage />)

    expect(await screen.findByText('Dela Cruz, Ana')).toBeInTheDocument()
    expect(screen.queryByText('Wrong, Dashboard')).not.toBeInTheDocument()
    expect(screen.getByText(/Claimed by Maria Nurse · Next: Maria Nurse/)).toBeInTheDocument()
    expect(screen.getByText('In care')).toBeInTheDocument()
    expect(screen.getByText(/snapshot/i)).toBeInTheDocument()
    expect(screen.getByText('Observation, Ready')).toBeInTheDocument()
    expect(screen.getByText('Ready for discharge')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Discharge post-dose observation/ })).toBeVisible()
    expect(screen.getByText('Observation, Reaction').closest('[data-severity]')).toHaveAttribute(
      'data-severity',
      'overdue',
    )
    expect(screen.getByRole('button', { name: /Respond to post-dose observation/ })).toBeVisible()
    expect(screen.queryByText('Observation, Discharged')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Handoff' }))
    const pin = await screen.findByLabelText("Maria's PIN")
    fireEvent.change(pin, { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hand off' }))
    await waitFor(() =>
      expect(submitted).toEqual({
        assigneeId: 'USR_NURSE001',
        attestationPin: '1234',
        expectedRowVersion: 3,
      }),
    )
  })

  it('pauses auto-refresh when hidden or offline and makes offline state visible', async () => {
    expect(canAutoRefreshToday('visible', true)).toBe(true)
    expect(canAutoRefreshToday('hidden', true)).toBe(false)
    expect(canAutoRefreshToday('visible', false)).toBe(false)

    installTodayHandlers()
    const onlineSpy = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    renderWithProviders(<TodayPage />)
    fireEvent(window, new Event('offline'))

    await waitFor(() => expect(screen.getByText('Offline')).toBeInTheDocument())
    expect(screen.getByText(/Changes from other workstations/)).toBeInTheDocument()
    onlineSpy.mockRestore()
  })
})
