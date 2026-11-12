import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Patient } from '@/features/patients/api'
import { PatientRow } from '../Step1Identify'

function patient(isCrossBranch: boolean): Patient {
  return {
    id: isCrossBranch ? 'PAT_CROSS001' : 'PAT_LOCAL001',
    mrn: isCrossBranch ? 'MRN-002' : 'MRN-001',
    firstName: 'Maria',
    lastName: isCrossBranch ? 'Remote' : 'Local',
    middleName: null,
    dateOfBirth: null,
    sex: 'Female',
    contactNumber: null,
    email: null,
    address: null,
    region: null,
    province: null,
    city: null,
    isActive: true,
    createdAt: '2026-08-23T00:00:00.000Z',
    isCrossBranch,
    doseStates: null,
    pepCompleted: 0,
    pepTotal: null,
  }
}

describe('arrival patient branch access', () => {
  it('marks a cross-branch result read-only and prevents selection', async () => {
    const onSelect = vi.fn()
    render(
      <ul role="listbox">
        <PatientRow
          patient={patient(true)}
          isSelected={false}
          isChecking={false}
          onSelect={onSelect}
        />
      </ul>,
    )

    const option = screen.getByRole('option', { name: /remote, maria/i })
    expect(option).toBeDisabled()
    expect(screen.getByText(/other branch · read only/i)).toBeVisible()
    await userEvent.click(option)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps a same-branch result selectable', async () => {
    const onSelect = vi.fn()
    render(
      <ul role="listbox">
        <PatientRow
          patient={patient(false)}
          isSelected={false}
          isChecking={false}
          onSelect={onSelect}
        />
      </ul>,
    )

    const option = screen.getByRole('option', { name: /local, maria/i })
    expect(option).toBeEnabled()
    await userEvent.click(option)
    expect(onSelect).toHaveBeenCalledOnce()
  })
})
