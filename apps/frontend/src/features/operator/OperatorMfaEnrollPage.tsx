import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Copy, Loader2, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import OperatorShell from './OperatorShell'
import { operatorMfaEnroll, operatorMfaVerify } from './operatorApi'

export default function OperatorMfaEnrollPage() {
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const enroll = useQuery({
    queryKey: ['operator', 'mfa', 'enroll'],
    queryFn: operatorMfaEnroll,
    staleTime: Infinity,
    retry: false,
  })

  const verify = useMutation({
    mutationFn: (t: string) => operatorMfaVerify(t),
    onSuccess: () => {
      navigate('/operator', { replace: true })
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Invalid code. Try again.')
    },
  })

  function copySecret() {
    if (!enroll.data) return
    navigator.clipboard
      .writeText(enroll.data.base32Secret)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(token)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    verify.mutate(token)
  }

  return (
    <OperatorShell>
      <div className="h-full flex flex-col">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
          <PageHeader
            title="Set up two-factor authentication"
            description="Scan the QR with Google Authenticator, Authy, 1Password, or any TOTP app. Then enter the 6-digit code to confirm."
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 xl:px-8 2xl:px-10 py-8 space-y-8">
            {enroll.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={15} className="animate-spin" />
                Generating your authenticator secret…
              </div>
            )}

            {enroll.isError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2.5"
              >
                <AlertCircle
                  size={15}
                  className="mt-[1px] shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <p className="text-sm text-destructive leading-snug">
                  {enroll.error instanceof Error
                    ? enroll.error.message
                    : 'Could not start MFA enrollment. Reload the page and try again.'}
                </p>
              </div>
            )}

            {enroll.data && (
              <>
                <div className="rounded-md border border-border bg-card p-4 sm:p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={18} className="text-primary" aria-hidden />
                    <h2 className="text-base font-semibold">Step 1 — Scan</h2>
                  </div>
                  <div className="flex flex-col items-center gap-3">
                    <img
                      src={enroll.data.qrCodeDataUrl}
                      alt="MFA QR code"
                      className="h-48 w-48 rounded bg-white p-2 border border-border"
                    />
                    <div className="w-full">
                      <Label className="text-xs text-muted-foreground">
                        Or paste this secret manually
                      </Label>
                      <div className="flex items-center gap-2 mt-1">
                        <Input
                          readOnly
                          value={enroll.data.base32Secret}
                          className="font-mono tabular-nums text-xs"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={copySecret}
                          aria-label="Copy secret to clipboard"
                        >
                          <Copy size={14} className="mr-1.5" aria-hidden />
                          {copied ? 'Copied' : 'Copy'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <form
                  onSubmit={handleSubmit}
                  className="rounded-md border border-border bg-card p-4 sm:p-6 space-y-4"
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={18} className="text-primary" aria-hidden />
                    <h2 className="text-base font-semibold">Step 2 — Verify</h2>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mfa-token">
                      6-digit code from your authenticator{' '}
                      <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="mfa-token"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={token}
                      onChange={(e) => {
                        setToken(e.target.value.replace(/\D/g, ''))
                        setError(null)
                      }}
                      className="font-mono tabular-nums tracking-widest"
                      placeholder="000000"
                      autoFocus
                    />
                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2.5"
                    >
                      <AlertCircle
                        size={15}
                        className="mt-[1px] shrink-0 text-destructive"
                        aria-hidden="true"
                      />
                      <p className="text-sm text-destructive leading-snug">{error}</p>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => navigate('/operator')}
                      disabled={verify.isPending}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={verify.isPending}>
                      {verify.isPending && <Loader2 size={15} className="animate-spin mr-1.5" />}
                      Enable MFA
                    </Button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </OperatorShell>
  )
}
