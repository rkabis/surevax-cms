import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { renderWithProviders, userEvent } from '@/test-utils/render'
import { server } from '@/test-utils/msw-handlers'
import ExternalImmunizationsTab from '../ExternalImmunizationsTab'

afterEach(() => cleanup())

vi.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    user: {
      id: 'USR_AAAAAAA1',
      role: 'Nurse',
      firstName: 'Maria',
      lastName: 'Santos',
      branchId: 'SVX.HST',
    },
  }),
}))

const unverified = {
  id: 42,
  vaccineName: 'Rabies vaccine',
  cvxCode: null,
  manufacturer: 'Example Pharma',
  lotNumber: 'LOT-42',
  administeredDate: '2026-08-20',
  administeredDatePrecision: 'Exact' as const,
  administeredAtFacility: 'Barangay Health Center',
  doseNumberInSeries: 1,
  source: 'RecordsTransfer',
  verifiedAt: null,
  verifiedBy: null,
  createdAt: '2026-08-22T08:00:00.000Z',
}

describe('external immunization evidence verification', () => {
  it('requires an explicit evidence-reviewed acknowledgement before self-attested verification', async () => {
    const user = userEvent.setup()
    let patchBody: unknown = null
    server.use(
      http.get('*/api/patients/PAT_AAAAAAA1/external-immunizations', () =>
        HttpResponse.json([unverified]),
      ),
      http.get('*/api/branch/staff', () => HttpResponse.json({ data: [] })),
      http.patch(
        '*/api/patients/PAT_AAAAAAA1/external-immunizations/42/verify',
        async ({ request }) => {
          patchBody = await request.json()
          return HttpResponse.json({
            ...unverified,
            verifiedAt: '2026-08-23T08:00:00.000Z',
            verifiedBy: {
              displayId: 'USR_AAAAAAA1',
              fullName: 'Maria Santos',
              licenseNumber: 'RN-12345',
            },
          })
        },
      ),
    )

    renderWithProviders(<ExternalImmunizationsTab patientId="PAT_AAAAAAA1" />)
    await user.click(await screen.findByRole('button', { name: 'Verify evidence' }))

    const confirm = screen.getByRole('button', { name: 'Confirm verification' })
    expect(confirm).toBeDisabled()
    expect(
      screen.getByText(/does not administer a dose, prove that the dose occurred/i),
    ).toBeVisible()

    await user.click(
      screen.getByRole('checkbox', {
        name: /I reviewed the available source evidence and the details above match it/i,
      }),
    )
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() => expect(patchBody).toEqual({}))
  })

  it('keeps the verification write hidden on a cross-branch chart', async () => {
    server.use(
      http.get('*/api/patients/PAT_AAAAAAA1/external-immunizations', () =>
        HttpResponse.json([unverified]),
      ),
      http.get('*/api/branch/staff', () => HttpResponse.json({ data: [] })),
    )
    renderWithProviders(<ExternalImmunizationsTab patientId="PAT_AAAAAAA1" isCrossBranch />)
    expect(await screen.findByText('Rabies vaccine')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Verify evidence' })).not.toBeInTheDocument()
  })
})
