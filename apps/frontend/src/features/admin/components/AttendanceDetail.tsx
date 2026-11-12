import { useAttendanceLog } from '../attendanceApi'
import { DASH, formatDateTime } from '@/lib/format'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { ErrorBanner } from '@/components/layout'
import { UserLabel } from '@/components/UserLabel'

type Props = {
  logId: string
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

export default function AttendanceDetail({ logId }: Props) {
  const { data, isLoading, isError } = useAttendanceLog(logId)

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Separator />
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !data?.data) {
    return <ErrorBanner message="Failed to load time log." className="p-6" />
  }

  const log = data.data
  const isActive = !log.clockOutAt

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-semibold">
            {log.user.lastName}, {log.user.firstName}
          </h2>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {log.user.role}
            </Badge>
            {isActive ? (
              <Badge variant="ok" className="text-xs gap-1">
                <div className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                Active
              </Badge>
            ) : (
              <span className="text-sm text-muted-foreground">
                {log.totalHours ? `${log.totalHours}h worked` : ''}
              </span>
            )}
          </div>
        </div>

        <Separator />

        {/* Shift */}
        <Section title="Shift">
          <KvMono label="Clock in" value={formatDateTime(log.clockInAt)} />
          <KvMono label="Clock out" value={formatDateTime(log.clockOutAt)} />
          <KvMono label="Total hours" value={log.totalHours} />
          {log.notes && (
            <KvRow label="Notes">
              <span className="text-sm">{log.notes}</span>
            </KvRow>
          )}
        </Section>

        <Separator />

        {/* Staff */}
        <Section title="Staff">
          <KvMono label="First name" value={log.user.firstName} />
          <KvMono label="Last name" value={log.user.lastName} />
          <KvMono label="Role" value={log.user.role} />
          <KvMono label="Email" value={log.user.email} />
        </Section>

        <Separator />

        {/* Location */}
        <Section title="Location">
          <KvMono label="Branch" value={log.branch.name} />
          <KvMono label="Branch code" value={log.branch.code} />
        </Section>

        <Separator />

        {/* Audit */}
        <Section title="Audit">
          <KvMono label="Created at" value={formatDateTime(log.createdAt)} />
          <KvMono label="Updated at" value={formatDateTime(log.updatedAt)} />
          <KvNode label="Created by">
            <UserLabel user={log.createdBy} />
          </KvNode>
        </Section>
      </div>
    </ScrollArea>
  )
}
