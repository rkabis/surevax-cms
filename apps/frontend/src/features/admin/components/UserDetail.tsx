import { useState } from 'react'

import { DASH, formatDateTime } from '@/lib/format'
import { useUser, useUpdateUser, useResetPin, useClearPin } from '../usersApi'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { ErrorBanner } from '@/components/layout'
import { humanizeRole } from '@/lib/status'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type Props = {
  userId: string
}

// ── kv-row pattern ────────────────────────────────────────────────────────────

function KvRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground shrink-0 w-32">{label}</span>
      <span className="text-sm text-right break-words min-w-0 flex-1">{children}</span>
    </div>
  )
}

function KvMono({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <KvRow label={label}>
      <span className="font-mono tabular-nums">{value ?? DASH}</span>
    </KvRow>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        {title}
      </h3>
      <div>{children}</div>
    </section>
  )
}

export default function UserDetail({ userId }: Props) {
  const { data: user, isLoading, isError } = useUser(userId)
  const updateUser = useUpdateUser()
  const resetPin = useResetPin()
  const clearPin = useClearPin()
  const [pendingPassword, setPendingPassword] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [resetPinOpen, setResetPinOpen] = useState(false)
  const [clearPinOpen, setClearPinOpen] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)

  async function toggleCanLogin(next: boolean) {
    if (!user) return
    if (next && !user.hasPassword && !pendingPassword) {
      setPwError('Set a password before enabling login.')
      return
    }
    setPwError(null)
    try {
      await updateUser.mutateAsync({
        id: user.id,
        body: {
          canLogin: next,
          ...(next && pendingPassword ? { password: pendingPassword } : {}),
        },
      })
      setPendingPassword('')
      toast(next ? 'Login enabled' : 'Login disabled', {
        description: `${user.firstName} ${user.lastName} can ${next ? 'now' : 'no longer'} sign in.`,
      })
    } catch (err) {
      toast.error('Could not update', { description: apiErrorMessage(err) })
    }
  }

  async function handleResetPin() {
    if (!user) return
    if (!/^\d{4}$/.test(newPin)) {
      setPinError('PIN must be exactly 4 digits.')
      return
    }
    setPinError(null)
    try {
      await resetPin.mutateAsync({ id: user.id, pin: newPin })
      setNewPin('')
      setResetPinOpen(false)
      toast('PIN updated', {
        description: `${user.firstName} ${user.lastName}'s kiosk PIN has been set.`,
      })
    } catch (err) {
      setPinError(apiErrorMessage(err))
    }
  }

  async function handleClearPin() {
    if (!user) return
    try {
      await clearPin.mutateAsync({ id: user.id })
      setClearPinOpen(false)
      toast('PIN cleared', {
        description: `${user.firstName} ${user.lastName} can no longer clock in via the kiosk.`,
      })
    } catch (err) {
      toast.error('Could not clear PIN', { description: apiErrorMessage(err) })
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
        <Separator />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !user) {
    return <ErrorBanner message="Failed to load user." className="p-6" />
  }

  const createdByName = user.createdBy
    ? [user.createdBy.firstName, user.createdBy.lastName].filter(Boolean).join(' ').trim() ||
      user.createdBy.email ||
      user.createdBy.id
    : null

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-semibold">
            {user.firstName} {user.lastName}
          </h2>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {humanizeRole(user.role)}
            </Badge>
            {user.isActive ? (
              <Badge variant="ok" className="text-xs">
                Active
              </Badge>
            ) : (
              <Badge variant="overdue" className="text-xs">
                Inactive
              </Badge>
            )}
            {!user.canLogin && (
              <Badge variant="secondary" className="text-xs">
                No login
              </Badge>
            )}
          </div>
        </div>

        <Separator />

        {/* Identity */}
        <Section title="Identity">
          <KvMono label="First name" value={user.firstName} />
          <KvMono label="Last name" value={user.lastName} />
          <KvMono label="Email" value={user.email} />
          <KvRow label="Role">
            <Badge variant="outline" className="text-xs">
              {humanizeRole(user.role)}
            </Badge>
          </KvRow>
          {user.licenseNumber && <KvMono label="License no." value={user.licenseNumber} />}
          {user.roles && user.roles.length > 0 && (
            <KvRow label="All roles">
              <div className="flex flex-wrap gap-1 justify-end">
                {user.roles.map((r) => (
                  <Badge key={r} variant="outline" className="text-xs">
                    {humanizeRole(r)}
                  </Badge>
                ))}
              </div>
            </KvRow>
          )}
          {user.branches && user.branches.length > 0 && (
            <KvRow label="Branches">
              <div className="flex flex-wrap gap-1 justify-end">
                {user.branches.map((b) => (
                  <Badge key={b.id} variant="outline" className="text-xs">
                    {b.name ?? b.id}
                  </Badge>
                ))}
              </div>
            </KvRow>
          )}
        </Section>

        <Separator />

        {/* Access */}
        <Section title="Access">
          <KvRow label="Active">
            {user.isActive ? (
              <Badge variant="ok" className="text-xs">
                Yes
              </Badge>
            ) : (
              <Badge variant="overdue" className="text-xs">
                No
              </Badge>
            )}
          </KvRow>
          <KvRow label="Can log in">
            <Badge variant={user.canLogin ? 'ok' : 'secondary'} className="text-xs">
              {user.canLogin ? 'Yes' : 'No'}
            </Badge>
          </KvRow>
          <KvRow label="Has password">
            <Badge variant={user.hasPassword ? 'ok' : 'secondary'} className="text-xs">
              {user.hasPassword ? 'Yes' : 'No'}
            </Badge>
          </KvRow>
          <KvMono label="Last login" value={formatDateTime(user.lastLoginAt)} />
          <KvMono label="Branch" value={user.branch?.name ?? null} />
          <KvMono label="Branch code" value={user.branch?.code ?? null} />
        </Section>

        {/* Login toggle */}
        <div className="rounded-md border border-border p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Login access</p>
              <p className="text-xs text-muted-foreground">
                {user.canLogin
                  ? 'This user can sign in with email + password.'
                  : 'Directory entry only — cannot sign in.'}
              </p>
            </div>
            <Button
              size="sm"
              variant={user.canLogin ? 'outline' : 'default'}
              disabled={updateUser.isPending}
              onClick={() => void toggleCanLogin(!user.canLogin)}
            >
              {user.canLogin ? 'Disable login' : 'Enable login'}
            </Button>
          </div>
          {!user.canLogin && !user.hasPassword && (
            <div className="space-y-1.5">
              <Label htmlFor="new-password">Set password</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="Min 8 characters"
                value={pendingPassword}
                onChange={(e) => setPendingPassword(e.target.value)}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                Required before enabling login since this user has no password yet.
              </p>
              {pwError && <p className="text-xs text-destructive">{pwError}</p>}
            </div>
          )}
        </div>

        {/* Kiosk PIN */}
        <div className="rounded-md border border-border p-3 space-y-3">
          <div>
            <p className="text-sm font-medium">Kiosk PIN</p>
            <p className="text-xs text-muted-foreground">
              4-digit PIN used to clock in and out at the branch kiosk.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setNewPin('')
                setPinError(null)
                setResetPinOpen(true)
              }}
            >
              Reset PIN
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setClearPinOpen(true)}>
              Clear PIN
            </Button>
          </div>
        </div>

        <Separator />

        {/* Audit */}
        <Section title="Audit">
          <KvMono label="Created at" value={formatDateTime(user.createdAt)} />
          <KvMono label="Updated at" value={formatDateTime(user.updatedAt)} />
          <KvMono label="Created by" value={createdByName} />
          <KvMono label="Creator ID" value={user.createdById} />
        </Section>
      </div>

      {/* Reset PIN dialog */}
      <Dialog
        open={resetPinOpen}
        onOpenChange={(open) => {
          if (!open) {
            setNewPin('')
            setPinError(null)
          }
          setResetPinOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>
              Reset {user.firstName} {user.lastName}&apos;s PIN
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-pin">
                New PIN <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new-pin"
                type="password"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                autoFocus
                aria-label="4-digit PIN"
                value={newPin}
                onChange={(e) => {
                  setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                  setPinError(null)
                }}
                className="font-mono tabular-nums text-2xl text-center tracking-[0.5em] h-14"
                placeholder="••••"
              />
              {pinError && <p className="text-xs text-destructive">{pinError}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetPinOpen(false)}
              disabled={resetPin.isPending}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleResetPin()} disabled={resetPin.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear PIN alert dialog */}
      <AlertDialog open={clearPinOpen} onOpenChange={setClearPinOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear PIN?</AlertDialogTitle>
            <AlertDialogDescription>
              {user.firstName} {user.lastName} will no longer be able to clock in via the kiosk
              until a new PIN is set.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearPin.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleClearPin()}
              disabled={clearPin.isPending}
            >
              Clear PIN
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScrollArea>
  )
}
