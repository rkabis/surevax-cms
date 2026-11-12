import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test-utils/msw-handlers'
import { renderWithProviders } from '@/test-utils/render'
import BrandLotPicker from '../BrandLotPicker'

const lots = [
  {
    id: 'LOT_AAAAAA01',
    batchNumber: 'BATCH-001',
    expiryDate: '2027-01-01',
    quantityOnHand: '5',
    product: { id: 'PRD_AAAAAA01', name: 'Abhayrab', manufacturer: 'Human Biologicals' },
    isHouseBrand: true,
    unitPrice: '1000.00',
    isRecalled: false,
  },
  {
    id: 'LOT_AAAAAA02',
    batchNumber: 'BATCH-002',
    expiryDate: '2027-02-01',
    quantityOnHand: '3',
    product: { id: 'PRD_AAAAAA01', name: 'Abhayrab', manufacturer: 'Human Biologicals' },
    isHouseBrand: true,
    unitPrice: '1000.00',
    isRecalled: false,
  },
  {
    id: 'LOT_AAAAAA03',
    batchNumber: 'RECALLED-001',
    expiryDate: '2027-03-01',
    quantityOnHand: '8',
    product: { id: 'PRD_AAAAAA02', name: 'Speeda', manufacturer: 'Liaoning' },
    isHouseBrand: false,
    unitPrice: '1200.00',
    isRecalled: true,
  },
]

afterEach(() => cleanup())

describe('BrandLotPicker', () => {
  it('shows every physical lot with batch and expiry without auto-selecting one', async () => {
    server.use(
      http.get('*/api/scheduled-orders/ORD_AAAAAA01/eligible-lots', () =>
        HttpResponse.json({ data: lots, billedUnitPrice: '1000.00' }),
      ),
    )

    const onChange = vi.fn()
    renderWithProviders(<BrandLotPicker orderId="ORD_AAAAAA01" value={null} onChange={onChange} />)

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Abhayrab, lot BATCH-001/i })).toBeDefined(),
    )

    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(
      screen.getAllByRole('radio').every((radio) => radio.getAttribute('aria-checked') === 'false'),
    ).toBe(true)
    expect(screen.getByText('BATCH-001')).toBeDefined()
    expect(screen.getByText('BATCH-002')).toBeDefined()

    await userEvent.setup().click(screen.getByRole('radio', { name: /Abhayrab, lot BATCH-001/i }))
    expect(onChange).toHaveBeenCalledWith('LOT_AAAAAA01', lots[0])
  })

  it('keeps a recalled lot visible but unavailable', async () => {
    server.use(
      http.get('*/api/scheduled-orders/ORD_AAAAAA01/eligible-lots', () =>
        HttpResponse.json({ data: lots, billedUnitPrice: '1000.00' }),
      ),
    )

    renderWithProviders(<BrandLotPicker orderId="ORD_AAAAAA01" value={null} onChange={vi.fn()} />)

    const recalledLot = await screen.findByRole('radio', { name: /Speeda/i })
    expect(recalledLot).toBeDisabled()
    expect(screen.getByText(/unavailable: recall/i)).toBeDefined()
  })
})
