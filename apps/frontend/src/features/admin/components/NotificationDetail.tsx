import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { notificationStatusVariant } from '@/lib/status'
import { UserLabel } from '@/components/UserLabel'
import { Button } from '@/components/ui/button'
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
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from '@/components/ui/toast'
import { DASH, formatDateTime } from '@/lib/format'
import { useNotification, useResendNotification } from '../notificationsApi'
import { apiErrorMessage } from '@/lib/apiErrors'
import { ErrorBanner } from '@/components/layout'

type Props = {
  id: string
}

// Mask sensitive keys in JSONB metadata
const SENSITIVE_KEYS = /api_key|secret|token|password|auth|credential/i
function maskSensitiveJson(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map(maskSensitiveJson)
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.test(k) ? '***' : maskSensitiveJson(v),
    ]),
  )
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

function KvMono({ label, value }: { label: string; value?: string | number | null }) {
  const display = value === null || value === undefined || value === '' ? DASH : String(value)
  return (
    <KvRow label={label}>
      <span className="font-mono tabular-nums">{display}</span>
    </KvRow>
  )
}

function KvNode({ label, children }: { label: string; children: React.ReactNode }) {
  return <KvRow label={label}>{children}</KvRow>
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

export default function NotificationDetail({ id }: Props) {
  const { data: ntf, isLoading, isError } = useNotification(id)
  const resend = useResendNotification()
  const [resendOpen, setResendOpen] = useState(false)
  const [resending, setResending] = useState(false)

  function handleResend() {
    setResending(true)
    resend.mutate(
      { id },
      {
        onSuccess: () => {
          setResendOpen(false)
          setResending(false)
          toast('Notification queued for resend')
        },
        onError: (err) => {
          setResending(false)
          setResendOpen(false)
          const msg = apiErrorMessage(err)
          if (
            err instanceof Error &&
            (err.message.includes('409') || err.message.toLowerCase().includes('queued'))
          ) {
            toast('Already queued', {
              description: 'This notification is already in the Queued state.',
            })
          } else {
            toast.error('Resend failed', { description: msg })
          }
        },
      },
    )
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

  if (isError || !ntf) {
    return <ErrorBanner message="Failed to load notification." className="p-6" />
  }

  const maskedMetadata = maskSensitiveJson(ntf.metadata)

  return (
    <>
      <ScrollArea className="h-full">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono tabular-nums text-xs text-muted-foreground">{ntf.id}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge variant={notificationStatusVariant(ntf.status)}>{ntf.status}</Badge>
                <Badge variant="outline" className="text-xs">
                  {ntf.channel}
                </Badge>
              </div>
            </div>
            {ntf.status !== 'Queued' && (
              <Button size="sm" variant="outline" onClick={() => setResendOpen(true)}>
                Resend
              </Button>
            )}
          </div>

          <Separator />

          {/* Addressing */}
          <Section title="Addressing">
            <KvMono label="Patient ID" value={ntf.patientId} />
            <KvMono label="Patient name" value={ntf.patientName} />
            <KvMono label="Recipient" value={ntf.recipientAddress} />
            <KvMono label="User ID" value={ntf.userId} />
          </Section>

          <Separator />

          {/* Template */}
          <Section title="Template">
            <KvMono label="Template ID" value={ntf.templateId} />
            <KvMono label="Template code" value={ntf.templateCode} />
          </Section>

          <Separator />

          {/* Content */}
          <Section title="Content">
            {ntf.subject && (
              <KvRow label="Subject">
                <span className="text-sm">{ntf.subject}</span>
              </KvRow>
            )}
            <KvRow label="Body">
              <p className="text-sm whitespace-pre-wrap break-words rounded-md bg-muted/40 px-2 py-1.5">
                {ntf.body}
              </p>
            </KvRow>
          </Section>

          <Separator />

          {/* Delivery */}
          <Section title="Delivery">
            <KvMono
              label="Scheduled at"
              value={ntf.scheduledAt ? formatDateTime(ntf.scheduledAt) : null}
            />
            <KvMono label="Sent at" value={ntf.sentAt ? formatDateTime(ntf.sentAt) : null} />
            <KvMono
              label="Delivered at"
              value={ntf.deliveredAt ? formatDateTime(ntf.deliveredAt) : null}
            />
            <KvMono label="Read at" value={ntf.readAt ? formatDateTime(ntf.readAt) : null} />
            <KvMono label="External msg ID" value={ntf.externalMessageId} />
            <KvMono label="Retry count" value={ntf.retryCount} />
            {ntf.failureReason && (
              <KvRow label="Failure reason">
                <span className="text-sm text-destructive break-words">{ntf.failureReason}</span>
              </KvRow>
            )}
            <KvMono
              label="Consent verified"
              value={ntf.consentVerifiedAt ? formatDateTime(ntf.consentVerifiedAt) : null}
            />
          </Section>

          {/* Metadata */}
          {ntf.metadata !== null && ntf.metadata !== undefined && (
            <>
              <Separator />
              <Section title="Metadata">
                <pre className="rounded-md bg-muted/40 px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap break-words font-mono mt-2">
                  {JSON.stringify(maskedMetadata, null, 2)}
                </pre>
              </Section>
            </>
          )}

          <Separator />

          {/* Audit */}
          <Section title="Audit">
            <KvMono label="Created at" value={formatDateTime(ntf.createdAt)} />
            <KvMono label="Updated at" value={formatDateTime(ntf.updatedAt)} />
            <KvNode label="Created by">
              <UserLabel user={ntf.createdBy} />
            </KvNode>
          </Section>
        </div>
      </ScrollArea>

      {/* Resend confirm dialog */}
      <AlertDialog open={resendOpen} onOpenChange={setResendOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resend notification?</AlertDialogTitle>
            <AlertDialogDescription>
              This will re-queue the notification for delivery. If it is already in the{' '}
              <span className="font-medium">Queued</span> state the request will be rejected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResend} disabled={resending}>
              {resending ? 'Resending…' : 'Resend'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
