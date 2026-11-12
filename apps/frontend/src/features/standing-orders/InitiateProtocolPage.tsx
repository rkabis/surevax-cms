import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { PageHeader, TableCard } from '@/components/layout'
import { PhysicianPicker } from '@/components/forms'
import PatientPicker from '@/components/forms/PatientPicker'
import { useAuth } from '@/features/auth/context'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import {
  useStartStandingOrder,
  useStandingOrderTemplatesWithItems,
  type StandingOrderTemplateWithItems,
} from './api'
import { clinicCalendarDateString } from '@/lib/clinicDate'

// ── helpers ──────────────────────────────────────────────────────────────────

function addDays(iso: string, n: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── kv row ───────────────────────────────────────────────────────────────────

function KvRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-border/50 last:border-0">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-sm text-right">{value}</dd>
    </div>
  )
}

// ── dose strip row ────────────────────────────────────────────────────────────

function DoseRow({
  day,
  date,
  items,
  isToday,
}: {
  day: string
  date: string
  items: string
  isToday: boolean
}) {
  return (
    <div
      className={[
        'flex items-start gap-3 rounded-md px-3 py-3 border',
        isToday
          ? 'border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/30'
          : 'border-border bg-transparent',
      ].join(' ')}
    >
      <span className="font-mono font-semibold text-sm w-10 shrink-0 tabular-nums pt-0.5">
        {day}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{date}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{items}</p>
      </div>
      {isToday ? (
        <Badge variant="info" className="shrink-0 mt-0.5">
          today
        </Badge>
      ) : (
        <Badge variant="outline" className="shrink-0 mt-0.5 text-xs">
          scheduled
        </Badge>
      )}
    </div>
  )
}

// ── step indicator ────────────────────────────────────────────────────────────

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div
      className={[
        'h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors',
        done
          ? 'border-primary bg-primary text-primary-foreground'
          : active
            ? 'border-primary bg-background text-primary'
            : 'border-border bg-background text-muted-foreground',
      ].join(' ')}
    >
      {done ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : n}
    </div>
  )
}

// ── template picker card ──────────────────────────────────────────────────────

function TemplatePicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (t: StandingOrderTemplateWithItems) => void
}) {
  const [filterCat, setFilterCat] = useState<string>('all')
  const { data, isLoading, isError } = useStandingOrderTemplatesWithItems()

  const categories = useMemo(() => {
    if (!data) return []
    const cats = Array.from(new Set(data.map((t) => t.name.split(' ')[0])))
    return cats
  }, [data])

  const visible = useMemo(() => {
    if (!data) return []
    if (filterCat === 'all') return data
    return data.filter((t) => t.name.startsWith(filterCat))
  }, [data, filterCat])

  if (isLoading)
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )

  if (isError)
    return (
      <div className="flex items-center gap-2 text-destructive text-sm">
        <AlertCircle className="h-4 w-4" aria-hidden />
        Failed to load templates.
      </div>
    )

  if (!data || data.length === 0)
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No active standing-order templates available.
      </p>
    )

  return (
    <div className="space-y-3">
      {/* Category tabs */}
      <Tabs value={filterCat} onValueChange={setFilterCat}>
        <TabsList className="h-8 flex-wrap">
          {(['all', ...categories] as string[]).map((c) => (
            <TabsTrigger key={c} value={c} className="text-xs h-7 px-2.5 capitalize">
              {c}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Template rows — sticky header */}
      <TableCard>
        <Table className="w-full text-sm">
          <TableHeader className="sticky top-0 bg-card z-10 shadow-[0_1px_0_0_hsl(var(--border))] text-xs text-muted-foreground">
            <TableRow>
              <TableHead className="text-left font-medium px-4 w-36">Code</TableHead>
              <TableHead className="text-left font-medium px-4">Template</TableHead>
              <TableHead className="text-left font-medium px-4">Schedule</TableHead>
              <TableHead className="text-left font-medium px-4 w-16">Items</TableHead>
              <TableHead className="text-left font-medium px-4 w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((t) => {
              const isSelected = t.id === selectedId
              // Derive unique day-offsets for schedule display
              const dayOffsets = Array.from(new Set(t.items.map((i) => i.dayOffset))).sort(
                (a, b) => a - b,
              )
              const schedule = dayOffsets
                .map((d) => (d < 30 ? `D${d}` : `M${Math.round(d / 30)}`))
                .join(' · ')

              return (
                <TableRow
                  interactive
                  key={t.id}
                  onClick={() => onSelect(t)}
                  className={[
                    'border-t cursor-pointer transition-colors',
                    isSelected
                      ? 'bg-primary/5 ring-1 ring-inset ring-primary'
                      : 'hover:bg-accent/50',
                  ].join(' ')}
                >
                  <TableCell className="px-4 font-mono text-xs text-muted-foreground">
                    {t.code}
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-sm">{t.name}</span>
                      {t.description && (
                        <span className="text-xs text-muted-foreground line-clamp-1">
                          {t.description}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 font-mono text-xs tabular-nums">
                    {schedule || '—'}
                  </TableCell>
                  <TableCell className="px-4 font-mono tabular-nums text-sm">
                    {t.items.length}
                  </TableCell>
                  <TableCell className="px-4">
                    {isSelected ? (
                      <Badge variant="ok" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" aria-hidden />
                        Selected
                      </Badge>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => onSelect(t)}>
                        Select
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function InitiateProtocolPage() {
  const { user } = useAuth()
  const requiresAuthorizer = user?.role === 'Nurse' || user?.role === 'Branch'

  // Preselect the patient when reached from a patient chart
  // (/initiate-protocol?patientId=PAT_…).
  const [searchParams] = useSearchParams()
  const [patientId, setPatientId] = useState<string | null>(
    () => searchParams.get('patientId') || null,
  )
  const [selected, setSelected] = useState<StandingOrderTemplateWithItems | null>(null)
  const [physicianId, setPhysicianId] = useState<string | null>(null)
  const [startDate, setStartDate] = useState<string>(clinicCalendarDateString())

  const startMutation = useStartStandingOrder()

  const physicianValid = !requiresAuthorizer || (physicianId !== null && physicianId.length > 0)

  // Wizard step: 1 = pick template, 2 = doses + auth, 3 = confirm
  const step = selected ? (physicianValid || !requiresAuthorizer ? 3 : 2) : 1

  // Group items by day-offset for the dose strip
  const doseGroups = useMemo(() => {
    if (!selected) return []
    const map = new Map<number, typeof selected.items>()
    for (const item of selected.items) {
      const arr = map.get(item.dayOffset) ?? []
      arr.push(item)
      map.set(item.dayOffset, arr)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([dayOffset, items]) => ({
        dayOffset,
        label: dayOffset < 30 ? `D${dayOffset}` : `M${Math.round(dayOffset / 30)}`,
        items,
      }))
  }, [selected])

  async function handleCommit() {
    if (!selected || !patientId) return
    try {
      await startMutation.mutateAsync({
        patientId,
        // No encounterId — chart-initiated protocols (boosters, PrEP) have no
        // open visit; the backend accepts the omission.
        templateId: selected.id,
        authorizingProviderId: physicianId ?? undefined,
        startDate,
      })
      toast.success('Protocol initiated', { description: selected.name })
      handleReset()
    } catch (err) {
      toast.error('Failed to initiate protocol', {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  function handleReset() {
    setSelected(null)
    setPhysicianId(null)
    setStartDate(clinicCalendarDateString())
    startMutation.reset()
  }

  const orderCount = selected?.items.length ?? 0
  const canCommit =
    selected !== null && patientId !== null && physicianValid && !startMutation.isPending

  return (
    <div className="h-full flex flex-col">
      {/* Page head */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Initiate Protocol"
          description="Select a standing-order template, preview the dose schedule, then commit."
          actions={
            selected ? (
              <Button variant="outline" size="sm" onClick={handleReset}>
                Cancel
              </Button>
            ) : undefined
          }
        />
      </div>

      {/* Sticky step rail + selected-template chip */}
      <div className="sticky top-0 z-20 bg-background border-b border-border px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 flex flex-col gap-2">
        {/* Step rail */}
        <div className="flex items-center gap-2">
          {[
            { n: 1, label: 'Choose template' },
            { n: 2, label: 'Dose schedule' },
            { n: 3, label: 'Confirm & commit' },
          ].map(({ n, label }, idx) => (
            <div key={n} className="flex items-center gap-2">
              {idx > 0 && (
                <div
                  className={[
                    'h-px w-8 transition-colors',
                    step > idx ? 'bg-primary' : 'bg-border',
                  ].join(' ')}
                />
              )}
              <div className="flex items-center gap-1.5">
                <StepDot n={n} active={step === n} done={step > n} />
                <span
                  className={[
                    'text-xs font-medium',
                    step === n ? 'text-foreground' : 'text-muted-foreground',
                  ].join(' ')}
                >
                  {label}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Selected-template chip (only once template is chosen) */}
        {selected && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Selected:</span>
            <span className="font-mono text-xs text-muted-foreground">{selected.code}</span>
            <span className="text-xs font-medium">{selected.name}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleReset}
            >
              <X className="h-3 w-3 mr-1" aria-hidden />
              Change
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 space-y-4 max-w-5xl xl:max-w-7xl">
          {/* Patient — required before commit; prefilled when navigated from a chart */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">
              Patient <span className="text-destructive">*</span>
            </h2>
            <div className="max-w-md">
              <PatientPicker value={patientId} onChange={setPatientId} required />
            </div>
          </section>

          <Separator />

          {/* Step 1 — choose template */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <StepDot n={1} active={step === 1} done={step > 1} />
              Choose template
            </h2>
            <TemplatePicker selectedId={selected?.id ?? null} onSelect={setSelected} />
          </section>

          {/* Steps 2 + 3 — only visible once a template is selected */}
          {selected && (
            <>
              <Separator />

              {/* Step 2 — dose schedule + authorization */}
              <section className="space-y-4">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <StepDot n={2} active={step === 2} done={step > 2} />
                  Dose schedule
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Dose strip */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Schedule preview</CardTitle>
                      <CardDescription className="text-xs">
                        {selected.name} · starts {startDate}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {doseGroups.map(({ dayOffset, label, items }, idx) => {
                        const itemNames = items.map((i) => i.serviceName).join(', ')
                        const dateStr = addDays(startDate, dayOffset)
                        return (
                          <DoseRow
                            key={dayOffset}
                            day={label}
                            date={dateStr}
                            items={itemNames}
                            isToday={idx === 0}
                          />
                        )
                      })}
                    </CardContent>
                  </Card>

                  {/* Authorization */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Authorization</CardTitle>
                      <CardDescription className="text-xs">
                        Start date and physician approval
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="start-date">Start date</Label>
                        <Input
                          id="start-date"
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Day-offsets are computed from this date.
                        </p>
                      </div>

                      {requiresAuthorizer ? (
                        <div className="space-y-1.5">
                          <Label htmlFor="physician">
                            Authorizing physician <span className="text-destructive">*</span>
                          </Label>
                          <PhysicianPicker value={physicianId} onChange={setPhysicianId} required />
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          You are listed as the authorizing provider for this protocol.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </section>

              <Separator />

              {/* Step 3 — atomic commit summary */}
              <section className="space-y-4">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <StepDot n={3} active={step === 3} done={false} />
                  Confirm &amp; commit
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Atomic commit block */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">On commit · single transaction</CardTitle>
                      <CardDescription className="text-xs">
                        All writes are atomic — they succeed or fail together.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <dl className="space-y-0">
                        <KvRow
                          label="Standing order"
                          value={
                            <span className="text-xs text-muted-foreground">
                              ID generated on commit
                            </span>
                          }
                        />
                        <KvRow
                          label="Clinical orders"
                          value={
                            <span className="font-mono tabular-nums">
                              {doseGroups.length} (one per visit day)
                            </span>
                          }
                        />
                        <KvRow
                          label="Total line items"
                          value={
                            <span className="font-mono tabular-nums">{selected.items.length}</span>
                          }
                        />
                        <KvRow
                          label="Inventory holds"
                          value={
                            <span className="font-mono tabular-nums text-muted-foreground">
                              Stock checked at commit
                            </span>
                          }
                        />
                        <KvRow
                          label="Day-0 transaction"
                          value={
                            <Badge variant="outline" className="text-xs">
                              Drafted on commit
                            </Badge>
                          }
                        />
                        <KvRow
                          label="Reminders"
                          value={
                            <span className="text-xs text-muted-foreground">
                              SMS −1d, −2h per visit
                            </span>
                          }
                        />
                      </dl>
                    </CardContent>
                  </Card>

                  {/* Selected template summary */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Template summary</CardTitle>
                      <CardDescription className="font-mono text-xs">
                        {selected.code}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <dl className="space-y-0">
                        <KvRow label="Name" value={selected.name} />
                        <KvRow
                          label="Version"
                          value={
                            <span className="font-mono tabular-nums text-xs">
                              v{selected.version}
                            </span>
                          }
                        />
                        <KvRow
                          label="Physician auth"
                          value={
                            <Badge variant={selected.requiresPhysicianAuth ? 'due' : 'outline'}>
                              {selected.requiresPhysicianAuth ? 'Required' : 'Not required'}
                            </Badge>
                          }
                        />
                        <KvRow
                          label="Start date"
                          value={
                            <span className="font-mono tabular-nums text-xs">{startDate}</span>
                          }
                        />
                        <KvRow
                          label="Schedule"
                          value={
                            <span className="font-mono tabular-nums text-xs">
                              {doseGroups.map((g) => g.label).join(' · ')}
                            </span>
                          }
                        />
                      </dl>
                    </CardContent>
                  </Card>
                </div>

                {/* Stock check notice */}
                <div className="flex items-start gap-2.5 rounded-md border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20 p-3">
                  <CheckCircle2
                    className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5"
                    aria-hidden
                  />
                  <p className="text-xs text-green-900 dark:text-green-300">
                    <strong>Stock check is performed at commit time</strong> — if the branch cannot
                    cover the Day-0 items the whole transaction rolls back. The nurse picks the
                    brand for each dose when administering it.
                  </p>
                </div>

                {startMutation.isError && (
                  <div className="flex items-start gap-2 text-destructive text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                    {startMutation.error?.message ?? 'Failed to initiate protocol.'}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </ScrollArea>

      {/* Sticky primary action footer — always visible */}
      <footer className="border-t border-border bg-card px-6 py-3 flex items-center justify-between gap-4">
        <div className="text-xs text-muted-foreground">
          {selected ? (
            <span>
              <span className="font-mono tabular-nums font-semibold">{orderCount}</span>{' '}
              {orderCount === 1 ? 'order' : 'orders'} · {selected.code}
            </span>
          ) : (
            <span>No template selected</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selected && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              Start over
            </Button>
          )}
          <Button onClick={handleCommit} disabled={!canCommit} className="min-w-[10rem]">
            {startMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
                Committing…
              </>
            ) : (
              `Attach protocol${selected ? ` (${orderCount} ${orderCount === 1 ? 'order' : 'orders'})` : ''}`
            )}
          </Button>
        </div>
      </footer>
    </div>
  )
}
