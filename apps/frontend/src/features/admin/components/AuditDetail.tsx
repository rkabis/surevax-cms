import { useAuditEntry } from '../auditApi'
import { maskSensitive } from '@/lib/sensitive'
import { DASH, formatDateTime } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/layout'

type Props = {
  auditId: string
}

const ACTION_VARIANT: Record<
  string,
  'default' | 'secondary' | 'outline' | 'due' | 'overdue' | 'ok' | 'info'
> = {
  CREATE: 'ok',
  UPDATE: 'info',
  DELETE: 'overdue',
  LOGIN: 'ok',
  LOGOUT: 'outline',
  TRANSACTION_MODIFY: 'due',
  SCHEDULE_CHANGE: 'info',
  CROSS_BRANCH_ACCESS: 'due',
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
      <span className="font-mono tabular-nums">{value && value.length > 0 ? value : DASH}</span>
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

export default function AuditDetail({ auditId }: Props) {
  const { data: entry, isLoading, isError } = useAuditEntry(auditId)

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
        <div className="space-y-3 mt-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !entry) {
    return <ErrorBanner message="Failed to load audit entry." className="p-6" />
  }

  const user = entry.user
  const fullName =
    user && (user.firstName || user.lastName)
      ? [user.firstName, user.lastName].filter(Boolean).join(' ')
      : null

  const hasChanges = entry.changes !== null && entry.changes !== undefined
  const changesText = hasChanges ? JSON.stringify(maskSensitive(entry.changes), null, 2) : null

  const hasMetadata = entry.metadata !== null && entry.metadata !== undefined
  const metadataText = hasMetadata ? JSON.stringify(maskSensitive(entry.metadata), null, 2) : null

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge
              variant={ACTION_VARIANT[entry.action] ?? 'outline'}
              className="text-xs font-mono"
            >
              {entry.action}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {entry.entityType}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground font-mono tabular-nums">
            {entry.id.slice(0, 8)}…
          </span>
        </div>

        <Separator />

        {/* Event */}
        <Section title="Event">
          <KvRow label="Action">
            <Badge
              variant={ACTION_VARIANT[entry.action] ?? 'outline'}
              className="text-xs font-mono"
            >
              {entry.action}
            </Badge>
          </KvRow>
          <KvMono label="Entity type" value={entry.entityType} />
          <KvMono label="Entity ID" value={entry.entityId} />
          <KvMono label="Timestamp" value={formatDateTime(entry.timestamp)} />
          <KvMono label="Session ID" value={entry.sessionId} />
          <KvMono label="Correlation ID" value={entry.correlationId} />
        </Section>

        <Separator />

        {/* Actor */}
        <Section title="Actor">
          <KvMono label="First name" value={user?.firstName ?? null} />
          <KvMono label="Last name" value={user?.lastName ?? null} />
          <KvMono label="Full name" value={fullName} />
          <KvMono label="Email" value={user?.email ?? null} />
          <KvMono label="Role" value={user?.role ?? null} />
          <KvMono label="IP address" value={entry.ipAddress} />
          <KvRow label="User agent">
            <span className="text-xs font-mono break-all">{entry.userAgent ?? DASH}</span>
          </KvRow>
        </Section>

        <Separator />

        {/* Location */}
        <Section title="Location">
          <KvMono label="Branch" value={entry.branch?.name ?? null} />
        </Section>

        {/* Payload */}
        {changesText && (
          <>
            <Separator />
            <Section title="Payload">
              <pre className="text-xs bg-muted/40 rounded border border-border p-3 overflow-auto max-h-[25rem] whitespace-pre-wrap break-words font-mono mt-2">
                {changesText}
              </pre>
            </Section>
          </>
        )}

        {/* Metadata */}
        {metadataText && (
          <>
            <Separator />
            <Section title="Metadata">
              <pre className="text-xs bg-muted/40 rounded border border-border p-3 overflow-auto max-h-[25rem] whitespace-pre-wrap break-words font-mono mt-2">
                {metadataText}
              </pre>
            </Section>
          </>
        )}
      </div>
    </ScrollArea>
  )
}
