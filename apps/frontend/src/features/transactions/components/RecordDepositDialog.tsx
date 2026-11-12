import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
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
import { toast } from '@/components/ui/toast'
import { ApiError } from '@/lib/apiFetch'
import { apiErrorMessage } from '@/lib/apiErrors'
import { formatMoney } from '@/lib/format'
import { toCents } from '@/lib/money'
import { PatientPicker } from '@/components/forms'
import { useCreateTransaction, type PaymentMethod } from '../api'
import StaffAttestationField, {
  isStaffAttestationComplete,
  STAFF_ATTESTATION_ERROR_MESSAGES,
  type StaffAttestationValue,
} from './StaffAttestationField'
import { useAuth } from '@/features/auth/context'

// Direct (non-payer) tender methods — a deposit is cash received now.
const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'Cash', label: 'Cash' },
  { value: 'GCash', label: 'GCash' },
  { value: 'Maya', label: 'Maya' },
  { value: 'BankTransfer', label: 'Bank transfer' },
  { value: 'Card', label: 'Card' },
]

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optional fixed patient (PAT_…) — hides the picker when provided. */
  patientId?: string
  patientName?: string
}

export default function RecordDepositDialog({
  open,
  onOpenChange,
  patientId: fixedPatientId,
  patientName,
}: Props) {
  const create = useCreateTransaction()
  const { user } = useAuth()
  const [attestation, setAttestation] = useState<StaffAttestationValue>({
    attestedById: null,
    attestationPin: null,
  })
  const [patientId, setPatientId] = useState<string | null>(fixedPatientId ?? null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('Cash')
  const [attestationError, setAttestationError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPatientId(fixedPatientId ?? null)
      setAmount('')
      setMethod('Cash')
      setAttestationError(null)
    }
  }, [open, fixedPatientId])

  const amountCents = toCents(amount || '0')
  const amountValid = amountCents > 0
  const canSubmit =
    !!patientId &&
    amountValid &&
    !create.isPending &&
    // A deposit is money physically handed over, so it attests like any other
    // tender: the backend refuses an unattested one on the shared Branch kiosk.
    isStaffAttestationComplete(attestation, user?.role)

  async function onSubmit() {
    if (!patientId || !amountValid) return
    setAttestationError(null)
    const depositAmount = (amountCents / 100).toFixed(2)
    try {
      await create.mutateAsync({
        patientId,
        isPrepayment: true,
        depositAmount,
        items: [],
        payment: { method, amount: depositAmount },
        ...(attestation.attestedById
          ? {
              attestedById: attestation.attestedById,
              attestationPin: attestation.attestationPin ?? '',
            }
          : {}),
      })
      toast('Deposit recorded', {
        description: `${formatMoney(depositAmount)} · ${method} · held as patient credit`,
      })
      onOpenChange(false)
    } catch (err) {
      const attestationMessage =
        err instanceof ApiError && err.code ? STAFF_ATTESTATION_ERROR_MESSAGES[err.code] : undefined
      if (attestationMessage) {
        setAttestationError(attestationMessage)
        return
      }
      toast.error('Failed to record deposit', { description: apiErrorMessage(err) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record deposit</DialogTitle>
          <DialogDescription>
            Take an advance payment held as patient credit. Draw it down later against any bill via
            &ldquo;Apply patient credit&rdquo;. This records an acknowledgement of patient credit;
            it does not mark a service as rendered.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {fixedPatientId ? (
            <div className="space-y-1.5">
              <Label>Patient</Label>
              <p className="text-sm">
                {patientName ?? fixedPatientId}{' '}
                <span className="font-mono text-xs text-muted-foreground">{fixedPatientId}</span>
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>
                Patient <span className="text-destructive">*</span>
              </Label>
              <PatientPicker value={patientId} onChange={setPatientId} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="deposit-amount">
              Amount <span className="text-destructive">*</span>
            </Label>
            <Input
              id="deposit-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="deposit-method">
              Method <span className="text-destructive">*</span>
            </Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger id="deposit-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <StaffAttestationField
          value={attestation}
          onChange={setAttestation}
          disabled={create.isPending}
          resetToken={open}
          validationError={attestationError}
        />
        {attestationError && <p className="text-xs text-destructive">{attestationError}</p>}

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {create.isPending ? 'Recording…' : 'Record deposit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
