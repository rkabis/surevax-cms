import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  Baby,
  ClipboardCheck,
  ListChecks,
  Search,
  ShieldCheck,
  Syringe,
  Users,
} from 'lucide-react'
import { useAuth } from '@/features/auth/context'
import { ADMIN_ROLES, CASH_DRAWER_ROLES, hasRole } from '@/lib/roles'
import { apiErrorMessage } from '@/lib/apiErrors'
import { formatDateTime, formatMoney } from '@/lib/format'
import { toast } from '@/components/ui/toast'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DetailRail,
  DetailSheet,
  KpiCell,
  KpiStrip,
  ListEmpty,
  PageHeader,
  PageToolbar,
  TableCard,
} from '@/components/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useReviewCenter,
  useUpdateGuardian,
  type ExternalImmunizationReviewRow,
  type MissingGuardianRow,
  type PotentialDuplicateRow,
} from './api'

type QueueTab = 'guardians' | 'loose-ends' | 'duplicates' | 'external-immunizations'
type LooseEndFilter = 'all' | 'encounters' | 'transactions' | 'drawers' | 'documentation'

function manilaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function GuardianReviewSheet({
  row,
  onClose,
}: {
  row: MissingGuardianRow | null
  onClose: () => void
}) {
  const updateGuardian = useUpdateGuardian()
  const [name, setName] = useState('')
  const [relationship, setRelationship] = useState('')
  const [contact, setContact] = useState('')

  useEffect(() => {
    setName(row?.guardianName ?? '')
    setRelationship(row?.guardianRelationship ?? '')
    setContact(row?.guardianContact ?? '')
  }, [row])

  const canSubmit = !!row && !!name.trim() && !!relationship.trim() && !!contact.trim()

  async function submit() {
    if (!row || !canSubmit) return
    try {
      await updateGuardian.mutateAsync({
        patientId: row.patientId,
        body: {
          guardianName: name.trim(),
          guardianRelationship: relationship.trim(),
          guardianContact: contact.trim(),
          expectedRowVersion: row.rowVersion,
        },
      })
      toast.success('Guardian information saved and removed from the queue.')
      onClose()
    } catch (error) {
      toast.error(apiErrorMessage(error))
    }
  }

  return (
    <DetailRail open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DetailSheet width="narrow">
        <SheetHeader className="px-6 py-4 border-b border-border text-left">
          <SheetTitle>Complete guardian information</SheetTitle>
          <SheetDescription>
            Confirm the accountable adult from the patient or their documents. Do not infer an
            identity.
          </SheetDescription>
        </SheetHeader>
        {row && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div>
              <p className="font-medium">{row.patientName}</p>
              <p className="text-xs text-muted-foreground font-mono tabular-nums">
                {row.mrn} · {row.patientId} · age {row.age}
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="review-guardian-name">Guardian name</Label>
                <Input
                  id="review-guardian-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="review-guardian-relationship">Relationship</Label>
                <Input
                  id="review-guardian-relationship"
                  value={relationship}
                  onChange={(event) => setRelationship(event.target.value)}
                  placeholder="e.g. Mother, father, legal guardian"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="review-guardian-contact">Contact number</Label>
                <Input
                  id="review-guardian-contact"
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Commit effects</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p>
                  Updates the three guardian fields on {row.patientName}&rsquo;s patient record.
                </p>
                <p>
                  Records the signed-in staff member and the update event in the audit trail;
                  sensitive guardian values stay redacted there.
                </p>
                <p>Removes this item from the missing-guardian queue.</p>
                <p className="text-muted-foreground">
                  No encounter, dose, transaction, or consent is created or closed.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-2 bg-card">
          <Button variant="outline" onClick={onClose} disabled={updateGuardian.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || updateGuardian.isPending}>
            {updateGuardian.isPending ? 'Saving…' : 'Confirm and save'}
          </Button>
        </div>
      </DetailSheet>
    </DetailRail>
  )
}

function GuardiansQueue({
  rows,
  count,
  onSelect,
}: {
  rows: MissingGuardianRow[]
  count: number
  onSelect: (row: MissingGuardianRow) => void
}) {
  if (rows.length === 0) {
    return (
      <ListEmpty
        icon={Baby}
        message={
          count === 0 ? 'No minors need guardian review.' : 'No guardian items match this search.'
        }
      />
    )
  }
  return (
    <TableCard>
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            <TableHead>Patient</TableHead>
            <TableHead>Age / DOB</TableHead>
            <TableHead>Missing</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const missing = [
              !row.guardianName && 'name',
              !row.guardianRelationship && 'relationship',
              !row.guardianContact && 'contact',
            ].filter(Boolean)
            return (
              <TableRow key={row.patientId} data-severity="due">
                <TableCell>
                  <p className="font-medium">{row.patientName}</p>
                  <p className="text-xs text-muted-foreground font-mono tabular-nums">
                    {row.mrn} · {row.patientId}
                  </p>
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {row.age} · {row.dateOfBirth}
                </TableCell>
                <TableCell>
                  <Badge variant="due">{missing.join(', ')}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => onSelect(row)}>
                    Review
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableCard>
  )
}

type LooseEndRow = {
  key: string
  kind: Exclude<LooseEndFilter, 'all'>
  title: string
  detail: string
  when: string
  href: string | null
  badge: string
  severity: 'overdue' | 'due'
}

function LooseEndsQueue({
  data,
  filter,
  canOperateDrawer,
}: {
  data: NonNullable<ReturnType<typeof useReviewCenter>['data']>['yesterdayLooseEnds']
  filter: LooseEndFilter
  canOperateDrawer: boolean
}) {
  const rows = useMemo<LooseEndRow[]>(() => {
    const all: LooseEndRow[] = [
      ...data.staleOpenEncounters.rows.map((row) => ({
        key: row.encounterId,
        kind: 'encounters' as const,
        title: `${row.patientName} · ${row.specialty}`,
        detail: `${row.encounterId} remains ${row.status}`,
        when: row.startedAt,
        href: `/encounters?selected=${encodeURIComponent(row.encounterId)}`,
        badge: 'Open encounter',
        severity: 'overdue' as const,
      })),
      ...data.unsettledTransactions.rows.map((row) => ({
        key: row.transactionId,
        kind: 'transactions' as const,
        title: `${row.patientName} · ${formatMoney(row.outstandingAmount)} outstanding`,
        detail: `${row.transactionId} · ${row.status}`,
        when: row.createdAt,
        href: `/transactions?view=all&selected=${encodeURIComponent(row.transactionId)}`,
        badge: 'Unsettled',
        severity: 'due' as const,
      })),
      ...data.openPriorDrawers.rows.map((row) => ({
        key: row.sessionId,
        kind: 'drawers' as const,
        title: `${row.userName ?? 'Branch drawer'} · ${formatMoney(row.openingFloat)} opening float`,
        detail: `${row.sessionId} is still open`,
        when: row.openedAt,
        href: canOperateDrawer ? '/branch/kiosk' : null,
        badge: 'Open drawer',
        severity: 'overdue' as const,
      })),
      ...data.undocumentedAdministrations.rows.map((row) => ({
        key: row.orderId,
        kind: 'documentation' as const,
        title: `${row.patientName} · ${row.serviceName}`,
        detail: `${row.orderId} has no documenting actor`,
        when: row.completedAt,
        href: `/scheduled-orders?tab=completed&selected=${encodeURIComponent(row.orderId)}`,
        badge: 'Documentation gap',
        severity: 'overdue' as const,
      })),
    ]
    return all
      .filter((row) => filter === 'all' || row.kind === filter)
      .sort((a, b) => a.when.localeCompare(b.when))
  }, [canOperateDrawer, data, filter])

  if (rows.length === 0) {
    return <ListEmpty icon={ListChecks} message="No loose ends in this category." />
  }

  return (
    <TableCard>
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Age</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Owner page</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.kind}-${row.key}`} data-severity={row.severity}>
              <TableCell>
                <p className="font-medium">{row.title}</p>
                <p className="text-xs text-muted-foreground font-mono tabular-nums">{row.detail}</p>
              </TableCell>
              <TableCell className="font-mono tabular-nums">{formatDateTime(row.when)}</TableCell>
              <TableCell>
                <Badge variant={row.severity}>{row.badge}</Badge>
              </TableCell>
              <TableCell className="text-right">
                {row.href ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to={row.href}>
                      Open <ArrowRight className="h-3.5 w-3.5 ml-1.5" aria-hidden />
                    </Link>
                  </Button>
                ) : (
                  <Badge variant="secondary">Financial role required</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}

function PotentialDuplicatesQueue({ rows }: { rows: PotentialDuplicateRow[] }) {
  if (rows.length === 0) {
    return <ListEmpty icon={Users} message="No patients are flagged for duplicate review." />
  }
  return (
    <TableCard>
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            <TableHead>Patient</TableHead>
            <TableHead>DOB</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Flagged</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.patientId} data-severity="due">
              <TableCell>
                <p className="font-medium">{row.patientName}</p>
                <p className="text-xs text-muted-foreground font-mono tabular-nums">
                  {row.mrn} · {row.patientId}
                </p>
              </TableCell>
              <TableCell className="font-mono tabular-nums">{row.dateOfBirth ?? '—'}</TableCell>
              <TableCell>{row.contactNumber ?? '—'}</TableCell>
              <TableCell className="font-mono tabular-nums">
                {formatDateTime(row.flaggedAt)}
              </TableCell>
              <TableCell className="text-right">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/patients/${row.patientId}`}>
                    Open flagged record <ArrowRight className="h-3.5 w-3.5 ml-1.5" aria-hidden />
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}

function ExternalImmunizationsQueue({ rows }: { rows: ExternalImmunizationReviewRow[] }) {
  if (rows.length === 0) {
    return (
      <ListEmpty icon={Syringe} message="No external immunizations are awaiting verification." />
    )
  }
  return (
    <TableCard>
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            <TableHead>Patient</TableHead>
            <TableHead>External dose</TableHead>
            <TableHead>Date / source</TableHead>
            <TableHead>Facility</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={`${row.patientId}-${row.createdAt}-${row.vaccineName}`}
              data-severity="due"
            >
              <TableCell>
                <p className="font-medium">{row.patientName}</p>
                <p className="text-xs text-muted-foreground font-mono tabular-nums">
                  {row.mrn} · {row.patientId}
                </p>
              </TableCell>
              <TableCell>
                <p className="font-medium">{row.vaccineName}</p>
                <Badge variant="due" className="mt-1">
                  Needs verification
                </Badge>
              </TableCell>
              <TableCell>
                <p className="font-mono tabular-nums">{row.administeredDate ?? 'Unknown date'}</p>
                <p className="text-xs text-muted-foreground">
                  {row.administeredDatePrecision.toLowerCase()} · {row.source}
                </p>
              </TableCell>
              <TableCell>{row.administeredAtFacility ?? 'Not recorded'}</TableCell>
              <TableCell className="text-right">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/patients/${row.patientId}?tab=immunizations`}>
                    Review evidence <ArrowRight className="h-3.5 w-3.5 ml-1.5" aria-hidden />
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}

export default function ReviewCenterPage() {
  const { user } = useAuth()
  const canOperateDrawer = hasRole(user, CASH_DRAWER_ROLES)
  const [tab, setTab] = useState<QueueTab>('loose-ends')
  const [looseEndFilter, setLooseEndFilter] = useState<LooseEndFilter>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedGuardian, setSelectedGuardian] = useState<MissingGuardianRow | null>(null)
  const date = manilaDate()

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const review = useReviewCenter({
    date,
    q: tab === 'loose-ends' ? undefined : debouncedSearch,
  })
  const data = review.data
  const isAdmin = ADMIN_ROLES.has(user?.role ?? '')

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Review Center"
          description="One branch-scoped worklist for records that need an accountable staff decision now."
        />
      </div>

      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell
            label="Yesterday's loose ends"
            value={data?.counts.yesterdayLooseEnds ?? '—'}
            subtitle="Clinical and financial carry-over"
            tone="overdue"
          />
          <KpiCell
            label="Missing guardians"
            value={data?.counts.missingGuardians ?? '—'}
            subtitle="Minors with incomplete guardian details"
            tone="due"
          />
          <KpiCell
            label="Possible duplicates"
            value={data?.counts.potentialDuplicates ?? '—'}
            subtitle="Records requiring comparison"
            tone="due"
          />
          <KpiCell
            label="External doses"
            value={data?.counts.externalImmunizations ?? '—'}
            subtitle="Awaiting evidence verification"
            tone="due"
          />
        </KpiStrip>
      </div>

      <PageToolbar>
        <Tabs value={tab} onValueChange={(value) => setTab(value as QueueTab)}>
          <TabsList>
            <TabsTrigger value="loose-ends">
              Loose ends {data ? `(${data.counts.yesterdayLooseEnds})` : ''}
            </TabsTrigger>
            <TabsTrigger value="guardians">
              Missing guardians {data ? `(${data.counts.missingGuardians})` : ''}
            </TabsTrigger>
            <TabsTrigger value="duplicates">
              Possible duplicates {data ? `(${data.counts.potentialDuplicates})` : ''}
            </TabsTrigger>
            <TabsTrigger value="external-immunizations">
              External doses {data ? `(${data.counts.externalImmunizations})` : ''}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {tab !== 'loose-ends' ? (
          <div className="relative flex-1 max-w-sm ml-auto">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                tab === 'external-immunizations'
                  ? 'Search patient, MRN, ID, or vaccine'
                  : 'Search patient, MRN, or ID'
              }
              className="pl-9 h-8"
            />
          </div>
        ) : (
          data && (
            <Tabs
              value={looseEndFilter}
              onValueChange={(value) => setLooseEndFilter(value as LooseEndFilter)}
              className="ml-auto"
            >
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="encounters">
                  Encounters ({data.yesterdayLooseEnds.staleOpenEncounters.count})
                </TabsTrigger>
                <TabsTrigger value="transactions">
                  Transactions ({data.yesterdayLooseEnds.unsettledTransactions.count})
                </TabsTrigger>
                <TabsTrigger value="drawers">
                  Drawers ({data.yesterdayLooseEnds.openPriorDrawers.count})
                </TabsTrigger>
                <TabsTrigger value="documentation">
                  Documentation ({data.yesterdayLooseEnds.undocumentedAdministrations.count})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )
        )}
      </PageToolbar>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 space-y-4">
          {review.isLoading && (
            <div className="py-16 text-center text-sm text-muted-foreground" role="status">
              Loading review queues…
            </div>
          )}
          {review.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Couldn&rsquo;t load Review Center</AlertTitle>
              <AlertDescription>
                {apiErrorMessage(review.error)}{' '}
                <Button variant="link" className="h-auto p-0" onClick={() => review.refetch()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {!review.isLoading && !review.isError && data && tab === 'guardians' && (
            <GuardiansQueue
              rows={data.missingGuardians.rows}
              count={data.missingGuardians.count}
              onSelect={setSelectedGuardian}
            />
          )}
          {!review.isLoading && !review.isError && data && tab === 'loose-ends' && (
            <LooseEndsQueue
              data={data.yesterdayLooseEnds}
              filter={looseEndFilter}
              canOperateDrawer={canOperateDrawer}
            />
          )}
          {!review.isLoading && !review.isError && data && tab === 'duplicates' && (
            <PotentialDuplicatesQueue rows={data.potentialDuplicates.rows} />
          )}
          {!review.isLoading && !review.isError && data && tab === 'external-immunizations' && (
            <ExternalImmunizationsQueue rows={data.externalImmunizations.rows} />
          )}

          {isAdmin && (
            <section className="pt-2">
              <h2 className="text-sm font-semibold mb-3">Linked review surfaces</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Card>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                      <ClipboardCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Approvals</p>
                      <p className="text-xs text-muted-foreground">
                        Sensitive corrections keep their existing review and audit workflow.
                      </p>
                      <Button asChild variant="link" className="h-auto p-0 mt-1 text-xs">
                        <Link to="/admin/approvals">Open Approvals</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                      <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Cross-branch access</p>
                      <p className="text-xs text-muted-foreground">
                        Review break-glass access in its dedicated compliance surface.
                      </p>
                      <Button asChild variant="link" className="h-auto p-0 mt-1 text-xs">
                        <Link to="/admin/cross-branch-access">Open access review</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>
          )}
        </div>
      </div>

      <GuardianReviewSheet row={selectedGuardian} onClose={() => setSelectedGuardian(null)} />
    </div>
  )
}
