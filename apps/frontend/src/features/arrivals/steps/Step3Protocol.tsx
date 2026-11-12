import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AlertCircle, ChevronRight, Lock, Workflow } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/toast'
import { ListEmpty } from '@/components/layout'
import { cn } from '@/lib/utils'
import {
  useStandingOrderTemplates,
  useStandingOrderTemplatesWithItems,
  type StandingOrderTemplate,
  type StandingOrderTemplateItem,
} from '@/features/standing-orders/api'
import AuthorizingProviderSelect from '@/features/branch/components/AuthorizingProviderSelect'
import { useArrivalPreviewBundle, type PreviewBundleItem, useArrivalAtomicCommit } from '../api'
import { useArrival, useWizardGuardTarget } from '../context'
import { formatMoney } from '@/lib/format'
import { useAdvanceShortcut } from '../use-advance-shortcut'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

export default function Step3Protocol() {
  const navigate = useNavigate()
  const { selectedPatientId, encounterDraft, standingOrderId, setStandingOrderId, setEncounterId } =
    useArrival()
  // Multi-select: Cat III needs the ARV course PLUS adjuncts (ERIG/HRIG, ATS)
  // committed together — one PSO each, single transaction.
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([])
  const [physicianId, setPhysicianId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Guard: redirect to the earliest unlocked step if deep-linked. Computed
  // up-front; the conditional return runs AFTER every hook below so the
  // rules-of-hooks ordering stays stable across renders.
  const guardTarget = useWizardGuardTarget(3)

  const {
    data: templates,
    isLoading: templatesLoading,
    isError,
  } = useStandingOrderTemplates(encounterDraft?.specialty)
  // Items (day offsets) for the schedule preview — one list fetch, no N+1.
  const { data: templatesWithItems } = useStandingOrderTemplatesWithItems()

  // WHO exposure category from Step 2 bite assessment drives triage display + server field.
  const triageCategory =
    encounterDraft?.specialty === 'Rabies'
      ? (encounterDraft.biteAssessment?.whoCategory as string | undefined)
      : undefined

  const { data: previewBundle, isLoading: bundleLoading } = useArrivalPreviewBundle(
    selectedTemplateIds,
    triageCategory,
  )

  const atomicCommit = useArrivalAtomicCommit()

  // The picker list is the source of truth for code/auth checks (always loaded
  // by this step); the with-items list adds day-offsets for the preview.
  const selectedTemplates = useMemo(
    () => (templates ?? []).filter((t) => selectedTemplateIds.includes(t.id)),
    [templates, selectedTemplateIds],
  )
  const selectedItems = useMemo(
    () =>
      (templatesWithItems ?? [])
        .filter((t) => selectedTemplateIds.includes(t.id))
        .flatMap((t) => t.items),
    [templatesWithItems, selectedTemplateIds],
  )

  function toggleTemplate(id: string) {
    setSelectedTemplateIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function submit() {
    if (
      !selectedPatientId ||
      !encounterDraft ||
      !encounterDraft.consentObtained ||
      !encounterDraft.consentBy ||
      selectedTemplateIds.length === 0
    ) {
      return
    }
    setSubmitting(true)
    try {
      const result = await atomicCommit.mutateAsync({
        patientId: selectedPatientId,
        templateIds: selectedTemplateIds,
        authorizingProviderId: physicianId ?? undefined,
        specialty: encounterDraft.specialty,
        consentObtained: true,
        consentBy: encounterDraft.consentBy,
        chiefComplaint: encounterDraft.chiefComplaint,
        triageCategory: triageCategory ?? undefined,
        specialtyData: encounterDraft.biteAssessment
          ? { biteAssessment: encounterDraft.biteAssessment }
          : undefined,
        clinicalNotes: encounterDraft.vitals ? { vitals: encounterDraft.vitals } : undefined,
      })

      setEncounterId(result.encounterId)
      setStandingOrderId(result.patientStandingOrderId)
      toast(selectedTemplates.length > 1 ? 'Protocols started' : 'Protocol started', {
        description: selectedTemplates.map((t) => t.name).join(' · ') || 'Standing order',
      })
      // Carry a chain order id so the Done step can open Collect payment for the
      // Day-0 doses (getPrepayableDoses resolves the whole chain from any ORD id).
      const day0OrderId = result.scheduledOrderIds[0]
      navigate(
        `/arrivals/done?patientId=${selectedPatientId}&encounterId=${result.encounterId}&standingOrderId=${result.patientStandingOrderId}` +
          (day0OrderId ? `&day0OrderId=${encodeURIComponent(day0OrderId)}` : ''),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.'
      toast.error('Failed to start protocol', { description: message })
    } finally {
      setSubmitting(false)
    }
  }

  useAdvanceShortcut(() => {
    if (selectedTemplateIds.length > 0) void submit()
  })

  // Defer the deep-link redirect until after every hook so React sees the same
  // hook order on every render.
  if (guardTarget) return <Navigate replace to={guardTarget} />

  // CLIN-4 — WHO Category III requires RIG (ERIG or HRIG) on Day 0. The
  // selection satisfies this when ANY selected template's code contains
  // 'ERIG' or 'HRIG' — a dedicated RIG standing order OR a composite Cat III
  // bundle (RABIES_CAT3_ID_ERIG / _HRIG). An ARV-only / ATS-only selection
  // stays blocked for Cat III.
  const isRigTemplate = (code: string | undefined) =>
    code !== undefined && /(ERIG|HRIG)/i.test(code)
  const catIII = triageCategory === 'III'
  // Warn once a selection exists but none of it administers RIG.
  const rigMissing =
    catIII && selectedTemplates.length > 0 && !selectedTemplates.some((t) => isRigTemplate(t.code))

  const requiresPhysicianAuth = selectedTemplates.some((t) => t.requiresPhysicianAuth)

  const canSubmit =
    selectedTemplateIds.length > 0 &&
    !submitting &&
    !(requiresPhysicianAuth && !physicianId) &&
    // CLIN-4: block commit when no RIG protocol is selected for Cat III.
    !rigMissing

  return (
    <div className="h-full flex flex-col lg:flex-row min-h-0">
      {/* Left — protocol selection */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="px-4 sm:px-6 xl:px-8 2xl:px-10 pt-5 pb-3 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                Protocol &amp; bundle selection
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                {triageCategory
                  ? `Triage ${triageCategory} → protocol indicated. Pick the course; the brand is chosen when each dose is administered.`
                  : 'Pick the course; the brand is chosen when each dose is administered.'}
              </p>
            </div>
            {triageCategory && (
              <Badge variant="overdue" className="gap-1 shrink-0">
                <AlertCircle className="h-3 w-3" aria-hidden />
                <span className="font-mono text-2xs">{triageCategory} EXPOSURE</span>
              </Badge>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 space-y-4">
          {/* CLIN-4 — Cat III standing reminder before the picker */}
          {catIII && (
            <Alert variant="destructive" className="py-2.5">
              <AlertCircle className="h-4 w-4" aria-hidden />
              <AlertTitle className="text-sm">Category III — RIG required</AlertTitle>
              <AlertDescription className="text-xs">
                WHO Category III exposures require Rabies Immunoglobulin (RIG) on Day 0 in addition
                to the vaccine series. Select the vaccine course <strong>plus</strong> an{' '}
                <strong>ERIG / HRIG</strong> adjunct (and ATS when indicated) — they commit together
                — or pick a composite <strong>Cat III bundle</strong>.
              </AlertDescription>
            </Alert>
          )}

          <ProtocolPickerCard
            templates={templates ?? []}
            isLoading={templatesLoading}
            isError={isError}
            selectedIds={selectedTemplateIds}
            onToggle={toggleTemplate}
          />

          {/* CLIN-4 — warn when the Cat III selection has no RIG in it */}
          {rigMissing && (
            <Alert variant="destructive" className="py-2.5">
              <AlertCircle className="h-4 w-4" aria-hidden />
              <AlertTitle className="text-sm">RIG not included in selection</AlertTitle>
              <AlertDescription className="text-xs">
                Nothing selected administers RIG. For Category III patients, add an{' '}
                <strong>ERIG</strong> or <strong>HRIG</strong> standing order to the selection.
                Committing without RIG is blocked for patient safety.
              </AlertDescription>
            </Alert>
          )}

          <SchedulePreviewCard items={selectedItems} />

          <BundleCard
            bundleItems={previewBundle?.items ?? []}
            bundleTotal={previewBundle?.total ?? null}
            isLoading={bundleLoading && selectedTemplateIds.length > 0}
          />

          {requiresPhysicianAuth && (
            <div className="rounded-md border border-border p-3">
              <label htmlFor="physician-id" className="eyebrow">
                Physician on duty <span className="text-destructive">*</span>
              </label>
              <div className="mt-2 max-w-md">
                <AuthorizingProviderSelect
                  id="physician-id"
                  value={physicianId}
                  onChange={setPhysicianId}
                  required
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right rail — atomic-commit summary */}
      <CommitRail
        selectedTemplates={selectedTemplates}
        doseCount={selectedItems.length}
        triageCategory={triageCategory ?? null}
        bundleItems={previewBundle?.items ?? []}
        bundleTotal={previewBundle?.total ?? null}
        canSubmit={canSubmit}
        submitting={submitting}
        alreadyScheduled={!!standingOrderId}
        onBack={() => navigate(`/arrivals/encounter?patientId=${selectedPatientId}`)}
        onContinue={submit}
      />
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────────
// Protocol picker — multi-select, grouped so vaccine courses lead and the
// RIG/serum adjuncts (ATS / ERIG / HRIG) follow. The pre-grouped list sorted
// alphabetically by code, which floated the three adjuncts to the top and the
// tester never found the PEP courses below them (nurse-test §2.6).

const ADJUNCT_CODES = /^(ATS|ERIG|HRIG)$/i

function ProtocolPickerCard({
  templates,
  isLoading,
  isError,
  selectedIds,
  onToggle,
}: {
  templates: StandingOrderTemplate[]
  isLoading: boolean
  isError: boolean
  selectedIds: string[]
  onToggle: (id: string) => void
}) {
  const courses = templates.filter((t) => !ADJUNCT_CODES.test(t.code))
  const adjuncts = templates.filter((t) => ADJUNCT_CODES.test(t.code))

  return (
    <section className="rounded-md border border-border bg-card">
      <header className="px-4 pt-3 pb-2">
        <span className="eyebrow">Protocol</span>
        <h3 className="text-sm font-semibold mt-0.5">Course selection</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Select every protocol to start — e.g. a vaccine course plus ERIG and ATS for a Category
          III bite. All selections commit together.
        </p>
      </header>
      <div className="px-4 pb-4 space-y-2">
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}

        {isError && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4" aria-hidden />
            Failed to load standing-order templates.
          </div>
        )}

        {!isLoading && !isError && templates.length === 0 && (
          <ListEmpty
            icon={Workflow}
            message="No standing-order templates configured."
            className="px-0 py-8"
          />
        )}

        {courses.length > 0 && (
          <>
            <p className="eyebrow pt-1">Vaccine courses</p>
            {courses.map((t) => (
              <ProtocolCheckCard
                key={t.id}
                template={t}
                selected={selectedIds.includes(t.id)}
                onToggle={() => onToggle(t.id)}
              />
            ))}
          </>
        )}

        {adjuncts.length > 0 && (
          <>
            <p className="eyebrow pt-2">Immunoglobulins &amp; serums (add alongside a course)</p>
            {adjuncts.map((t) => (
              <ProtocolCheckCard
                key={t.id}
                template={t}
                selected={selectedIds.includes(t.id)}
                onToggle={() => onToggle(t.id)}
              />
            ))}
          </>
        )}
      </div>
    </section>
  )
}

function ProtocolCheckCard({
  template,
  selected,
  onToggle,
}: {
  template: StandingOrderTemplate
  selected: boolean
  onToggle: () => void
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors',
        selected ? 'border-primary bg-primary/5' : 'hover:bg-accent',
      )}
    >
      <input
        type="checkbox"
        name="protocol"
        className="sr-only"
        checked={selected}
        onChange={onToggle}
      />
      <span
        aria-hidden
        className={cn(
          'mt-0.5 h-3.5 w-3.5 rounded-sm border-2 shrink-0',
          selected
            ? 'border-primary bg-primary shadow-[inset_0_0_0_2px_hsl(var(--background))]'
            : 'border-muted-foreground/30',
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{template.name}</span>
          <Badge variant="outline" className="font-mono text-2xs">
            {template.code}
          </Badge>
          {template.requiresPhysicianAuth && (
            <Badge variant="due" className="text-2xs">
              Physician auth
            </Badge>
          )}
        </div>
        {template.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{template.description}</p>
        )}
      </div>
      {selected && (
        <Badge variant="ok" className="shrink-0 text-2xs">
          Selected
        </Badge>
      )}
    </label>
  )
}

// ───────────────────────────────────────────────────────────────────────────────
// Schedule preview — derived from selected template's day offsets

function SchedulePreviewCard({ items }: { items: StandingOrderTemplateItem[] }) {
  const days = useMemo(() => {
    const offsets = Array.from(new Set(items.map((i) => i.dayOffset))).sort((a, b) => a - b)
    const today = new Date()
    return offsets.map((offset) => {
      const date = new Date(today)
      date.setDate(today.getDate() + offset)
      const dateLabel = date.toLocaleDateString('en-PH', { month: 'short', day: '2-digit' })
      const offsetLabel = offset === 0 ? 'today' : offset > 0 ? `+${offset}d` : `${offset}d`
      return { offset, dateLabel, offsetLabel }
    })
  }, [items])

  return (
    <section className="rounded-md border border-border bg-card">
      <header className="px-4 pt-3 pb-2">
        <span className="eyebrow">Generated schedule</span>
        <h3 className="text-sm font-semibold mt-0.5">
          {days.length > 0
            ? `${days.length} doses across ${days[days.length - 1]!.offset} days · Day 0 today`
            : 'Pick a protocol to preview the schedule'}
        </h3>
        {days.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            Auto-recompute kicks in if any dose is administered late.
          </p>
        )}
      </header>
      {days.length > 0 && (
        <div className="px-4 pb-4">
          <div className="flex gap-2 overflow-x-auto">
            {days.map((d) => (
              <div
                key={d.offset}
                className={cn(
                  'flex-1 min-w-[6.875rem] rounded-md border px-3 py-2.5',
                  d.offset === 0 && 'border-primary bg-primary/5',
                )}
              >
                <div className="eyebrow">Day {d.offset}</div>
                <div className="font-mono tabular-nums text-sm font-semibold mt-0.5">
                  {d.dateLabel}
                </div>
                <div className="font-mono text-2xs text-muted-foreground">{d.offsetLabel}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

// ───────────────────────────────────────────────────────────────────────────────
// Bundle card — Day-0 items with an indicative lot + price from /api/arrivals/preview-bundle

function fmtPHP(amount: string | number): string {
  return formatMoney(amount)
}

function BundleCard({
  bundleItems,
  bundleTotal,
  isLoading,
}: {
  bundleItems: PreviewBundleItem[]
  bundleTotal: string | null
  isLoading: boolean
}) {
  return (
    <section className="rounded-md border border-border bg-card">
      <header className="px-4 pt-3 pb-2 flex items-start justify-between gap-3">
        <div>
          <span className="eyebrow">Bundle · lots &amp; quantities</span>
          <h3 className="text-sm font-semibold mt-0.5">Stock check · Day 0</h3>
        </div>
        <Button variant="ghost" size="sm" className="text-xs gap-1">
          Override
          <ChevronRight className="h-3 w-3" aria-hidden />
        </Button>
      </header>
      {isLoading ? (
        <div className="px-4 pb-4 space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : bundleItems.length === 0 ? (
        <p className="text-sm text-muted-foreground px-4 pb-4">
          No Day-0 items — select a protocol to preview the bundle.
        </p>
      ) : (
        <Table className="w-full text-sm">
          <TableHeader className="bg-muted/30 text-2xs uppercase tracking-wide text-muted-foreground">
            <TableRow>
              <TableHead className="text-left font-semibold px-4">Item</TableHead>
              <TableHead className="text-left font-semibold px-3">Lot · expiry</TableHead>
              <TableHead className="text-left font-semibold px-3">Dose</TableHead>
              <TableHead className="text-left font-semibold px-3">Qty</TableHead>
              <TableHead className="text-left font-semibold px-3">Unit ₱</TableHead>
              <TableHead className="text-right font-semibold px-4">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bundleItems.map((item, idx) => (
              <TableRow
                key={`${item.service.id}-${idx}`}
                data-severity="info"
                className="stripe border-t border-border"
              >
                <TableCell className="px-4">
                  <div className="font-medium">{item.service.name}</div>
                  <div className="text-2xs text-muted-foreground font-mono">
                    {item.service.sku ?? item.service.id}
                  </div>
                </TableCell>
                <TableCell className="px-3">
                  {item.lot ? (
                    <span>
                      <span className="font-mono tabular-nums">{item.lot.batchNumber}</span>
                      {item.expiryDate && (
                        <span className="text-muted-foreground font-mono text-2xs">
                          {' '}
                          · {item.expiryDate}
                        </span>
                      )}
                      <Badge variant="due" className="ml-1.5 text-2xs">
                        FEFO
                      </Badge>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="px-3">
                  <span className="font-mono tabular-nums">{item.doseSize ?? '—'}</span>
                </TableCell>
                <TableCell className="px-3">
                  <span className="font-mono tabular-nums">
                    {parseFloat(item.qty)} unit{parseFloat(item.qty) === 1 ? '' : 's'}
                  </span>
                </TableCell>
                <TableCell className="px-3">
                  <span className="font-mono tabular-nums">{fmtPHP(item.unitPrice)}</span>
                </TableCell>
                <TableCell className="px-4 text-right">
                  <span className="font-mono tabular-nums">{fmtPHP(item.subtotal)}</span>
                </TableCell>
              </TableRow>
            ))}
            {bundleTotal !== null && (
              <TableRow>
                <TableCell colSpan={5} className="px-4 text-right border-t-2 border-border">
                  <strong className="text-sm">Bundle total</strong>
                </TableCell>
                <TableCell className="px-4 text-right border-t-2 border-border">
                  <span className="font-mono tabular-nums text-base font-semibold">
                    {fmtPHP(bundleTotal)}
                  </span>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

// ───────────────────────────────────────────────────────────────────────────────
// Right rail — atomic-commit summary + back/continue (PATTERNS.md §3)

function CommitRail({
  selectedTemplates,
  doseCount,
  triageCategory,
  bundleItems,
  bundleTotal,
  canSubmit,
  submitting,
  alreadyScheduled,
  onBack,
  onContinue,
}: {
  selectedTemplates: { name: string }[]
  doseCount: number
  triageCategory: string | null
  bundleItems: PreviewBundleItem[]
  bundleTotal: string | null
  canSubmit: boolean
  submitting: boolean
  alreadyScheduled: boolean
  onBack: () => void
  onContinue: () => void
}) {
  const namesLine = selectedTemplates.map((t) => t.name).join(' · ')
  const lotsLine =
    bundleItems.length > 0
      ? bundleItems
          .filter((i) => i.lot)
          .map((i) => `${i.service.name} ${i.lot!.batchNumber} ×${parseFloat(i.qty)}`)
          .join(' · ') || 'No lots in stock'
      : 'Select a protocol'

  const commitEffects: { title: string; sub: string; sev: 'info' | 'due' | 'overdue' }[] = [
    {
      title: 'Encounter created',
      sub: triageCategory ? `Day 0 · ${triageCategory}` : 'Day 0',
      sev: 'info',
    },
    {
      title: selectedTemplates.length > 1 ? 'Protocols started' : 'Protocol started',
      sub:
        selectedTemplates.length > 0
          ? `${namesLine}${doseCount > 0 ? ` · ${doseCount} dose${doseCount === 1 ? '' : 's'}` : ''}`
          : 'Standing order(s) from selected templates',
      sev: 'info',
    },
    {
      title: 'Stock checked for Day 0',
      sub: lotsLine,
      sev: 'due',
    },
    {
      title: 'Day-0 charge',
      sub: bundleTotal
        ? `≈${fmtPHP(bundleTotal)} · collect at billing`
        : 'No items priced — protocol bundle empty',
      sev: 'due',
    },
  ]

  return (
    <aside className="lg:w-[20rem] xl:w-[23.75rem] lg:border-l lg:border-t-0 border-t border-border flex flex-col bg-card">
      {/* Atomic-commit block per PATTERNS.md §3 */}
      <Card className="flex-1 flex flex-col border-0 rounded-none shadow-none">
        <CardHeader className="px-5 pt-5 pb-3">
          <span className="eyebrow">On commit</span>
          <CardTitle className="text-sm font-semibold mt-0.5">What happens on commit</CardTitle>
          <CardDescription className="text-xs">
            Encounter, protocol &amp; lots commit atomically; the Day-0 charge is collected at
            billing.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto px-5 pb-3">
          <ol className="border border-border rounded-md divide-y divide-border">
            {commitEffects.map((e, i) => (
              <li key={e.title} className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono tabular-nums text-2xs font-semibold text-muted-foreground">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-xs font-medium flex-1">{e.title}</span>
                  <span className="dot" data-severity={e.sev} />
                </div>
                <p className="text-2xs text-muted-foreground ml-6 mt-0.5">{e.sub}</p>
              </li>
            ))}
          </ol>

          <Separator className="my-3" />

          {/* KV summary rows */}
          <div className="space-y-1.5">
            <dl>
              {bundleTotal && (
                <div className="flex items-baseline gap-2 py-1">
                  <dt className="text-2xs text-muted-foreground w-28 shrink-0">Day 0 estimate</dt>
                  <dd className="font-mono tabular-nums text-xs font-semibold">
                    {fmtPHP(bundleTotal)}
                  </dd>
                </div>
              )}
              {selectedTemplates.length > 0 && (
                <div className="flex items-baseline gap-2 py-1">
                  <dt className="text-2xs text-muted-foreground w-28 shrink-0">
                    {selectedTemplates.length > 1 ? 'Protocols' : 'Protocol'}
                  </dt>
                  <dd className="text-xs font-mono truncate">{namesLine}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* B30: only ARV protocols (ARV-PEP / ARV-Booster) gate Day-0
              administer on payment commit. Other specialties (Flu, routine
              vaccinations, etc.) administer without the payment gate. */}
          {selectedTemplates.some((t) => /ARV/i.test(t.name)) && (
            <>
              <Separator className="my-3" />
              <Alert variant="destructive">
                <Lock className="h-4 w-4" aria-hidden />
                <AlertTitle>Day-0 ARV blocked until payment commits.</AlertTitle>
                <AlertDescription>
                  Cashier settles draft → Administer button unlocks automatically.
                </AlertDescription>
              </Alert>
            </>
          )}
        </CardContent>

        <CardFooter className="px-5 py-3 border-t border-border flex-col gap-2">
          <div className="flex items-center gap-2 w-full">
            <Button
              variant="outline"
              size="sm"
              onClick={onBack}
              disabled={submitting}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={onContinue}
              disabled={!canSubmit}
              className="flex-[1.5] gap-1"
            >
              {submitting ? 'Scheduling…' : 'Commit bundle'}
              <ChevronRight className="h-3 w-3" aria-hidden />
            </Button>
          </div>
          <p className="text-2xs text-muted-foreground text-center">
            <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono text-2xs">
              ⌘↵
            </kbd>{' '}
            to commit
            {alreadyScheduled && ' · submit again to replace'}
          </p>
        </CardFooter>
      </Card>
    </aside>
  )
}
