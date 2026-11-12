import { useEffect, useState } from 'react'
import { useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { addPaymentSchema, type PaymentInput, paymentMethodSchema } from '@surevax/shared'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { formatMoney } from '@/lib/format'
import { toCents, fromCents } from '@/lib/money'
import { useAddPayment, useAddPayments, ApiError } from '../api'
import { usePayerProfiles } from '@/features/admin/payerProfilesApi'
import { useSafeForm } from '@/lib/useSafeForm'
import { useAuth } from '@/features/auth/context'
import StaffAttestationField, {
  isStaffAttestationComplete,
  STAFF_ATTESTATION_ERROR_MESSAGES,
  type StaffAttestationValue,
} from './StaffAttestationField'
import { newSplitLeg, SplitTenderEditor, type SplitLeg } from './SplitTenderEditor'

const PAYMENT_METHODS = paymentMethodSchema.options

/** Methods that require a payer-profile selection */
const PAYER_METHODS = new Set<string>(['HMO', 'Corporate'])

// Schema sourced from @surevax/shared — extended with a front-end refine
// that requires payerId when method is HMO or Corporate (FE-6).
// The base schema allows payerId to be empty; this tightens it for the UI.
const schema = addPaymentSchema.superRefine((val, ctx) => {
  if (PAYER_METHODS.has(val.method) && !val.payerId) {
    ctx.addIssue({
      code: 'custom',
      path: ['payerId'],
      message: `A payer profile is required for ${val.method} payments`,
    })
  }
})
type FormValues = PaymentInput

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  transactionId: string
  /** Suggested default amount (typically the unpaid balance). */
  defaultAmount?: string
  /**
   * Outstanding balance for the transaction. When provided, the dialog caps the
   * amount at this value (MONEY-5: a payment records the amount applied to the
   * bill, not cash tendered — change due is a drawer concern). The backend is
   * the source of truth and rejects overpayment with 422; this is the
   * fast-feedback mirror so the operator can't submit an impossible amount.
   */
  outstanding?: string
}

export default function AddPaymentDialog({
  open,
  onOpenChange,
  transactionId,
  defaultAmount,
  outstanding,
}: Props) {
  const addPayment = useAddPayment()
  const addPayments = useAddPayments()
  const { user } = useAuth()
  const [attestation, setAttestation] = useState<StaffAttestationValue>({
    attestedById: null,
    attestationPin: null,
  })
  const [attestationError, setAttestationError] = useState<string | null>(null)
  const [splitMode, setSplitMode] = useState(false)
  const [splitLegs, setSplitLegs] = useState<SplitLeg[]>([])
  const form = useSafeForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      method: 'Cash',
      amount: defaultAmount ?? '',
      referenceNumber: '',
      payerId: '',
      notes: '',
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        method: 'Cash',
        amount: defaultAmount ?? '',
        referenceNumber: '',
        payerId: '',
        notes: '',
      })
      setAttestation({ attestedById: null, attestationPin: null })
      setAttestationError(null)
      setSplitMode(false)
      setSplitLegs([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultAmount])

  const selectedMethod = useWatch({ control: form.control, name: 'method' })
  const selectedPayerId = useWatch({ control: form.control, name: 'payerId' })
  const amountValue = useWatch({ control: form.control, name: 'amount' })
  const showPayerField = PAYER_METHODS.has(selectedMethod)

  // MONEY-5 cap-and-reject (client mirror). null when no balance was supplied.
  const outstandingCents = outstanding != null ? toCents(outstanding) : null
  const overpays = outstandingCents != null && toCents(amountValue ?? '') > outstandingCents
  const splitTarget = outstanding ?? defaultAmount ?? '0.00'
  const splitTargetCents = toCents(splitTarget)
  const splitAllocatedCents = splitLegs.reduce(
    (sum, leg) => sum + Math.max(0, toCents(leg.amount || '0')),
    0,
  )
  const splitInvalid =
    splitLegs.length < 2 ||
    splitLegs.some((leg) => toCents(leg.amount || '0') <= 0) ||
    splitAllocatedCents > splitTargetCents
  const submitting = addPayment.isPending || addPayments.isPending

  const { data: payerData } = usePayerProfiles(
    showPayerField ? (selectedMethod as 'HMO' | 'Corporate') : undefined,
  )
  const payers = payerData?.data ?? []

  async function onSubmit(values: FormValues) {
    // Defense-in-depth: the submit button is disabled while over, but guard the
    // handler too so a keyboard submit can't slip an overpayment past the UI.
    if (outstandingCents != null && toCents(values.amount) > outstandingCents) return
    setAttestationError(null)
    try {
      await addPayment.mutateAsync({
        transactionId,
        method: values.method,
        amount: values.amount,
        referenceNumber: values.referenceNumber || undefined,
        payerId: values.payerId || undefined,
        notes: values.notes || undefined,
        ...(attestation.attestedById
          ? {
              attestedById: attestation.attestedById,
              attestationPin: attestation.attestationPin ?? '',
            }
          : {}),
      })
      toast('Payment recorded', { description: `${values.method} · ${formatMoney(values.amount)}` })
      onOpenChange(false)
    } catch (err) {
      const attestationMessage =
        err instanceof ApiError && err.code ? STAFF_ATTESTATION_ERROR_MESSAGES[err.code] : undefined
      if (attestationMessage) {
        setAttestationError(attestationMessage)
        return
      }
      toast.error('Failed to record payment', { description: apiErrorMessage(err) })
    }
  }

  async function onSubmitSplit() {
    if (splitInvalid) return
    setAttestationError(null)
    try {
      await addPayments.mutateAsync({
        transactionId,
        payments: splitLegs.map((leg) => ({
          method: leg.method,
          amount: leg.amount,
          referenceNumber: leg.reference.trim() || undefined,
        })),
        ...(attestation.attestedById
          ? {
              attestedById: attestation.attestedById,
              attestationPin: attestation.attestationPin ?? '',
            }
          : {}),
      })
      toast('Split payment recorded', {
        description: `${formatMoney(fromCents(splitAllocatedCents))} · ${splitLegs
          .map((leg) => leg.method)
          .join(' + ')}`,
      })
      onOpenChange(false)
    } catch (err) {
      const attestationMessage =
        err instanceof ApiError && err.code ? STAFF_ATTESTATION_ERROR_MESSAGES[err.code] : undefined
      if (attestationMessage) {
        setAttestationError(attestationMessage)
        return
      }
      toast.error('Failed to record split payment', { description: apiErrorMessage(err) })
    }
  }

  function handleSplitModeChange(next: boolean) {
    setSplitMode(next)
    if (next && splitLegs.length === 0) {
      setSplitLegs([newSplitLeg(splitTarget)])
    }
  }

  const attestationComplete = isStaffAttestationComplete(attestation, user?.role)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md xl:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Record a payment against transaction <span className="font-mono">{transactionId}</span>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          <div className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
            <Checkbox
              id="add-payment-split"
              checked={splitMode}
              onCheckedChange={(checked) => handleSplitModeChange(checked === true)}
              disabled={submitting || splitTargetCents <= 0}
            />
            <Label htmlFor="add-payment-split" className="cursor-pointer font-normal leading-snug">
              Split tender across multiple payment methods
            </Label>
          </div>
          {splitMode ? (
            <>
              <SplitTenderEditor legs={splitLegs} onChange={setSplitLegs} netAmount={splitTarget} />
              <p className="text-xs text-muted-foreground">
                Commit effect: creates {splitLegs.length} payment records atomically. If any leg
                fails validation, none are posted.
              </p>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="method">
                  Method <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={selectedMethod}
                  onValueChange={(v) => {
                    form.setValue('method', v as FormValues['method'])
                    // Clear payer when switching away from HMO/Corporate
                    if (!PAYER_METHODS.has(v)) {
                      form.setValue('payerId', '')
                    }
                  }}
                >
                  <SelectTrigger id="method">
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m === 'BankTransfer' ? 'Bank Transfer' : m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="amount">
                  Amount <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  {...form.register('amount')}
                />
                {form.formState.errors.amount && (
                  <p className="text-xs text-destructive">{form.formState.errors.amount.message}</p>
                )}
                {outstanding != null &&
                  (overpays ? (
                    <p className="text-xs text-destructive">
                      Amount exceeds the outstanding balance of{' '}
                      <span className="tabular-nums">{formatMoney(outstanding)}</span>. Record at
                      most that amount.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Outstanding balance:{' '}
                      <span className="tabular-nums">{formatMoney(outstanding)}</span>
                    </p>
                  ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="referenceNumber">Reference number</Label>
                <Input
                  id="referenceNumber"
                  placeholder="e.g. GCash ref, OR #"
                  {...form.register('referenceNumber')}
                />
              </div>
              {showPayerField && (
                <div className="space-y-1.5">
                  <Label htmlFor="payerId">
                    Payer ({selectedMethod}) <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={selectedPayerId ?? ''}
                    onValueChange={(v) => form.setValue('payerId', v, { shouldValidate: true })}
                  >
                    <SelectTrigger id="payerId">
                      <SelectValue placeholder="Select payer profile…" />
                    </SelectTrigger>
                    <SelectContent>
                      {payers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.formState.errors.payerId && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.payerId.message}
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" rows={2} {...form.register('notes')} />
              </div>
            </>
          )}
          <StaffAttestationField
            value={attestation}
            onChange={setAttestation}
            disabled={submitting}
            resetToken={open}
            validationError={attestationError}
          />
          {attestationError && <p className="text-xs text-destructive">{attestationError}</p>}
          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type={splitMode ? 'button' : 'submit'}
              onClick={splitMode ? onSubmitSplit : undefined}
              disabled={submitting || (splitMode ? splitInvalid : overpays) || !attestationComplete}
            >
              {submitting
                ? 'Recording…'
                : splitMode
                  ? `Record ${splitLegs.length} payments`
                  : 'Record payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
