import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { PageHeader, DirtyFormGuard } from '@/components/layout'
import { PatientPicker, ServicePicker } from '@/components/forms'
import { usePatient } from '@/features/patients/api'
import { useServices } from '@/features/services/api'
import { usePayerProfiles } from '@/features/admin/payerProfilesApi'
import { formatMoney } from '@/lib/format'
import { fromCents, toCents } from '@/lib/money'
import { apiErrorMessage } from '@/lib/apiErrors'
import { toast } from '@/components/ui/toast'
import { useCreateGroupBill } from './api'
import {
  canReviewGroupBill,
  newGroupBillLine,
  newGroupBillPatient,
  toCreateGroupBillPayload,
  type GroupBillDraft,
  type GroupBillPatientDraft,
} from './form'

function PatientName({ patientId }: { patientId: string }) {
  const { data: patient } = usePatient(patientId)
  return <>{patient ? `${patient.lastName}, ${patient.firstName}` : patientId}</>
}

function PatientEditor({
  patient,
  payerId,
  onChange,
  onRemove,
}: {
  patient: GroupBillPatientDraft
  payerId: string | null
  onChange: (next: GroupBillPatientDraft) => void
  onRemove: () => void
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Group member</CardTitle>
            <CardDescription>Assign at least one service to this patient.</CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label="Remove group member"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Patient</Label>
          <PatientPicker
            value={patient.patientId}
            onChange={(patientId) => onChange({ ...patient, patientId })}
            placeholder="Search group member…"
            required
          />
        </div>
        <div className="space-y-3 border-t border-border pt-3">
          {patient.items.map((item, index) => (
            <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_5rem_auto] gap-2 items-end">
              <div className="space-y-1.5">
                {index === 0 && <Label>Service</Label>}
                <ServicePicker
                  value={item.serviceId || null}
                  onChange={(serviceId) =>
                    onChange({
                      ...patient,
                      items: patient.items.map((candidate) =>
                        candidate.id === item.id
                          ? { ...candidate, serviceId: serviceId ?? '' }
                          : candidate,
                      ),
                    })
                  }
                  payerId={payerId}
                  required
                />
              </div>
              <div className="space-y-1.5">
                {index === 0 && <Label htmlFor={`group-qty-${item.id}`}>Qty</Label>}
                <Input
                  id={`group-qty-${item.id}`}
                  type="number"
                  min={1}
                  step={1}
                  className="font-mono tabular-nums text-right"
                  value={item.quantity}
                  onChange={(event) => {
                    const quantity = Number(event.target.value)
                    onChange({
                      ...patient,
                      items: patient.items.map((candidate) =>
                        candidate.id === item.id
                          ? { ...candidate, quantity: Number.isFinite(quantity) ? quantity : 0 }
                          : candidate,
                      ),
                    })
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove service"
                disabled={patient.items.length === 1}
                onClick={() =>
                  onChange({
                    ...patient,
                    items: patient.items.filter((candidate) => candidate.id !== item.id),
                  })
                }
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange({ ...patient, items: [...patient.items, newGroupBillLine()] })}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Add service
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function GroupBillReview({ draft }: { draft: GroupBillDraft }) {
  const { data: payerData } = usePayerProfiles('Corporate')
  const { data: services } = useServices('')
  const payer = payerData?.data.find((candidate) => candidate.id === draft.payerId)
  const serviceById = useMemo(
    () => Object.fromEntries((services ?? []).map((service) => [service.id, service])),
    [services],
  )
  const listedSubtotals = draft.patients.map((patient) =>
    patient.items.reduce(
      (sum, item) => sum + toCents(serviceById[item.serviceId]?.basePrice) * item.quantity,
      0,
    ),
  )
  const listedTotal = listedSubtotals.reduce((sum, subtotal) => sum + subtotal, 0)

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTitle>Review before creating the group bill</AlertTitle>
        <AlertDescription>
          Listed subtotals use the current catalog price only. Service prices, contract terms,
          eligibility, taxes, discounts, consent, and the final amount are calculated and enforced
          by the server when this bill is created.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Corporate payer</CardTitle>
          <CardDescription>{payer?.name ?? draft.payerId}</CardDescription>
        </CardHeader>
        {draft.referenceNumber && (
          <CardContent className="pt-0 text-sm">
            Reference <span className="font-mono tabular-nums">{draft.referenceNumber}</span>
          </CardContent>
        )}
      </Card>
      {draft.patients.map((patient, patientIndex) => (
        <Card key={patient.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              <PatientName patientId={patient.patientId!} />
            </CardTitle>
            <CardDescription className="font-mono">{patient.patientId}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {patient.items.map((item) => {
                const service = serviceById[item.serviceId]
                return (
                  <li key={item.id} className="flex items-center justify-between gap-3">
                    <span>{service?.name ?? item.serviceId}</span>
                    <span className="font-mono tabular-nums">
                      ×{item.quantity} ·{' '}
                      {formatMoney(fromCents(toCents(service?.basePrice) * item.quantity))}
                    </span>
                  </li>
                )
              })}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">Listed patient subtotal</span>
              <span className="font-mono tabular-nums font-medium">
                {formatMoney(fromCents(listedSubtotals[patientIndex] ?? 0))}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
      <Card className="border-primary/30">
        <CardContent className="py-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">Listed group total</span>
            <span className="font-mono tabular-nums font-medium">
              {formatMoney(fromCents(listedTotal))}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Catalog listing only; the server-authoritative total may differ after corporate pricing,
            tax, discount, and eligibility checks. This creates one Pending bill by default. No
            payment is posted until the transaction detail records one.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default function GroupBillCreatePage() {
  const navigate = useNavigate()
  const create = useCreateGroupBill()
  const { data: payerData, isLoading: payersLoading } = usePayerProfiles('Corporate')
  const [step, setStep] = useState<'edit' | 'review'>('edit')
  const [dirty, setDirty] = useState(false)
  const [pendingNavPath, setPendingNavPath] = useState<string | null>(null)
  const [draft, setDraft] = useState<GroupBillDraft>({
    payerId: null,
    referenceNumber: '',
    patients: [newGroupBillPatient(), newGroupBillPatient()],
  })

  const corporatePayers = (payerData?.data ?? []).filter((payer) => payer.isActive)
  const reviewReady = canReviewGroupBill(draft)
  const updateDraft = (next: GroupBillDraft) => {
    setDraft(next)
    setDirty(true)
  }

  // DirtyFormGuard reads the previous render during synchronous navigation.
  // Redirect only after the successful commit has rendered dirty=false.
  useEffect(() => {
    if (!dirty && pendingNavPath) {
      const target = pendingNavPath
      setPendingNavPath(null)
      navigate(target)
    }
  }, [dirty, navigate, pendingNavPath])

  async function createGroupBill() {
    try {
      const result = await create.mutateAsync(toCreateGroupBillPayload(draft))
      setDirty(false)
      toast(result.idempotentReplay ? 'Group bill already created' : 'Group bill created', {
        description: result.status ? `${result.id} · ${result.status}` : result.id,
      })
      setPendingNavPath(`/group-bills?selected=${encodeURIComponent(result.id)}`)
    } catch (error) {
      toast.error('Failed to create group bill', { description: apiErrorMessage(error) })
    }
  }

  return (
    <div className="h-full flex flex-col">
      <DirtyFormGuard when={dirty} />
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title={step === 'review' ? 'Review group bill' : 'New corporate group bill'}
          description={
            step === 'review'
              ? 'Confirm the grouped patients and services before creating the bill.'
              : 'One corporate payer, two to twenty patients, and one pending bill.'
          }
          actions={
            <>
              <Button asChild variant="outline" size="sm">
                <Link to="/group-bills">Cancel</Link>
              </Button>
              {step === 'review' ? (
                <Button
                  size="sm"
                  onClick={() => void createGroupBill()}
                  disabled={create.isPending}
                >
                  {create.isPending ? 'Creating…' : 'Create pending group bill'}
                </Button>
              ) : (
                <Button size="sm" onClick={() => setStep('review')} disabled={!reviewReady}>
                  Review group bill
                </Button>
              )}
            </>
          }
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl px-4 sm:px-6 xl:px-8 2xl:px-10 py-5 space-y-4 pb-28">
          {step === 'review' ? (
            <GroupBillReview draft={draft} />
          ) : (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Corporate payer</CardTitle>
                  <CardDescription>
                    Required. The payer is attached to the group bill and its later payment.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="group-bill-payer">Payer</Label>
                    <Select
                      value={draft.payerId ?? ''}
                      onValueChange={(payerId) => updateDraft({ ...draft, payerId })}
                    >
                      <SelectTrigger id="group-bill-payer">
                        <SelectValue
                          placeholder={
                            payersLoading ? 'Loading payers…' : 'Select corporate payer…'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {corporatePayers.map((payer) => (
                          <SelectItem key={payer.id} value={payer.id}>
                            {payer.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="group-bill-reference">Reference</Label>
                    <Input
                      id="group-bill-reference"
                      value={draft.referenceNumber}
                      placeholder="PO, LOA, or batch reference"
                      onChange={(event) =>
                        updateDraft({ ...draft, referenceNumber: event.target.value })
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Patients and services</h2>
                  <p className="text-xs text-muted-foreground">
                    Every group member needs at least one assigned service.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={draft.patients.length >= 20}
                  onClick={() =>
                    updateDraft({ ...draft, patients: [...draft.patients, newGroupBillPatient()] })
                  }
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Add patient
                </Button>
              </div>
              {draft.patients.map((patient) => (
                <PatientEditor
                  key={patient.id}
                  patient={patient}
                  payerId={draft.payerId}
                  onChange={(next) =>
                    updateDraft({
                      ...draft,
                      patients: draft.patients.map((candidate) =>
                        candidate.id === patient.id ? next : candidate,
                      ),
                    })
                  }
                  onRemove={() =>
                    updateDraft({
                      ...draft,
                      patients: draft.patients.filter((candidate) => candidate.id !== patient.id),
                    })
                  }
                />
              ))}
              {!reviewReady && (
                <p className="text-xs text-muted-foreground">
                  Select an active corporate payer, then assign a distinct patient and at least one
                  service to every row before review.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-border bg-card px-4 sm:px-6 xl:px-8 2xl:px-10 py-3">
        <div className="max-w-4xl mx-auto flex justify-end gap-2">
          {step === 'review' && (
            <Button variant="outline" onClick={() => setStep('edit')} disabled={create.isPending}>
              Back to edit
            </Button>
          )}
          {step === 'review' ? (
            <Button onClick={() => void createGroupBill()} disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create pending group bill'}
            </Button>
          ) : (
            <Button onClick={() => setStep('review')} disabled={!reviewReady}>
              Review group bill
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
