import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react'
import { useConsents } from '../api'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-PH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

type Props = {
  patientId: string
}

export default function ConsentsTab({ patientId }: Props) {
  const { data, isLoading, isError } = useConsents(patientId)

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" aria-hidden />
        Failed to load consent records.
      </div>
    )
  }

  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">No consent records on file.</p>
  }

  return (
    <ul className="divide-y divide-border rounded border border-border">
      {data.map((consent) => {
        const revoked = !!consent.revokedAt
        return (
          <li key={consent.id} className="flex items-start gap-3 px-3 py-3">
            {revoked ? (
              <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-triage-ok shrink-0 mt-0.5" aria-hidden />
            )}
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{consent.consentType}</span>
                <Badge variant={revoked ? 'overdue' : 'default'} className="text-xs">
                  {revoked ? 'Revoked' : 'Active'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono tabular-nums">
                Consented {fmtDate(consent.obtainedAt)}
              </p>
              {consent.revokedAt && (
                <p className="text-xs text-muted-foreground font-mono tabular-nums">
                  Revoked {fmtDate(consent.revokedAt)}
                </p>
              )}
              {consent.notes && <p className="text-xs text-muted-foreground">{consent.notes}</p>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
