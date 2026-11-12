import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test-utils/msw-handlers'
import { renderWithProviders } from '@/test-utils/render'
import PatientPicker from '../PatientPicker'

const FIXTURE_PATIENT = {
  id: 'PAT_AAAAAA01',
  firstName: 'Maria',
  lastName: 'Santos',
  middleName: null,
  dateOfBirth: '1990-01-01',
  sex: 'Female',
  contactNumber: null,
  email: null,
  address: null,
  region: null,
  province: null,
  city: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  pepCompleted: null,
  pepTotal: null,
}

// Explicit cleanup so DOM doesn't bleed across tests in this file.
afterEach(() => cleanup())

describe('PatientPicker', () => {
  it('renders the search input when no patient is selected', () => {
    const { container } = renderWithProviders(<PatientPicker value={null} onChange={vi.fn()} />)
    expect(within(container).getByLabelText(/search patient/i)).toBeDefined()
  })

  it('calls onChange with the patient display_id when a result is clicked', async () => {
    server.use(
      http.get('*/api/patients*', () =>
        HttpResponse.json({ data: [FIXTURE_PATIENT], nextCursor: null }),
      ),
    )

    const onChange = vi.fn()
    const { container } = renderWithProviders(<PatientPicker value={null} onChange={onChange} />)

    const user = userEvent.setup()
    const input = within(container).getByLabelText(/search patient/i)

    // Type enough to trigger the debounced search (min 2 chars)
    await user.type(input, 'San')

    // Wait for the dropdown result to appear
    await waitFor(
      () => {
        expect(within(container).getByText(/Santos, Maria/i)).toBeDefined()
      },
      { timeout: 2000 },
    )

    // Click the patient row — uses mousedown so onMouseDown handler fires
    const row = within(container).getByText(/Santos, Maria/i)
    await user.pointer({ keys: '[MouseLeft>]', target: row })

    // onChange fires with the patient's display_id
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(FIXTURE_PATIENT.id)
    })
  })

  it('shows "No patients found" when search returns empty results', async () => {
    server.use(http.get('*/api/patients*', () => HttpResponse.json({ data: [], nextCursor: null })))

    const { container } = renderWithProviders(<PatientPicker value={null} onChange={vi.fn()} />)

    const user = userEvent.setup()
    await user.type(within(container).getByLabelText(/search patient/i), 'Zzz')

    await waitFor(
      () => {
        expect(within(container).getByText(/no patients found/i)).toBeDefined()
      },
      { timeout: 2000 },
    )
  })
})
