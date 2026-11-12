import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { PageHeader, ListEmpty, DetailSheet, TableCard, PageToolbar } from '@/components/layout'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { useCrossBranchGrants, type CrossBranchGrant } from './crossBranchAccessApi'
import { formatLongDateTime } from '@/lib/format'

// ── Helpers ──────────────────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  Continuity_of_care: 'Continuity of care',
  Emergency: 'Emergency',
  Patient_request: 'Patient request',
  Quality_review: 'Quality review',
  Other: 'Other',
}

function reasonLabel(raw: string): string {
  return REASON_LABELS[raw] ?? raw
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CrossBranchAccessPage() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data = [], isLoading, isError } = useCrossBranchGrants({ limit: 200 })

  // Client-side filter on the fetched list (small dataset — grants are rare)
  const filtered = search.trim()
    ? data.filter((g) => {
        const q = search.trim().toLowerCase()
        return (
          g.patientDisplayId.toLowerCase().includes(q) ||
          g.patientMrn.toLowerCase().includes(q) ||
          `${g.patientLastName} ${g.patientFirstName}`.toLowerCase().includes(q) ||
          `${g.userLastName} ${g.userFirstName}`.toLowerCase().includes(q) ||
          g.userDisplayId.toLowerCase().includes(q) ||
          g.targetBranchName?.toLowerCase().includes(q) ||
          g.targetBranchDisplayId.toLowerCase().includes(q) ||
          reasonLabel(g.reasonCategory).toLowerCase().includes(q)
        )
      })
    : data

  const selected = filtered.find((g) => g.displayId === selectedId) ?? null

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Cross-branch access"
          description="Retrospective review of break-glass PHI access grants (DPA §20 quarterly audit)."
        />
      </div>

      <PageToolbar>
        <div className="flex items-center gap-3 flex-1">
          <Input
            className="h-8 w-64 text-sm"
            placeholder="Search patient, user, branch…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {!isLoading && (
            <span className="text-xs text-muted-foreground">
              {filtered.length} grant{filtered.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </PageToolbar>

      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          <TableCard>
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Granted at</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Accessed by</TableHead>
                  <TableHead>Target branch</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Grant ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-destructive py-8">
                      Failed to load access grants.
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <ListEmpty
                        icon={ArrowLeftRight}
                        message={
                          search ? 'No grants match your search.' : 'No cross-branch access yet.'
                        }
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((g) => (
                    <TableRow
                      interactive
                      key={g.displayId}
                      className="cursor-pointer"
                      data-state={selectedId === g.displayId ? 'selected' : undefined}
                      onClick={() => setSelectedId(g.displayId === selectedId ? null : g.displayId)}
                    >
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatLongDateTime(g.grantedAt)}
                      </TableCell>
                      <TableCell>
                        <p className="text-sm font-medium">
                          {g.patientLastName}, {g.patientFirstName}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">{g.patientMrn}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">
                          {g.userLastName}, {g.userFirstName}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">{g.userDisplayId}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {g.targetBranchName ?? g.targetBranchDisplayId}
                      </TableCell>
                      <TableCell>
                        <Badge variant="info" className="text-xs">
                          {reasonLabel(g.reasonCategory)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {g.displayId}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableCard>
        </div>
      </ScrollArea>

      {/* Detail rail */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DetailSheet>{selected && <GrantDetail grant={selected} />}</DetailSheet>
      </Sheet>
    </div>
  )
}

// ── Detail component ──────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm mt-0.5">{value ?? '—'}</dd>
    </div>
  )
}

function GrantDetail({ grant }: { grant: CrossBranchGrant }) {
  return (
    <SheetHeader className="p-6 space-y-4">
      <div>
        <SheetTitle className="text-base">
          {grant.patientLastName}, {grant.patientFirstName}
        </SheetTitle>
        <SheetDescription className="text-xs font-mono mt-1">{grant.displayId}</SheetDescription>
      </div>

      <dl className="space-y-3">
        <Field label="Granted at" value={formatLongDateTime(grant.grantedAt)} />
        <Field label="Reason" value={reasonLabel(grant.reasonCategory)} />
        <Field label="Reason detail" value={grant.reasonDetail} />
        <Field label="Patient" value={`${grant.patientLastName}, ${grant.patientFirstName}`} />
        <Field label="Patient MRN" value={grant.patientMrn} />
        <Field label="Patient ID" value={grant.patientDisplayId} />
        <Field label="Accessed by" value={`${grant.userLastName}, ${grant.userFirstName}`} />
        <Field label="User ID" value={grant.userDisplayId} />
        <Field
          label="Target branch"
          value={grant.targetBranchName ?? grant.targetBranchDisplayId}
        />
        <Field label="Target branch ID" value={grant.targetBranchDisplayId} />
        <Field label="Correlation ID" value={grant.correlationId ?? 'Not recorded'} />
      </dl>

      {grant.correlationId && (
        <div className="rounded border border-border bg-muted/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Cross-reference this correlation ID in the Audit Log to see all events from the same
            break-glass request.
          </p>
        </div>
      )}
    </SheetHeader>
  )
}
