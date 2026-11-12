import { describe, expect, it } from 'vitest'
import { transferActionsForBranch } from '../TransferDetail'

describe('transferActionsForBranch', () => {
  it('shows receive only at the destination', () => {
    expect(transferActionsForBranch('PendingReceipt', 'TMG', 'HST', 'TMG')).toEqual({
      canReceive: true,
      canCancel: false,
    })
  })

  it('shows cancel only at the source', () => {
    expect(transferActionsForBranch('PendingReceipt', 'HST', 'HST', 'TMG')).toEqual({
      canReceive: false,
      canCancel: true,
    })
  })

  it('keeps unrelated branches and terminal transfers read-only', () => {
    expect(transferActionsForBranch('PendingReceipt', 'QZN', 'HST', 'TMG')).toEqual({
      canReceive: false,
      canCancel: false,
    })
    expect(transferActionsForBranch('Received', 'TMG', 'HST', 'TMG')).toEqual({
      canReceive: false,
      canCancel: false,
    })
  })
})
