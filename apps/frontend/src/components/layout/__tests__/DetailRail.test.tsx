import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { DetailRail } from '../DetailRail'
import { DetailSheet } from '../DetailSheet'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open patient details</Button>
      <DetailRail open={open} onOpenChange={setOpen} announcement="Patient details opened.">
        <DetailSheet>
          <SheetTitle>Patient details</SheetTitle>
          <SheetDescription>Selected patient information.</SheetDescription>
        </DetailSheet>
      </DetailRail>
    </>
  )
}

describe('DetailRail desktop keyboard continuity', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width: 1536px'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  it('announces the non-modal rail and restores focus to the invoking control', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open patient details' })
    trigger.focus()
    fireEvent.click(trigger)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Patient details opened. Press Escape to close. The worklist remains available.',
    )

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
