import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test-utils/msw-handlers'
import { renderWithProviders } from '@/test-utils/render'
import InitiateProtocolSheet from '../components/InitiateProtocolSheet'

/**
 * Regression cover for the 2026-07-26 Tier-1 fix.
 *
 * `physicianValid` was gated on a UUID regex while physician ids on the wire
 * are two-tier display ids (`USR_…`), and the gate applied to BOTH the
 * populated dropdown and the manual-entry fallback. Because
 * `requiresAuthorizer` is true for `Nurse` AND `Branch` — and `Branch` is the
 * clinic's real single-operator login — `canSubmit` was unreachable for the
 * primary persona: selecting a physician correctly still left the commit
 * button disabled, with "Must be a valid UUID." as the only feedback.
 */

const PHYSICIAN = {
  id: 'USR_K9MX3VQ2',
  firstName: 'Ana',
  lastName: 'Lacuarin',
  email: 'ana@surevax.com',
  role: 'Physician',
  isActive: true,
  licenseNumber: 'PRC-12345',
}

const TEMPLATE = {
  id: 'SOT_RABIESIM',
  name: 'Rabies PEP — Intramuscular (5-dose)',
  description: 'WHO Essen 5-dose IM',
  category: 'Rabies',
  isActive: true,
  items: [
    { sequenceNumber: 1, offsetDays: 0, serviceId: 'ARVPEP_IM', serviceName: 'Anti-rabies IM' },
    { sequenceNumber: 2, offsetDays: 3, serviceId: 'ARVPEP_IM', serviceName: 'Anti-rabies IM' },
  ],
}

// `Branch` is the persona the bug locked out.
vi.mock('@/features/auth/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/auth/context')>()
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: 1,
        displayId: 'USR_BRANCH01',
        email: 'branch-main@surevax.com',
        firstName: 'Main',
        lastName: 'Branch Account',
        role: 'Branch',
        tenantId: 'SVX',
        branchId: 1,
        branchCode: 'HST',
        isPlatformAdmin: false,
      },
      setUser: vi.fn(),
      logout: vi.fn(),
      isLoading: false,
    }),
  }
})

afterEach(() => cleanup())

function mountSheet() {
  server.use(
    http.get('*/api/standing-order-templates*', () => HttpResponse.json({ data: [TEMPLATE] })),
    http.get('*/api/branch/physicians*', () => HttpResponse.json({ data: [PHYSICIAN] })),
  )
  return renderWithProviders(
    <InitiateProtocolSheet
      open
      onOpenChange={vi.fn()}
      patientId="PAT_AAAAAA01"
      encounterId="ENC_AAAAAA01"
    />,
  )
}

describe('InitiateProtocolSheet — Branch operator', () => {
  it('enables the commit button once a physician display id is selected', async () => {
    const user = userEvent.setup()
    mountSheet()

    // Choose the protocol template so the authorizer section renders.
    const template = await screen.findByText(/Rabies PEP/i, {}, { timeout: 3000 })
    await user.click(template)

    // The physician dropdown is populated from /api/branch/physicians.
    const select = await waitFor(() => {
      const el = document.querySelector('select')
      if (!el) throw new Error('physician select not rendered')
      return el as HTMLSelectElement
    })
    await user.selectOptions(select, PHYSICIAN.id)
    expect(select.value).toBe(PHYSICIAN.id)

    // The commit button must now be reachable. Under the UUID gate it never was.
    await waitFor(() => {
      const commit = screen
        .getAllByRole('button')
        .find((b) => /start protocol/i.test(b.textContent ?? ''))
      expect(commit).toBeDefined()
      expect((commit as HTMLButtonElement).disabled).toBe(false)
    })
  })

  it('does not tell the operator a display id must be a UUID', async () => {
    const user = userEvent.setup()
    mountSheet()

    const template = await screen.findByText(/Rabies PEP/i, {}, { timeout: 3000 })
    await user.click(template)

    await waitFor(() => expect(document.querySelector('select')).not.toBeNull())
    expect(screen.queryByText(/valid UUID/i)).toBeNull()
  })
})
