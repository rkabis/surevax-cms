import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConnectivityBanner } from '../ConnectivityBanner'

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

describe('ConnectivityBanner', () => {
  it('warns against repeating ambiguous clinical and financial actions while offline', () => {
    setOnline(true)
    render(<ConnectivityBanner />)
    expect(screen.queryByText('Clinic terminal is offline')).not.toBeInTheDocument()

    act(() => setOnline(false))
    expect(screen.getByText('Clinic terminal is offline')).toBeInTheDocument()
    expect(screen.getByText(/Do not repeat a dose, payment, or stock action/)).toBeInTheDocument()

    act(() => setOnline(true))
    expect(screen.queryByText('Clinic terminal is offline')).not.toBeInTheDocument()
  })
})
