import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderWithProviders } from '@/test-utils/render'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UserLabel, type UserRef } from '../UserLabel'
import { PatientLabel, type PatientRef } from '../PatientLabel'

/**
 * UserLabel / PatientLabel render in nearly every detail drawer to show a
 * createdBy / patient reference as "name + ID badge". Their null → em-dash
 * contract and the MRN-vs-displayId badge choice are easy to break, so pin them.
 */

afterEach(cleanup)

const user: UserRef = { displayId: 'USR_AAAAAAA1', firstName: 'Jane', lastName: 'Doe' }
const patient: PatientRef = {
  displayId: 'PAT_K9MX3VQ2',
  firstName: 'Maria',
  lastName: 'Dela Cruz',
  mrn: 'MRN-000042',
}

describe('UserLabel', () => {
  it('renders full name + displayId badge (default variant)', () => {
    renderWithProviders(<UserLabel user={user} />)
    expect(screen.getByText('Jane Doe')).toBeVisible()
    expect(screen.getByText('USR_AAAAAAA1')).toBeVisible()
  })

  it('renders an em dash for a null user', () => {
    renderWithProviders(<UserLabel user={null} />)
    expect(screen.getByText('—')).toBeVisible()
  })

  it('falls back to the displayId when the name is blank', () => {
    renderWithProviders(<UserLabel user={{ displayId: 'USR_X', firstName: '', lastName: '' }} />)
    // Name span and badge both render the displayId.
    expect(screen.getAllByText('USR_X').length).toBeGreaterThan(0)
  })

  it('renders initials in the compact variant', () => {
    renderWithProviders(
      <TooltipProvider>
        <UserLabel user={user} variant="compact" />
      </TooltipProvider>,
    )
    expect(screen.getByText('JD')).toBeVisible()
  })
})

describe('PatientLabel', () => {
  it('renders "Lastname, Firstname" + MRN badge by default', () => {
    renderWithProviders(<PatientLabel patient={patient} />)
    expect(screen.getByText('Dela Cruz, Maria')).toBeVisible()
    expect(screen.getByText('MRN-000042')).toBeVisible()
  })

  it('renders an em dash for a null patient', () => {
    renderWithProviders(<PatientLabel patient={null} />)
    expect(screen.getByText('—')).toBeVisible()
  })

  it('shows the displayId badge when MRN is absent', () => {
    renderWithProviders(<PatientLabel patient={{ ...patient, mrn: null }} />)
    expect(screen.getByText('PAT_K9MX3VQ2')).toBeVisible()
  })

  it('shows the displayId badge when showMrn is false, even if an MRN exists', () => {
    renderWithProviders(<PatientLabel patient={patient} showMrn={false} />)
    expect(screen.getByText('PAT_K9MX3VQ2')).toBeVisible()
    expect(screen.queryByText('MRN-000042')).toBeNull()
  })
})
