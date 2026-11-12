import { cleanup, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BreakGlassChart } from '../../api'
import { renderWithProviders } from '@/test-utils/render'
import { server } from '@/test-utils/msw-handlers'
import { TooltipProvider } from '@/components/ui/tooltip'
import PatientDetail, { PatientTimeline, patientDetailEncounters } from '../PatientDetail'

afterEach(() => cleanup())

vi.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    user: {
      id: 'USR_AAAAAAA1',
      role: 'Nurse',
      firstName: 'Maria',
      lastName: 'Santos',
      branchId: '1',
    },
  }),
}))

const REVEALED_CHART: BreakGlassChart = {
  grantId: 'CBA_AAAAAAA1',
  patientDisplayId: 'PAT_AAAAAAA1',
  homeBranchId: 2,
  targetBranchId: 2,
  encounters: [
    {
      id: 'ENC_REVEALED1',
      branchId: 2,
      branch: { displayId: 'SVX.TMG', name: 'Timog Clinic' },
      provider: {
        displayId: 'USR_NURSE001',
        firstName: 'Maria',
        lastName: 'Santos',
        licenseNumber: 'RN-12345',
      },
      specialty: 'Rabies',
      status: 'InProgress',
      chiefComplaint: 'Continuation of rabies PEP',
      visitNo: 3,
      startedAt: '2026-08-22T02:30:00.000Z',
      completedAt: null,
    },
  ],
  transactions: [],
  allergies: [],
  conditions: [],
}

describe('PatientDetail break-glass timeline continuity', () => {
  it('stays empty before reveal and renders only the audited chart encounters after reveal', () => {
    const { rerender } = render(
      <PatientTimeline
        encounters={patientDetailEncounters([], null)}
        isLoading={false}
        isError={false}
      />,
    )

    expect(screen.getByText('No encounters yet.')).toBeDefined()
    expect(screen.queryByText('Continuation of rabies PEP')).toBeNull()

    rerender(
      <PatientTimeline
        encounters={patientDetailEncounters([], REVEALED_CHART)}
        isLoading={false}
        isError={false}
      />,
    )

    expect(screen.queryByText('No encounters yet.')).toBeNull()
    expect(screen.getByText('Rabies')).toBeDefined()
    expect(screen.getByText('Continuation of rabies PEP')).toBeDefined()
    expect(screen.getByText('Maria Santos')).toBeDefined()
    expect(screen.getByText('RN-12345')).toBeDefined()
    expect(screen.getByText('Timog Clinic · SVX.TMG')).toBeDefined()
  })

  it('hides financial and health-card actions on a cross-branch chart', async () => {
    let balanceRequests = 0
    server.use(
      http.get('*/api/patients/PAT_AAAAAAA1', () =>
        HttpResponse.json({
          id: 'PAT_AAAAAAA1',
          displayId: 'PAT_AAAAAAA1',
          tenantId: 'SVX',
          mrn: 'MRN-000001',
          firstName: 'Juan',
          lastName: 'Dela Cruz',
          middleName: null,
          suffix: null,
          dateOfBirth: '1990-01-01',
          sex: 'Male',
          civilStatus: null,
          nationality: null,
          address: null,
          region: null,
          province: null,
          city: null,
          barangay: null,
          contactNumber: null,
          email: null,
          preferredLanguage: 'English',
          smsOptIn: false,
          emailOptIn: false,
          guardianName: null,
          guardianRelationship: null,
          guardianContact: null,
          insuranceProvider: null,
          insurancePolicyNumber: null,
          onboardingData: null,
          onboardingChannel: null,
          mergedAt: null,
          deletionRequestedAt: null,
          scheduledPurgeAt: null,
          isActive: true,
          rowVersion: 1,
          deletedAt: null,
          fullName: 'Juan Dela Cruz',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
          onboardingChannelPayer: null,
          allergies: [],
          conditions: [],
          tags: [],
          doseStates: null,
          pepCompleted: 0,
          pepTotal: null,
        }),
      ),
      http.get('*/api/patients/PAT_AAAAAAA1/demographic', () =>
        HttpResponse.json({
          id: 42,
          displayId: 'PAT_AAAAAAA1',
          tenantId: 'SVX',
          homeBranchId: 2,
          homeBranchDisplayId: 'SVX.TMG',
          mrn: 'MRN-000001',
          firstName: 'Juan',
          middleName: null,
          lastName: 'Dela Cruz',
          suffix: null,
          dateOfBirth: '1990-01-01',
          sex: 'Male',
          primaryPhone: null,
          isActive: true,
          allergies: [],
          activeConditions: [],
          dpaConsentActive: true,
          activeCourses: [],
          recentDoses: [],
          activeRecalls: [],
          recentCriticalLabResults: [],
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        }),
      ),
      http.get('*/api/encounters*', () => HttpResponse.json({ data: [] })),
      http.get('*/api/patients/PAT_AAAAAAA1/balance', () => {
        balanceRequests += 1
        return HttpResponse.json({})
      }),
    )

    renderWithProviders(
      <TooltipProvider>
        <PatientDetail patientId="PAT_AAAAAAA1" />
      </TooltipProvider>,
    )

    expect(await screen.findByText('Cross-branch record')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Health card' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take payment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Account/ })).not.toBeInTheDocument()
    expect(balanceRequests).toBe(0)
  })
})
