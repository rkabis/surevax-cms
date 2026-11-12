import { useEffect, useRef, useState } from 'react'
import { CalendarPlus, AlertTriangle, Inbox, Clock, Search, X } from 'lucide-react'
import { formatLongDateTime as fmtDT, formatTime } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import {
  PageHeader,
  KpiCell,
  KpiStrip,
  ListEmpty,
  DetailSheet,
  TableCard,
  PageToolbar,
  DetailRail,
} from '@/components/layout'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import {
  useAppointments,
  useCreateAppointment,
  useAvailability,
  useBranchPhysicians,
  type Appointment,
  type AppointmentStatus,
  type AvailabilitySlot,
  type CreateAppointmentBody,
} from './api'
import AppointmentDetail from './components/AppointmentDetail'
import { usePatientSearch, type Patient } from '@/features/patients/api'
import BranchPicker from '@/components/forms/BranchPicker'

import { APPOINTMENT_STATUS_VARIANT as STATUS_BADGE_VARIANT, humanizeStatus } from '@/lib/status'

// ── helpers ───────────────────────────────────────────────────────────────────

const APPOINTMENT_TYPES = [
  'Vaccination',
  'Consultation',
  'FollowUp',
  'Telemedicine',
  'Other',
] as const

type ActiveTab = 'All' | AppointmentStatus

const TABS: ActiveTab[] = ['All', 'Scheduled', 'Completed', 'Cancelled', 'NoShow']

function tabLabel(tab: ActiveTab): string {
  if (tab === 'NoShow') return 'No-Show'
  return tab
}

function sortAppointments(appts: Appointment[], tab: ActiveTab): Appointment[] {
  if (tab === 'Scheduled') {
    return [...appts].sort(
      (a, b) => new Date(a.scheduledStartAt).getTime() - new Date(b.scheduledStartAt).getTime(),
    )
  }
  return [...appts].sort(
    (a, b) => new Date(b.scheduledStartAt).getTime() - new Date(a.scheduledStartAt).getTime(),
  )
}

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function isThisWeek(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  const startOfWeek = new Date(now)
  startOfWeek.setHours(0, 0, 0, 0)
  startOfWeek.setDate(now.getDate() - now.getDay())
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 7)
  return d >= startOfWeek && d < endOfWeek
}

// ── helpers ───────────────────────────────────────────────────────────────────

function datetimeLocalToISO(dtLocal: string): string {
  if (!dtLocal) return ''
  const d = new Date(dtLocal)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString()
}

// ── BookingDialog ─────────────────────────────────────────────────────────────

const EMPTY_FORM: CreateAppointmentBody = {
  patientId: '',
  branchId: '',
  scheduledStartAt: '',
  scheduledEndAt: '',
  appointmentType: 'Vaccination',
  providerId: '',
  reason: '',
  notes: '',
}

function BookingDialog() {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<CreateAppointmentBody>(EMPTY_FORM)
  const createMutation = useCreateAppointment()

  // Patient search
  const [patientQ, setPatientQ] = useState('')
  const [debouncedPatientQ, setDebouncedPatientQ] = useState('')
  const [showPatientDropdown, setShowPatientDropdown] = useState(false)
  const [selectedPatientLabel, setSelectedPatientLabel] = useState('')
  const patientInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedPatientQ(patientQ), 250)
    return () => clearTimeout(t)
  }, [patientQ])

  const { data: patientData, isLoading: patientLoading } = usePatientSearch(
    debouncedPatientQ,
    debouncedPatientQ.length >= 2,
  )
  const searchResults = patientData?.data ?? []

  // Providers
  const { data: physiciansData } = useBranchPhysicians()
  const physicians = physiciansData ?? []

  // Availability
  const [availabilityEnabled, setAvailabilityEnabled] = useState(false)
  const availabilityFrom = availabilityEnabled ? datetimeLocalToISO(form.scheduledStartAt) : null
  const availabilityTo = availabilityEnabled ? datetimeLocalToISO(form.scheduledEndAt) : null

  const { data: availabilityData, isFetching: availabilityLoading } = useAvailability(
    availabilityEnabled ? form.providerId || null : null,
    availabilityFrom,
    availabilityTo,
    30,
  )
  const slots = availabilityData?.slots ?? []

  function handleChange(field: keyof CreateAppointmentBody, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function selectPatient(p: Patient) {
    setForm((prev) => ({ ...prev, patientId: p.id }))
    setSelectedPatientLabel(`${p.lastName}, ${p.firstName}`)
    setPatientQ('')
    setShowPatientDropdown(false)
  }

  function clearPatient() {
    setForm((prev) => ({ ...prev, patientId: '' }))
    setSelectedPatientLabel('')
    setPatientQ('')
    patientInputRef.current?.focus()
  }

  function selectSlot(slot: AvailabilitySlot) {
    const pad = (n: number) => String(n).padStart(2, '0')
    function toDatetimeLocal(iso: string) {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return ''
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    setForm((prev) => ({
      ...prev,
      scheduledStartAt: toDatetimeLocal(slot.startAt),
      scheduledEndAt: toDatetimeLocal(slot.endAt),
    }))
  }

  function resetDialog() {
    setOpen(false)
    setForm(EMPTY_FORM)
    setSelectedPatientLabel('')
    setPatientQ('')
    setAvailabilityEnabled(false)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const body: CreateAppointmentBody = {
      patientId: form.patientId.trim(),
      branchId: form.branchId.trim(),
      scheduledStartAt: datetimeLocalToISO(form.scheduledStartAt),
      scheduledEndAt: datetimeLocalToISO(form.scheduledEndAt),
      appointmentType: form.appointmentType,
    }
    if (form.providerId?.trim()) body.providerId = form.providerId.trim()
    if (form.reason?.trim()) body.reason = form.reason.trim()
    if (form.notes?.trim()) body.notes = form.notes.trim()

    createMutation.mutate(body, {
      onSuccess: () => {
        toast('Appointment booked')
        resetDialog()
      },
      onError: (err) => {
        toast.error('Failed to book appointment', { description: apiErrorMessage(err) })
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetDialog()
        else setOpen(true)
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <CalendarPlus className="h-4 w-4" aria-hidden />
          Book appointment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md xl:max-w-lg">
        <DialogHeader>
          <DialogTitle>Book appointment</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Patient search */}
          <div className="space-y-1.5">
            <Label>Patient *</Label>
            {selectedPatientLabel ? (
              <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-input bg-muted/50">
                <span className="text-sm flex-1 truncate">{selectedPatientLabel}</span>
                <span className="text-xs text-muted-foreground font-mono tabular-nums">
                  {form.patientId}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={clearPatient}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Search
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                  aria-hidden
                />
                <Input
                  ref={patientInputRef}
                  placeholder="Search by patient name…"
                  value={patientQ}
                  onChange={(e) => {
                    setPatientQ(e.target.value)
                    setShowPatientDropdown(true)
                  }}
                  onFocus={() => {
                    if (searchResults.length > 0) setShowPatientDropdown(true)
                  }}
                  onBlur={() => {
                    setTimeout(() => setShowPatientDropdown(false), 200)
                  }}
                  className="pl-9"
                />
                {showPatientDropdown && patientQ.length >= 2 && (
                  <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-md">
                    {patientLoading ? (
                      <div className="p-2 space-y-1">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <Skeleton key={i} className="h-8 w-full rounded-sm" />
                        ))}
                      </div>
                    ) : searchResults.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground text-center">
                        No patients found
                      </p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto">
                        {searchResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              selectPatient(p)
                            }}
                          >
                            <span className="flex-1 truncate">
                              {p.lastName}, {p.firstName}
                            </span>
                            <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0">
                              {p.id}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Branch */}
          <div className="space-y-1.5">
            <Label htmlFor="branchId">
              Branch <span className="text-destructive">*</span>
            </Label>
            <BranchPicker
              value={form.branchId || null}
              onChange={(id) => handleChange('branchId', id ?? '')}
              required
            />
          </div>

          {/* Provider */}
          <div className="space-y-1.5">
            <Label htmlFor="providerId">Provider</Label>
            <Select
              value={form.providerId ?? ''}
              onValueChange={(v) => {
                handleChange('providerId', v)
                setAvailabilityEnabled(false)
              }}
            >
              <SelectTrigger id="providerId">
                <SelectValue placeholder="Select physician (optional)" />
              </SelectTrigger>
              <SelectContent>
                {physicians.map((phy) => (
                  <SelectItem key={phy.id} value={phy.id}>
                    {phy.lastName}, {phy.firstName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date/Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="scheduledStartAt">Start *</Label>
              <Input
                id="scheduledStartAt"
                type="datetime-local"
                value={form.scheduledStartAt}
                onChange={(e) => {
                  handleChange('scheduledStartAt', e.target.value)
                  setAvailabilityEnabled(false)
                }}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scheduledEndAt">End *</Label>
              <Input
                id="scheduledEndAt"
                type="datetime-local"
                value={form.scheduledEndAt}
                onChange={(e) => {
                  handleChange('scheduledEndAt', e.target.value)
                  setAvailabilityEnabled(false)
                }}
                required
              />
            </div>
          </div>

          {/* Check Availability */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            disabled={
              !form.providerId ||
              !form.scheduledStartAt ||
              !form.scheduledEndAt ||
              availabilityLoading
            }
            onClick={() => setAvailabilityEnabled(true)}
          >
            <Clock className="h-4 w-4" aria-hidden />
            {availabilityLoading ? 'Checking…' : 'Check Availability'}
          </Button>

          {/* Slot picker */}
          {availabilityEnabled && !availabilityLoading && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {slots.length > 0 ? 'Available slots (click to select):' : 'No available slots'}
              </Label>
              {slots.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {slots.map((slot) => (
                    <Button
                      key={slot.startAt}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 font-mono tabular-nums"
                      onClick={() => selectSlot(slot)}
                    >
                      {formatTime(slot.startAt)} – {formatTime(slot.endAt)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Type */}
          <div className="space-y-1.5">
            <Label htmlFor="appointmentType">Type *</Label>
            <Select
              value={form.appointmentType}
              onValueChange={(v) => handleChange('appointmentType', v)}
            >
              <SelectTrigger id="appointmentType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPOINTMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {humanizeStatus(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Input
              id="reason"
              placeholder="Chief complaint or reason (optional)"
              value={form.reason ?? ''}
              onChange={(e) => handleChange('reason', e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Additional notes (optional)"
              value={form.notes ?? ''}
              onChange={(e) => handleChange('notes', e.target.value)}
              className="resize-none"
              rows={3}
            />
          </div>

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : 'Failed to book appointment.'}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => resetDialog()}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Booking…' : 'Book appointment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── AppointmentsTable ─────────────────────────────────────────────────────────

interface AppointmentsTableProps {
  appointments: Appointment[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function AppointmentsTable({ appointments, selectedId, onSelect }: AppointmentsTableProps) {
  return (
    <Table density="compact">
      <TableHeader className="sticky top-0 bg-card z-10">
        <TableRow className="text-xs">
          <TableHead className="font-mono tabular-nums">Date / Time</TableHead>
          <TableHead>Patient ID</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Provider</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {appointments.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="py-4 text-center text-sm text-muted-foreground">
              No appointments for this filter
            </TableCell>
          </TableRow>
        ) : (
          appointments.map((appt) => {
            const sev = STATUS_BADGE_VARIANT[appt.status]
            const stripeSev =
              appt.status === 'Scheduled' ? 'info' : appt.status === 'Completed' ? 'ok' : 'overdue'

            return (
              <TableRow
                interactive
                key={appt.id}
                data-severity={stripeSev}
                data-state={selectedId === appt.id ? 'selected' : undefined}
                className="stripe cursor-pointer"
                onClick={() => onSelect(appt.id)}
              >
                <TableCell>
                  <span className="font-mono tabular-nums text-sm">
                    {fmtDT(appt.scheduledStartAt)}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="font-mono tabular-nums text-sm">{appt.patientId}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{humanizeStatus(appt.appointmentType)}</span>
                </TableCell>
                <TableCell>
                  <Badge variant={sev} className="text-xs">
                    {appt.status === 'NoShow' ? 'No-Show' : appt.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">{appt.providerId ?? '—'}</span>
                </TableCell>
              </TableRow>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}

// ── AppointmentsPage ──────────────────────────────────────────────────────────

export default function AppointmentsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('All')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filters = activeTab === 'All' ? undefined : { status: activeTab }

  const { data, isLoading, isError } = useAppointments(filters)

  // Backend returns a bare array (gotchas.md "List response is a bare array").
  const allAppointments = data ?? []
  const sorted = sortAppointments(allAppointments, activeTab)

  const counts = TABS.reduce<Record<ActiveTab, number>>(
    (acc, tab) => {
      acc[tab] =
        tab === 'All'
          ? allAppointments.length
          : allAppointments.filter((a) => a.status === tab).length
      return acc
    },
    {} as Record<ActiveTab, number>,
  )

  const todayCount = allAppointments.filter((a) => isToday(a.scheduledStartAt)).length
  const weekCount = allAppointments.filter((a) => isThisWeek(a.scheduledStartAt)).length
  const confirmedCount = counts['Scheduled'] ?? 0
  const pendingCount = (counts['Cancelled'] ?? 0) + (counts['NoShow'] ?? 0)

  return (
    <div className="h-full flex flex-col">
      {/* Page head */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Appointments"
          description={`${allAppointments.length} total appointments`}
          actions={<BookingDialog />}
        />
      </div>

      {/* KPI strip */}
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-b border-border bg-card">
        <KpiStrip>
          <KpiCell label="Today" value={todayCount} subtitle="appointments" />
          <KpiCell label="This week" value={weekCount} subtitle="appointments" />
          <KpiCell label="Confirmed" value={confirmedCount} subtitle="scheduled" tone="info" />
          <KpiCell label="No-show / cancelled" value={pendingCount} subtitle="not completed" />
        </KpiStrip>
      </div>

      {/* Filter tabs */}
      <PageToolbar>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)}>
          <TabsList className="h-8">
            {TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} className="text-xs h-7 px-3">
                {tabLabel(tab)}
                <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">
                  {counts[tab]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageToolbar>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          )}

          {isError && (
            <div className="py-12 text-center text-destructive">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2" aria-hidden />
              <p className="text-sm">Failed to load appointments.</p>
            </div>
          )}

          {!isLoading && !isError && sorted.length === 0 && (
            <ListEmpty icon={Inbox} message="No appointments for this filter." className="px-0" />
          )}

          {!isLoading && !isError && sorted.length > 0 && (
            <TableCard>
              <AppointmentsTable
                appointments={sorted}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </TableCard>
          )}
        </div>
      </div>

      {/* Detail Sheet */}
      <DetailRail open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DetailSheet width="narrow">
          <SheetHeader className="px-6 pt-6 pb-2 shrink-0">
            <SheetTitle className="sr-only">Appointment detail</SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0">
            {selectedId && <AppointmentDetail appointmentId={selectedId} />}
          </div>
        </DetailSheet>
      </DetailRail>
    </div>
  )
}
