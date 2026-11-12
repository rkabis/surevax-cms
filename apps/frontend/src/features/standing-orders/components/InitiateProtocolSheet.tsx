import { useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DetailSheet, TableCard } from '@/components/layout'
import { useAuth } from '@/features/auth/context'
import { useStartStandingOrder, usePhysicians, type StandingOrderTemplateWithItems } from '../api'
import TemplatePicker from './TemplatePicker'
import { clinicCalendarDateString } from '@/lib/clinicDate'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Patient + encounter context. When omitted, the sheet renders the picker
   *  in a "preview" mode and disables submission with an explainer. */
  patientId?: string
  encounterId?: string
  onSuccess?: (standingOrderId: string) => void
}

/**
 * Physician ids are two-tier display ids (`USR_K9MX3VQ2`), never UUIDs.
 *
 * This was a `UUID_RE` until 2026-07-26, and because `physicianValid` is
 * checked for BOTH the dropdown and the manual-entry path, a Nurse who
 * correctly picked a physician from the populated `<select>` still could not
 * submit — `canSubmit` was unreachable for any Nurse or Branch session, i.e.
 * the primary single-operator login could not start a standing order at all.
 * The regex was written for the manual fallback and applied to everything.
 */
const PHYSICIAN_ID_RE = /^USR_[A-Z0-9]+$/i

export default function InitiateProtocolSheet({
  open,
  onOpenChange,
  patientId,
  encounterId,
  onSuccess,
}: Props) {
  const { user } = useAuth()
  // Both nurses and Branch (kiosk) sessions must select a physician to
  // authorize a standing order — physicians self-authorize on submit.
  const requiresAuthorizer = user?.role === 'Nurse' || user?.role === 'Branch'
  const isNurse = requiresAuthorizer

  const [selected, setSelected] = useState<StandingOrderTemplateWithItems | null>(null)
  const [physicianId, setPhysicianId] = useState<string>('')
  const [startDate, setStartDate] = useState<string>(clinicCalendarDateString())

  const physiciansQuery = usePhysicians()
  const startMutation = useStartStandingOrder()

  function reset() {
    setSelected(null)
    setPhysicianId('')
    setStartDate(clinicCalendarDateString())
    startMutation.reset()
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  const hasContext = !!(patientId && encounterId)
  const physicians = physiciansQuery.data ?? []
  const physiciansAvailable = physicians.length > 0
  const trimmedPhysicianId = physicianId.trim()

  const physicianValid = !isNurse || PHYSICIAN_ID_RE.test(trimmedPhysicianId)
  const canSubmit = hasContext && !!selected && physicianValid && !startMutation.isPending

  async function handleSubmit() {
    if (!selected || !patientId || !encounterId) return
    try {
      const created = await startMutation.mutateAsync({
        patientId,
        encounterId,
        templateId: selected.id,
        ...(isNurse ? { authorizingProviderId: trimmedPhysicianId } : {}),
        startDate,
      })
      onSuccess?.(created.id)
      handleOpenChange(false)
    } catch {
      /* surface via startMutation.error below */
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <DetailSheet width="wide" className="overflow-hidden">
        <div className="flex flex-col h-full">
          <SheetHeader className="px-6 py-4 border-b border-border">
            <SheetTitle>Initiate protocol</SheetTitle>
            <SheetDescription>
              Pick a standing-order template, preview the dose schedule, then start the protocol.
              This generates one clinical order per template line item.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="px-6 py-4 space-y-6">
              {/* Step 1 — pick template */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">1. Choose template</h3>
                <TemplatePicker selectedId={selected?.id ?? null} onSelect={setSelected} />
              </section>

              {/* Step 2 — preview dose schedule */}
              {selected && (
                <>
                  <Separator />
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold">2. Dose schedule</h3>
                    <TableCard>
                      <Table className="w-full text-sm">
                        <TableHeader className="bg-muted/50 text-xs text-muted-foreground">
                          <TableRow>
                            <TableHead className="text-left font-medium px-3 w-16">Day</TableHead>
                            <TableHead className="text-left font-medium px-3 w-12">#</TableHead>
                            <TableHead className="text-left font-medium px-3">Service</TableHead>
                            <TableHead className="text-left font-medium px-3 w-20">Qty</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selected.items.map((item) => (
                            <TableRow key={item.id} className="border-t">
                              <TableCell className="px-3 font-mono text-xs">
                                D{item.dayOffset}
                              </TableCell>
                              <TableCell className="px-3 font-mono text-xs">
                                {item.sequence}
                              </TableCell>
                              <TableCell className="px-3">
                                <span className="font-mono text-xs text-muted-foreground mr-2">
                                  {item.serviceCode}
                                </span>
                                {item.serviceName}
                              </TableCell>
                              <TableCell className="px-3 font-mono tabular-nums">
                                {Number.parseFloat(String(item.quantity)).toLocaleString('en-PH', {
                                  maximumFractionDigits: 2,
                                })}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableCard>
                  </section>
                </>
              )}

              {/* Step 3 — authorizing physician (nurses only) + start date */}
              {selected && (
                <>
                  <Separator />
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">3. Authorization</h3>

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

                    {isNurse && (
                      <div className="space-y-1.5">
                        <Label htmlFor="physician">
                          Authorizing physician <span className="text-destructive">*</span>
                        </Label>
                        {physiciansQuery.isLoading && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                            Loading physicians...
                          </div>
                        )}
                        {physiciansAvailable && (
                          <select
                            id="physician"
                            value={physicianId}
                            onChange={(e) => setPhysicianId(e.target.value)}
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            <option value="">Select a physician...</option>
                            {physicians
                              .filter((p) => p.isActive)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  Dr. {p.firstName} {p.lastName} ({p.email})
                                </option>
                              ))}
                          </select>
                        )}
                        {!physiciansQuery.isLoading && !physiciansAvailable && (
                          <>
                            <Input
                              id="physician"
                              placeholder="USR_XXXXXXXX"
                              value={physicianId}
                              onChange={(e) => setPhysicianId(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                              <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
                              No physicians are on record at this branch. Enter the authorizing
                              physician&apos;s ID, or have an admin add them and start the protocol.
                            </p>
                          </>
                        )}
                        {trimmedPhysicianId && !physicianValid && (
                          <p className="text-xs text-destructive">
                            Must be a physician ID, e.g. USR_K9MX3VQ2.
                          </p>
                        )}
                      </div>
                    )}

                    {!isNurse && (
                      <p className="text-xs text-muted-foreground">
                        You are listed as the authorizing provider for this protocol.
                      </p>
                    )}
                  </section>
                </>
              )}

              {/* Context notice */}
              {!hasContext && (
                <div className="border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 rounded-md p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                  <div>
                    Patient and encounter context are missing. This sheet is rendered in preview
                    mode — open it from an encounter to initiate the protocol. The encounter detail
                    wiring will arrive in a follow-on PR.
                  </div>
                </div>
              )}

              {startMutation.isError && (
                <div className="text-sm text-destructive flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                  {startMutation.error?.message ?? 'Failed to initiate protocol.'}
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {startMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
              )}
              {selected
                ? `Start protocol (${selected.items.length} ${
                    selected.items.length === 1 ? 'order' : 'orders'
                  })`
                : 'Start protocol'}
            </Button>
          </div>
        </div>
      </DetailSheet>
    </Sheet>
  )
}
