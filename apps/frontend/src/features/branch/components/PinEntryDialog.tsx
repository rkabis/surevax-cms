import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'
import { ErrorBanner } from '@/components/layout'

type Props = {
  userId: string
  userName: string
  action: 'clock-in' | 'clock-out'
  open: boolean
  onOpenChange: (open: boolean) => void
  onVerified: () => void
}

export function PinEntryDialog({
  userId,
  userName,
  action,
  open,
  onOpenChange,
  onVerified,
}: Props) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)
  const [lockedSecondsLeft, setLockedSecondsLeft] = useState(0)
  const [isVerifying, setIsVerifying] = useState(false)
  const [noPinSet, setNoPinSet] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset all state when dialog closes
  function resetState() {
    setPin('')
    setError(null)
    setLockedUntil(null)
    setLockedSecondsLeft(0)
    setIsVerifying(false)
    setNoPinSet(false)
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetState()
    onOpenChange(next)
  }

  // Countdown timer
  useEffect(() => {
    if (!lockedUntil) return
    const tick = () => {
      const diff = Math.ceil((lockedUntil - Date.now()) / 1000)
      if (diff <= 0) {
        setLockedUntil(null)
        setLockedSecondsLeft(0)
        setError(null)
      } else {
        setLockedSecondsLeft(diff)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lockedUntil])

  // Auto-focus when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  async function verifyPin(digits: string) {
    setIsVerifying(true)
    setError(null)
    try {
      // Use raw fetch so we can read the full JSON body on 429 (retryAfter field).
      // CSRF header is required on POST.
      const res = await fetch(`${API_BASE_URL}/api/auth/verify-pin`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...STANDARD_API_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, pin: digits }),
      })

      setPin('')

      if (res.ok) {
        handleOpenChange(false)
        onVerified()
        return
      }

      let body: { code?: string; retryAfter?: number } = {}
      try {
        body = (await res.json()) as { code?: string; retryAfter?: number }
      } catch {
        // ignore parse failure
      }

      if (res.status === 401 && body.code === 'INVALID_PIN') {
        setError('Incorrect PIN — try again.')
        setTimeout(() => inputRef.current?.focus(), 50)
      } else if (res.status === 429 && body.code === 'LOCKED_OUT') {
        const retryAfter = typeof body.retryAfter === 'number' ? body.retryAfter : 30
        setLockedUntil(Date.now() + retryAfter * 1000)
        setLockedSecondsLeft(retryAfter)
      } else if (res.status === 404 && body.code === 'NO_PIN_SET') {
        setNoPinSet(true)
      } else {
        setError('Something went wrong. Please try again.')
      }
    } catch {
      setPin('')
      setError('Network error. Please try again.')
    } finally {
      setIsVerifying(false)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Strip non-digits
    const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
    setPin(digits)
    setError(null)
    if (digits.length === 4 && !isVerifying && !lockedUntil) {
      void verifyPin(digits)
    }
  }

  const isLocked = !!lockedUntil && lockedSecondsLeft > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Enter PIN</DialogTitle>
          <DialogDescription>
            {userName} — {action === 'clock-in' ? 'Clock in' : 'Clock out'}
          </DialogDescription>
        </DialogHeader>

        {noPinSet ? (
          <div className="space-y-4 py-2">
            <ErrorBanner message="No PIN set for this user. Ask an admin to set one." />
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <Input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              autoFocus
              aria-label="4-digit PIN"
              value={pin}
              onChange={handleChange}
              disabled={isVerifying || isLocked}
              className="font-mono tabular-nums text-2xl text-center tracking-[0.5em] h-14"
              placeholder="••••"
            />

            {isLocked && (
              <p className="text-sm text-destructive text-center">
                Locked out. Try again in {lockedSecondsLeft}s.
              </p>
            )}

            {error && !isLocked && <ErrorBanner message={error} />}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isVerifying}
              >
                Cancel
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
