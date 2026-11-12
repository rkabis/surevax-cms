import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { paymentMethodSchema } from '@surevax/shared'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
import { useCorrectPaymentMethod, ApiError } from '../api'
import { useSafeForm } from '@/lib/useSafeForm'
import { useAuth } from '@/features/auth/context'
import StaffAttestationField, {
  isStaffAttestationComplete,
  STAFF_ATTESTATION_ERROR_MESSAGES,
  type StaffAttestationValue,
} from './StaffAttestationField'

const PAYMENT_METHODS = paymentMethodSchema.options

// Mirrors the backend's correctPaymentMethodBodySchema
// (apps/backend/src/modules/transactions/contract.ts). Unlike addPaymentSchema
// and transactionReasonSchema, there is no shared @surevax/shared schema for
// this body shape yet, so this is defined locally.
const schema = z.object({
  newMethod: paymentMethodSchema,
  newReferenceNumber: z.string().max(120).optional().or(z.literal('')),
  reason: z
    .string()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Maximum 500 characters'),
})
type FormValues = z.infer<typeof schema>

/**
 * Inline copy for error codes. The approval gate this used to handle
 * (`APPROVAL_REQUIRED`) was removed from corrections on the backend, so that
 * branch and its `/admin/approvals` link are gone; the attestation codes are
 * shared with every other money surface via `StaffAttestationField`.
 */
const CODE_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'This payment could not be found. It may have already been corrected or removed.',
  INVALID_STATE: 'This transaction is voided or refunded and its payments cannot be corrected.',
  ALREADY_VOIDED:
    'This payment has already been corrected. Refresh the transaction to see the replacement.',
  CREDIT_NOT_CORRECTABLE:
    'This payment was drawn from patient credit and cannot be corrected here.',
  PAYMENT_RECEIVER_UNKNOWN:
    'This legacy payment has no accountable receiver on record. Ask a Tenant Admin to document and repair the attribution before correcting it.',
  NO_CHANGE: 'That matches the current method and reference already. There is nothing to correct.',
  ...STAFF_ATTESTATION_ERROR_MESSAGES,
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  transactionId: string
  paymentId: string
  /** Current method, shown as read-only context and used as the form default. */
  currentMethod: string
  /** Current reference number, pre-filled so a method-only fix cannot drop it. */
  currentReferenceNumber: string | null
  /** Payment amount, shown as read-only context. */
  amount: string
}

export default function CorrectPaymentMethodDialog({
  open,
  onOpenChange,
  transactionId,
  paymentId,
  currentMethod,
  currentReferenceNumber,
  amount,
}: Props) {
  const correctMethod = useCorrectPaymentMethod()
  const { user } = useAuth()
  const [formError, setFormError] = useState<string | null>(null)
  const [attestation, setAttestation] = useState<StaffAttestationValue>({
    attestedById: null,
    attestationPin: null,
  })

  // Seed the form with what the payment ALREADY is, never a fixed 'Cash'.
  // Two reasons, both money-affecting:
  //  - the backend omits the gate on non-Cash → Cash, so a stale 'Cash'
  //    default turns a misclick into an ungated reclassification into the
  //    drawer;
  //  - an omitted reference is written as NULL, so a blank field would
  //    silently drop the reconciliation key on a method-only correction.
  // Submitting the form untouched now yields NO_CHANGE, which is correct.
  const parsedMethod = paymentMethodSchema.safeParse(currentMethod)
  const initial: FormValues = {
    newMethod: parsedMethod.success ? parsedMethod.data : 'Cash',
    newReferenceNumber: currentReferenceNumber ?? '',
    reason: '',
  }

  const form = useSafeForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  })

  useEffect(() => {
    if (open) {
      form.reset(initial)
      setFormError(null)
      setAttestation({ attestedById: null, attestationPin: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentMethod, currentReferenceNumber])

  const selectedMethod = form.watch('newMethod')
  const attestationComplete = isStaffAttestationComplete(attestation, user?.role)

  async function onSubmit(values: FormValues) {
    setFormError(null)
    try {
      await correctMethod.mutateAsync({
        transactionId,
        paymentId,
        newMethod: values.newMethod,
        newReferenceNumber: values.newReferenceNumber || undefined,
        reason: values.reason,
        ...(attestation.attestedById
          ? {
              attestedById: attestation.attestedById,
              attestationPin: attestation.attestationPin ?? '',
            }
          : {}),
      })
      toast('Payment method corrected', {
        description: `${currentMethod} → ${values.newMethod}`,
      })
      onOpenChange(false)
    } catch (err) {
      const codeMessage = err instanceof ApiError && err.code ? CODE_MESSAGES[err.code] : undefined
      if (codeMessage) {
        setFormError(codeMessage)
        return
      }
      toast.error('Failed to correct payment method', { description: apiErrorMessage(err) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md xl:max-w-lg">
        <DialogHeader>
          <DialogTitle>Correct payment method</DialogTitle>
          <DialogDescription>
            The original payment is kept as a record and a corrected payment is recorded in its
            place. Nothing else about this bill changes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
          {formError && (
            <Alert variant="destructive">
              <AlertTitle>Can&rsquo;t correct this payment</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-border bg-muted/30 p-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Amount</p>
              <p className="font-mono">{formatMoney(amount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Current method</p>
              <p>{currentMethod === 'BankTransfer' ? 'Bank Transfer' : currentMethod}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newMethod">
              New method <span className="text-destructive">*</span>
            </Label>
            <Select
              value={selectedMethod}
              onValueChange={(v) => form.setValue('newMethod', v as FormValues['newMethod'])}
            >
              <SelectTrigger id="newMethod">
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
            <Label htmlFor="newReferenceNumber">Reference number</Label>
            <Input
              id="newReferenceNumber"
              placeholder="e.g. GCash ref, OR #"
              {...form.register('newReferenceNumber')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reason"
              rows={3}
              placeholder="Why is this payment's method being corrected?"
              {...form.register('reason')}
            />
            {form.formState.errors.reason && (
              <p className="text-xs text-destructive">{form.formState.errors.reason.message}</p>
            )}
          </div>
          <StaffAttestationField
            value={attestation}
            onChange={setAttestation}
            disabled={correctMethod.isPending}
            actionLabel="Correcting this payment"
            resetToken={open}
            validationError={formError}
          />
          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={correctMethod.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={correctMethod.isPending || !attestationComplete}>
              {correctMethod.isPending ? 'Correcting…' : 'Correct method'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
