import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Workflow, Plus } from 'lucide-react'
import { maskSensitive } from '@/lib/sensitive'
import { formatLongDateTime, formatMoney } from '@/lib/format'
import { SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { DetailRail, DetailSheet } from '@/components/layout'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from '@/components/ui/toast'
import { useEncounter, useVitals, useDiagnoses, useCreateVital, useCreateDiagnosis } from '../api'
import { useTransactions } from '@/features/transactions/api'
import InitiateProtocolSheet from '@/features/standing-orders/components/InitiateProtocolSheet'
import EncounterStatusActions from './EncounterStatusActions'
import { apiErrorMessage } from '@/lib/apiErrors'
import ICD10Picker from '@/components/forms/ICD10Picker'

type Props = {
  encounterId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STATUS_VARIANT: Record<string, 'default' | 'outline' | 'due' | 'overdue'> = {
  Open: 'outline',
  InProgress: 'due',
  Completed: 'default',
  Cancelled: 'overdue',
}

const STATUS_LABEL: Record<string, string> = {
  Open: 'In room',
  InProgress: 'In progress',
  Completed: 'Signed',
  Cancelled: 'Cancelled',
}

const TXN_STATUS_VARIANT: Record<string, 'default' | 'outline' | 'due' | 'overdue'> = {
  Draft: 'outline',
  Pending: 'due',
  Paid: 'default',
  Voided: 'overdue',
  Refunded: 'overdue',
}

function Dash() {
  return <span className="text-muted-foreground">—</span>
}

function nullable(value: string | number | null | undefined): React.ReactNode {
  if (value === null || value === undefined || value === '') return <Dash />
  return value
}

function fmtDateTime(value: string | null | undefined): React.ReactNode {
  const result = formatLongDateTime(value)
  return result === '—' ? <Dash /> : result
}

function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function formatScalar(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') return <Dash />
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return value.toLocaleString('en-PH')
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="font-medium break-words text-right">{children}</dd>
    </div>
  )
}

function GridField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium break-words">{children}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </h3>
      {children}
    </section>
  )
}

function JsonKvBlock({ value }: { value: unknown }) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'object' && value !== null && Object.keys(value as object).length === 0)
  ) {
    return <Dash />
  }
  const masked = maskSensitive(value) as Record<string, unknown>
  if (!isRecord(masked)) {
    return (
      <pre className="text-xs bg-muted/50 border border-border rounded p-3 overflow-x-auto font-mono">
        {JSON.stringify(masked, null, 2)}
      </pre>
    )
  }
  return (
    <dl className="space-y-1">
      {Object.entries(masked).map(([k, v]) => {
        const isSimple =
          v === null ||
          v === undefined ||
          typeof v === 'string' ||
          typeof v === 'number' ||
          typeof v === 'boolean'
        return (
          <Field key={k} label={humanizeKey(k)}>
            {isSimple ? (
              formatScalar(v)
            ) : (
              <pre className="text-xs bg-muted/50 border border-border rounded p-2 overflow-x-auto font-mono text-left">
                {JSON.stringify(v, null, 2)}
              </pre>
            )}
          </Field>
        )
      })}
    </dl>
  )
}

const RABIES_KEYS: Array<{ key: string; label: string }> = [
  { key: 'whoCategory', label: 'Category' },
  { key: 'animalType', label: 'Animal' },
  { key: 'woundSite', label: 'Wound' },
  { key: 'exposureDate', label: 'Exposure' },
  { key: 'exposureTime', label: 'Time' },
  { key: 'circumstances', label: 'Circumstances' },
  { key: 'animalArvStatus', label: 'ARV status' },
  { key: 'brainExamResult', label: 'Brain exam' },
  { key: 'animalOwnerName', label: 'Owner' },
  { key: 'animalDisposition', label: 'Disposition' },
]

function RabiesGrid({ data }: { data: Record<string, unknown> }) {
  const masked = maskSensitive(data) as Record<string, unknown>
  const remaining = { ...masked }
  for (const { key } of RABIES_KEYS) delete remaining[key]
  const remainingKeys = Object.keys(remaining)

  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-3">
        {RABIES_KEYS.map(({ key, label }) => (
          <GridField key={key} label={label}>
            {formatScalar(masked[key])}
          </GridField>
        ))}
      </div>
      {remainingKeys.length > 0 && (
        <pre className="text-xs bg-muted/50 border border-border rounded p-3 overflow-x-auto font-mono">
          {JSON.stringify(remaining, null, 2)}
        </pre>
      )}
    </>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function VitalsCard({
  vitals,
  recordedAt,
}: {
  vitals: Record<string, unknown>
  recordedAt?: string | null
}) {
  const masked = maskSensitive(vitals) as Record<string, unknown>
  const entries = Object.entries(masked)
  if (entries.length === 0) return <Dash />
  return (
    <div>
      {recordedAt && (
        <p className="text-xs text-muted-foreground mb-2">{formatLongDateTime(recordedAt)}</p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {entries.map(([k, v]) => (
          <div key={k} className="rounded-md border border-border p-3 text-center">
            <p className="text-xs text-muted-foreground font-medium">{humanizeKey(k)}</p>
            <p className="text-lg font-semibold font-mono tabular-nums mt-0.5">{formatScalar(v)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function patientName(d: {
  patientFirstName: string | null
  patientLastName: string | null
}): string {
  const first = d.patientFirstName ?? ''
  const last = d.patientLastName ?? ''
  const name = `${last}${last && first ? ', ' : ''}${first}`.trim()
  return name
}

function VitalsTab({ encounterId }: { encounterId: string }) {
  const { data, isLoading } = useVitals(encounterId)
  const createVital = useCreateVital(encounterId)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    temperatureC: '',
    heartRateBpm: '',
    respiratoryRateBpm: '',
    systolic: '',
    diastolic: '',
    spo2Percent: '',
    weightKg: '',
    heightCm: '',
    painScore: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      ...(form.temperatureC && { temperatureC: form.temperatureC }),
      ...(form.heartRateBpm && { heartRateBpm: Number(form.heartRateBpm) }),
      ...(form.respiratoryRateBpm && { respiratoryRateBpm: Number(form.respiratoryRateBpm) }),
      ...(form.systolic && { systolic: Number(form.systolic) }),
      ...(form.diastolic && { diastolic: Number(form.diastolic) }),
      ...(form.spo2Percent && { spo2Percent: form.spo2Percent }),
      ...(form.weightKg && { weightKg: form.weightKg }),
      ...(form.heightCm && { heightCm: form.heightCm }),
      ...(form.painScore && { painScore: Number(form.painScore) }),
    }
    try {
      await createVital.mutateAsync(payload)
      toast('Vitals recorded', { description: 'New vital signs saved.' })
      setShowForm(false)
      setForm({
        temperatureC: '',
        heartRateBpm: '',
        respiratoryRateBpm: '',
        systolic: '',
        diastolic: '',
        spo2Percent: '',
        weightKg: '',
        heightCm: '',
        painScore: '',
      })
    } catch (err) {
      toast.error('Failed to record vitals', { description: apiErrorMessage(err) })
    }
  }

  const vitals = data?.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{vitals.length} recorded</p>
        <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1" aria-hidden />
          Add vital
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="rounded-md border border-border p-4 space-y-3"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            New vital signs
          </p>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['temperatureC', 'Temp (°C)'],
                ['heartRateBpm', 'Heart rate (bpm)'],
                ['respiratoryRateBpm', 'Resp rate (breaths/min)'],
                ['systolic', 'Systolic BP'],
                ['diastolic', 'Diastolic BP'],
                ['spo2Percent', 'SpO2 (%)'],
                ['weightKg', 'Weight (kg)'],
                ['heightCm', 'Height (cm)'],
                ['painScore', 'Pain score (0–10)'],
              ] as const
            ).map(([field, label]) => (
              <div key={field} className="space-y-1">
                <Label htmlFor={`v-${field}`} className="text-xs">
                  {label}
                </Label>
                <Input
                  id={`v-${field}`}
                  value={form[field]}
                  onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                  placeholder="—"
                  className="h-7 text-sm"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm" disabled={createVital.isPending}>
              {createVital.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {isLoading && <Skeleton className="h-20 w-full" />}

      {vitals.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">No vitals recorded yet.</p>
      )}

      {vitals.map((v) => (
        <div key={v.id} className="rounded-md border border-border p-3 space-y-2">
          <p className="text-xs text-muted-foreground">{formatLongDateTime(v.recordedAt)}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {v.temperatureC && (
              <span>
                <span className="text-muted-foreground">Temp: </span>
                {v.temperatureC} °C
              </span>
            )}
            {v.heartRateBpm != null && (
              <span>
                <span className="text-muted-foreground">HR: </span>
                {v.heartRateBpm} bpm
              </span>
            )}
            {v.systolicBp != null && v.diastolicBp != null && (
              <span>
                <span className="text-muted-foreground">BP: </span>
                {v.systolicBp}/{v.diastolicBp}
              </span>
            )}
            {v.spo2Percent && (
              <span>
                <span className="text-muted-foreground">SpO2: </span>
                {v.spo2Percent}%
              </span>
            )}
            {v.weightKg && (
              <span>
                <span className="text-muted-foreground">Weight: </span>
                {v.weightKg} kg
              </span>
            )}
            {v.heightCm && (
              <span>
                <span className="text-muted-foreground">Height: </span>
                {v.heightCm} cm
              </span>
            )}
            {v.painScore != null && (
              <span>
                <span className="text-muted-foreground">Pain: </span>
                {v.painScore}/10
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function DiagnosesTab({ encounterId }: { encounterId: string }) {
  const { data, isLoading } = useDiagnoses(encounterId)
  const createDiagnosis = useCreateDiagnosis(encounterId)
  const [showForm, setShowForm] = useState(false)
  const [icd10Code, setIcd10Code] = useState('')
  const [description, setDescription] = useState('')
  const [diagnosisType, setDiagnosisType] = useState('')
  const [notes, setNotes] = useState('')
  const [isPrimary, setIsPrimary] = useState(false)
  const [codeError, setCodeError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!icd10Code.trim()) {
      setCodeError('ICD-10 code is required')
      return
    }
    setCodeError('')
    try {
      await createDiagnosis.mutateAsync({
        icd10Code: icd10Code.trim(),
        ...(description.trim() && { description: description.trim() }),
        ...(diagnosisType.trim() && { diagnosisType: diagnosisType.trim() }),
        ...(notes.trim() && { notes: notes.trim() }),
        isPrimary,
      })
      toast('Diagnosis added', { description: `${icd10Code} recorded.` })
      setShowForm(false)
      setIcd10Code('')
      setDescription('')
      setDiagnosisType('')
      setNotes('')
      setIsPrimary(false)
    } catch (err) {
      toast.error('Failed to add diagnosis', { description: apiErrorMessage(err) })
    }
  }

  const diagnoses = data?.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{diagnoses.length} recorded</p>
        <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>
          <Plus className="h-3.5 w-3.5 mr-1" aria-hidden />
          Add diagnosis
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="rounded-md border border-border p-4 space-y-3"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            New diagnosis
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">
              ICD-10 code <span className="text-destructive">*</span>
            </Label>
            <ICD10Picker
              value={icd10Code}
              onChange={(code, desc) => {
                setIcd10Code(code)
                if (!description.trim()) setDescription(desc)
              }}
              required
              ariaInvalid={!!codeError}
            />
            {codeError && <p className="text-xs text-destructive">{codeError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dx-desc" className="text-xs">
              Description
            </Label>
            <Input
              id="dx-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              className="h-8"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dx-type" className="text-xs">
                Type
              </Label>
              <Input
                id="dx-type"
                value={diagnosisType}
                onChange={(e) => setDiagnosisType(e.target.value)}
                placeholder="e.g. Working"
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dx-notes" className="text-xs">
                Notes
              </Label>
              <Input
                id="dx-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="h-8"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm">Primary diagnosis</span>
          </label>
          <div className="flex gap-2 pt-1">
            <Button type="submit" size="sm" disabled={createDiagnosis.isPending}>
              {createDiagnosis.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {isLoading && <Skeleton className="h-20 w-full" />}

      {diagnoses.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">No diagnoses recorded yet.</p>
      )}

      {diagnoses.map((d) => (
        <div key={d.id} className="rounded-md border border-border p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold">{d.icd10Code}</span>
            {d.isPrimary && (
              <Badge variant="default" className="text-2xs px-1.5 py-0">
                Primary
              </Badge>
            )}
            {d.diagnosisType && (
              <Badge variant="outline" className="text-2xs px-1.5 py-0">
                {d.diagnosisType}
              </Badge>
            )}
          </div>
          {d.description && <p className="text-sm mt-1">{d.description}</p>}
          {d.notes && <p className="text-xs text-muted-foreground mt-1">{d.notes}</p>}
          <p className="text-xs text-muted-foreground mt-1">{formatLongDateTime(d.createdAt)}</p>
        </div>
      ))}
    </div>
  )
}

export default function EncounterDetail({ encounterId, open, onOpenChange }: Props) {
  const navigate = useNavigate()
  const { data, isLoading, error } = useEncounter(open ? encounterId : null)
  const {
    data: txnData,
    isLoading: txnsLoading,
    isError: txnsError,
  } = useTransactions({
    encounter: encounterId ?? undefined,
    limit: 5,
    enabled: open && !!encounterId,
  })
  const { data: vitalsData } = useVitals(open ? encounterId : null)
  const latestVital = vitalsData?.data?.[vitalsData.data.length - 1] ?? null
  const [protocolOpen, setProtocolOpen] = useState(false)
  const isActive = data?.status === 'Open' || data?.status === 'InProgress'

  const clinicalNotes = isRecord(data?.clinicalNotes) ? data!.clinicalNotes : null
  const clinicalNotesWithoutVitals = clinicalNotes
    ? (() => {
        const { vitals: _v, ...rest } = clinicalNotes
        return rest
      })()
    : null

  const specialtyData = isRecord(data?.specialtyData) ? data!.specialtyData : null
  const isRabies = data?.specialty?.toLowerCase() === 'rabies'

  const latestVitals: Record<string, unknown> | null = (() => {
    if (latestVital) {
      const row: Record<string, unknown> = {}
      if (latestVital.systolicBp != null && latestVital.diastolicBp != null)
        row.BP = `${latestVital.systolicBp}/${latestVital.diastolicBp}`
      if (latestVital.heartRateBpm != null) row.HR = `${latestVital.heartRateBpm} bpm`
      if (latestVital.temperatureC) row.Temp = `${latestVital.temperatureC} °C`
      if (latestVital.spo2Percent) row.SpO2 = `${latestVital.spo2Percent}%`
      if (latestVital.weightKg) row.Weight = `${latestVital.weightKg} kg`
      if (latestVital.painScore != null) row.Pain = `${latestVital.painScore}/10`
      return Object.keys(row).length > 0 ? row : null
    }
    return null
  })()

  return (
    <DetailRail open={open} onOpenChange={onOpenChange}>
      <DetailSheet className="overflow-hidden">
        {isLoading && (
          <div className="flex-1 px-6 py-4 space-y-2" role="status" aria-label="Loading encounter">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        )}
        {error && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-destructive">Failed to load encounter.</p>
          </div>
        )}
        {data && (
          <>
            {/* Header */}
            <SheetHeader className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <SheetTitle>Encounter</SheetTitle>
                <span className="font-mono text-lg font-semibold">{data.id}</span>
                <Badge variant={STATUS_VARIANT[data.status] ?? 'outline'} className="shrink-0">
                  {STATUS_LABEL[data.status] ?? data.status}
                </Badge>
              </div>
              <SheetDescription>
                <span className="flex flex-col gap-0.5">
                  <span>
                    {patientName(data) || '—'}
                    {data.specialty ? ` · ${data.specialty}` : ''}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Started {formatLongDateTime(data.startedAt)}
                    {data.completedAt ? ` · Completed ${formatLongDateTime(data.completedAt)}` : ''}
                  </span>
                </span>
              </SheetDescription>
            </SheetHeader>

            {isActive && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setProtocolOpen(true)} disabled={!data.patientId}>
                  <Workflow className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Initiate protocol
                </Button>
                <EncounterStatusActions encounterId={data.id} />
              </div>
            )}

            <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0 mt-3">
              <TabsList className="w-full shrink-0">
                <TabsTrigger value="overview" className="flex-1">
                  Overview
                </TabsTrigger>
                <TabsTrigger value="vitals" className="flex-1">
                  Vitals
                </TabsTrigger>
                <TabsTrigger value="diagnoses" className="flex-1">
                  Diagnoses
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="flex-1 mt-4">
                <TabsContent value="overview" className="space-y-5">
                  {/* Patient Info */}
                  <Section title="Patient">
                    <div className="space-y-1">
                      <Field label="Name">{patientName(data) ? patientName(data) : <Dash />}</Field>
                      <Field label="DOB">
                        {data.patientDateOfBirth ? (
                          new Date(data.patientDateOfBirth).toLocaleDateString('en-PH', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        ) : (
                          <Dash />
                        )}
                      </Field>
                      <Field label="Branch">{nullable(data.branchName)}</Field>
                    </div>
                  </Section>

                  {/* Vitals Summary */}
                  <Section title="Vitals">
                    {latestVitals ? (
                      <VitalsCard vitals={latestVitals} recordedAt={latestVital?.recordedAt} />
                    ) : (
                      <p className="text-sm text-muted-foreground">No vitals recorded yet.</p>
                    )}
                  </Section>

                  {/* Chief Complaint */}
                  <Section title="Chief Complaint">
                    {data.chiefComplaint ? (
                      <p className="text-sm leading-relaxed">{data.chiefComplaint}</p>
                    ) : (
                      <Dash />
                    )}
                  </Section>

                  {/* Specialty Data / Assessment */}
                  {specialtyData && (
                    <Section title="Assessment">
                      {isRabies ? (
                        <RabiesGrid data={specialtyData} />
                      ) : (
                        <JsonKvBlock value={specialtyData} />
                      )}
                    </Section>
                  )}

                  {/* Provider Note / Clinical Notes */}
                  <Section title="Provider Note">
                    {clinicalNotesWithoutVitals ? (
                      <JsonKvBlock value={clinicalNotesWithoutVitals} />
                    ) : (
                      <p className="text-sm text-muted-foreground">No notes recorded.</p>
                    )}
                  </Section>

                  {/* Transactions */}
                  <Section title="Transactions">
                    {txnsLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 2 }).map((_, i) => (
                          <Skeleton key={i} className="h-10" />
                        ))}
                      </div>
                    ) : txnsError ? (
                      <div className="flex items-center gap-2 text-sm text-destructive">
                        <AlertCircle className="h-4 w-4" aria-hidden />
                        Failed to load transactions.
                      </div>
                    ) : !txnData || txnData.data.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No transactions yet.</p>
                    ) : (
                      <ul className="divide-y divide-border rounded border border-border">
                        {txnData.data.map((txn) => (
                          <li key={txn.id}>
                            <button
                              type="button"
                              onClick={() => navigate(`/transactions?patient=${data.patientId}`)}
                              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge
                                    variant={TXN_STATUS_VARIANT[txn.status] ?? 'outline'}
                                    className="text-2xs px-1.5 py-0"
                                  >
                                    {txn.status}
                                  </Badge>
                                  <span className="text-xs font-mono text-muted-foreground truncate">
                                    {txn.id}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {fmtDateTime(txn.transactedAt)}
                                </p>
                              </div>
                              <span className="text-sm font-mono font-medium shrink-0">
                                {formatMoney(txn.netAmount)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>

                  {/* Details / Audit */}
                  <Section title="Details">
                    <div className="space-y-1">
                      <Field label="ID">
                        <span className="font-mono text-xs break-all">{data.id}</span>
                      </Field>
                      <Field label="Specialty">{nullable(data.specialty)}</Field>
                      <Field label="Started">{fmtDateTime(data.startedAt)}</Field>
                      <Field label="Completed">{fmtDateTime(data.completedAt)}</Field>
                      <Field label="Created">{fmtDateTime(data.createdAt)}</Field>
                      <Field label="Updated">{fmtDateTime(data.updatedAt)}</Field>
                      <Field label="Provider">
                        {data.providerFirstName || data.providerLastName ? (
                          <span>
                            {[data.providerFirstName, data.providerLastName]
                              .filter(Boolean)
                              .join(' ')}
                            {data.providerRole ? (
                              <span className="text-muted-foreground"> · {data.providerRole}</span>
                            ) : null}
                          </span>
                        ) : (
                          <Dash />
                        )}
                      </Field>
                    </div>
                  </Section>
                </TabsContent>

                <TabsContent value="vitals">
                  <VitalsTab encounterId={data.id} />
                </TabsContent>

                <TabsContent value="diagnoses">
                  <DiagnosesTab encounterId={data.id} />
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </>
        )}
      </DetailSheet>

      {data && data.patientId && (
        <InitiateProtocolSheet
          open={protocolOpen}
          onOpenChange={setProtocolOpen}
          patientId={data.patientId}
          encounterId={data.id}
          onSuccess={() => {
            toast('Protocol initiated', {
              description: 'Clinical orders scheduled for this encounter.',
            })
            setProtocolOpen(false)
          }}
        />
      )}
    </DetailRail>
  )
}
