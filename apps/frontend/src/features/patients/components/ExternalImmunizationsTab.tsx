import { useState } from 'react'
import { AlertCircle, Plus, Syringe } from 'lucide-react'
import { apiErrorMessage } from '@/lib/apiErrors'
import {
  useExternalImmunizations,
  useAddExternalImmunization,
  useVerifyExternalImmunization,
  type AddExternalImmunizationInput,
  type ExternalImmunization,
} from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog'
import { useAuth } from '@/features/auth/context'
import AdministeredByField, {
  isAdministeredByComplete,
  type AdministeredByValue,
} from '@/features/scheduled-orders/components/AdministeredByField'

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-PH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

type Props = {
  patientId: string
  isCrossBranch?: boolean
}

const EMPTY_FORM: AddExternalImmunizationInput = {
  vaccineName: '',
  cvxCode: '',
  manufacturer: '',
  lotNumber: '',
  administeredDate: '',
  administeredAtFacility: '',
  source: 'PatientReported',
}

export default function ExternalImmunizationsTab({ patientId, isCrossBranch = false }: Props) {
  const { data, isLoading, isError } = useExternalImmunizations(patientId)
  const addMutation = useAddExternalImmunization(patientId)
  const verifyMutation = useVerifyExternalImmunization(patientId)
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<AddExternalImmunizationInput>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [verifyTarget, setVerifyTarget] = useState<ExternalImmunization | null>(null)
  const [reviewer, setReviewer] = useState<AdministeredByValue>({
    administeredById: null,
    attestationPin: null,
  })
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [evidenceReviewed, setEvidenceReviewed] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.vaccineName.trim() || !form.administeredDate.trim()) {
      setFormError('Vaccine name and date administered are required.')
      return
    }
    const payload: AddExternalImmunizationInput = {
      vaccineName: form.vaccineName.trim(),
      administeredDate: form.administeredDate.trim(),
      source: form.source,
      ...(form.cvxCode?.trim() ? { cvxCode: form.cvxCode.trim() } : {}),
      ...(form.manufacturer?.trim() ? { manufacturer: form.manufacturer.trim() } : {}),
      ...(form.lotNumber?.trim() ? { lotNumber: form.lotNumber.trim() } : {}),
      ...(form.administeredAtFacility?.trim()
        ? { administeredAtFacility: form.administeredAtFacility.trim() }
        : {}),
    }
    addMutation.mutate(payload, {
      onSuccess: () => {
        setOpen(false)
        setForm(EMPTY_FORM)
      },
      onError: (err) => setFormError(apiErrorMessage(err)),
    })
  }

  async function verifyEvidence() {
    if (!verifyTarget || !evidenceReviewed || !isAdministeredByComplete(reviewer, user?.role))
      return
    setVerifyError(null)
    try {
      await verifyMutation.mutateAsync({
        immunizationId: verifyTarget.id,
        ...(reviewer.administeredById
          ? {
              reviewedById: reviewer.administeredById,
              attestationPin: reviewer.attestationPin ?? undefined,
            }
          : {}),
      })
      setVerifyTarget(null)
      setReviewer({ administeredById: null, attestationPin: null })
    } catch (error) {
      setVerifyError(apiErrorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.length} record${data.length !== 1 ? 's' : ''}` : ''}
        </p>
        {!isCrossBranch && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus className="h-4 w-4" aria-hidden />
                Add record
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm xl:max-w-md">
              <DialogHeader>
                <DialogTitle>Add external immunization</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-3 mt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ei-vaccine">Vaccine name *</Label>
                  <Input
                    id="ei-vaccine"
                    value={form.vaccineName}
                    onChange={(e) => setForm((f) => ({ ...f, vaccineName: e.target.value }))}
                    placeholder="e.g. Hepatitis B"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ei-code">CVX code</Label>
                  <Input
                    id="ei-code"
                    value={form.cvxCode ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, cvxCode: e.target.value }))}
                    placeholder="CVX or local code (optional)"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ei-date">Date administered *</Label>
                  <Input
                    id="ei-date"
                    type="date"
                    value={form.administeredDate}
                    onChange={(e) => setForm((f) => ({ ...f, administeredDate: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ei-facility">Administered at facility</Label>
                  <Input
                    id="ei-facility"
                    value={form.administeredAtFacility ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, administeredAtFacility: e.target.value }))
                    }
                    placeholder="Clinic or facility name (optional)"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ei-manufacturer">Manufacturer</Label>
                  <Input
                    id="ei-manufacturer"
                    value={form.manufacturer ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, manufacturer: e.target.value }))}
                    placeholder="e.g. Sanofi (optional)"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ei-lot">Lot number</Label>
                  <Input
                    id="ei-lot"
                    value={form.lotNumber ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, lotNumber: e.target.value }))}
                    placeholder="optional"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ei-source">
                    Source <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.source}
                    onValueChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        source: v as AddExternalImmunizationInput['source'],
                      }))
                    }
                  >
                    <SelectTrigger id="ei-source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PatientReported">Patient reported</SelectItem>
                      <SelectItem value="RecordsTransfer">Records transfer</SelectItem>
                      <SelectItem value="IIS">IIS / registry</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {formError && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                    {formError}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <DialogClose asChild>
                    <Button type="button" variant="outline" size="sm">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button type="submit" size="sm" disabled={addMutation.isPending}>
                    {addMutation.isPending ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" aria-hidden />
          Failed to load immunization records.
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No external immunization records.</p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {data.map((imm) => (
            <li key={imm.id} className="flex items-start gap-3 px-3 py-3">
              <Syringe className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{imm.vaccineName}</span>
                  {imm.cvxCode && (
                    <Badge variant="outline" className="text-xs font-mono">
                      {imm.cvxCode}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-xs">
                    {imm.source === 'PatientReported'
                      ? 'Patient reported'
                      : imm.source === 'RecordsTransfer'
                        ? 'Records transfer'
                        : 'IIS'}
                  </Badge>
                  <Badge variant={imm.verifiedAt ? 'ok' : 'due'} className="text-xs">
                    {imm.verifiedAt ? 'Evidence verified' : 'Needs verification'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground font-mono tabular-nums">
                  {imm.administeredDate ? fmtDate(imm.administeredDate) : 'Date unknown'}
                  {imm.administeredDatePrecision === 'Estimated' ? ' · estimated' : ''}
                </p>
                {imm.administeredAtFacility && (
                  <p className="text-xs text-muted-foreground">{imm.administeredAtFacility}</p>
                )}
                {(imm.manufacturer || imm.lotNumber) && (
                  <p className="text-xs text-muted-foreground">
                    {[imm.manufacturer, imm.lotNumber ? `Lot ${imm.lotNumber}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {imm.verifiedAt && (
                  <div className="text-xs text-muted-foreground">
                    <p className="font-mono tabular-nums">Verified {fmtDate(imm.verifiedAt)}</p>
                    {imm.verifiedBy && (
                      <p>
                        By {imm.verifiedBy.fullName}
                        {imm.verifiedBy.licenseNumber ? ` · ${imm.verifiedBy.licenseNumber}` : ''}
                      </p>
                    )}
                  </div>
                )}
              </div>
              {!isCrossBranch && !imm.verifiedAt && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setVerifyError(null)
                    setReviewer({ administeredById: null, attestationPin: null })
                    setEvidenceReviewed(false)
                    setVerifyTarget(imm)
                  }}
                >
                  Verify evidence
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={!!verifyTarget}
        onOpenChange={(next) => {
          if (!next && !verifyMutation.isPending) setVerifyTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md xl:max-w-lg">
          <DialogHeader>
            <DialogTitle>Verify external immunization evidence</DialogTitle>
          </DialogHeader>
          {verifyTarget && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 px-3 py-3 text-sm">
                <p className="font-medium">{verifyTarget.vaccineName}</p>
                <p className="text-xs text-muted-foreground font-mono tabular-nums">
                  {verifyTarget.administeredDate
                    ? fmtDate(verifyTarget.administeredDate)
                    : 'Date unknown'}{' '}
                  · {verifyTarget.source}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Compare the entered date, vaccine, and source with the available source evidence.
                Verification records that review; it does not administer a dose, prove that the dose
                occurred, or alter the active schedule.
              </p>
              <div className="flex items-start gap-3 rounded-md border px-3 py-3">
                <Checkbox
                  id="external-evidence-reviewed"
                  checked={evidenceReviewed}
                  onCheckedChange={(checked) => setEvidenceReviewed(checked === true)}
                  className="mt-0.5"
                />
                <Label
                  htmlFor="external-evidence-reviewed"
                  className="cursor-pointer text-sm leading-snug"
                >
                  I reviewed the available source evidence and the details above match it
                </Label>
              </div>
              <AdministeredByField
                value={reviewer}
                onChange={setReviewer}
                disabled={verifyMutation.isPending}
                validationError={verifyError}
                purpose="clinical-review"
              />
              {verifyError && <p className="text-sm text-destructive">{verifyError}</p>}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setVerifyTarget(null)}
                  disabled={verifyMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void verifyEvidence()}
                  disabled={
                    verifyMutation.isPending ||
                    !evidenceReviewed ||
                    !isAdministeredByComplete(reviewer, user?.role)
                  }
                >
                  {verifyMutation.isPending ? 'Verifying…' : 'Confirm verification'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
