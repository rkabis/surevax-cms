import { useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { ApiError } from '@/lib/apiFetch'
import { formatMoney, formatDate } from '@/lib/format'
import { toCents, fromCents } from '@/lib/money'
import { usePatientBalance } from '@/features/patients/accountApi'
import { useAuth } from '@/features/auth/context'
import { usePayOnAccount } from '../api'
import { planAllocation } from '../allocate'
import StaffAttestationField, {
  isStaffAttestationComplete,
  STAFF_ATTESTATION_ERROR_MESSAGES,
  type StaffAttestationValue,
} from './StaffAttestationField'
import { newSplitLeg, SplitTenderEditor, type SplitLeg } from './SplitTenderEditor'

// Direct (non-payer) tender methods. HMO/Corporate need a payer profile and
// belong on the full cashier flow, not the quick pay-on-account panel.
const METHODS: { value: string; label: string }[] = [
  { value: 'Cash', label: 'Cash' },
  { value: 'GCash', label: 'GCash' },
  { value: 'Maya', label: 'Maya' },
  { value: 'BankTransfer', label: 'Bank transfer' },
  { value: 'Card', label: 'Card' },
]

export interface PayBalancePanelProps {
  patientId: string
  patientName?: string
  onClose: () => void
  onSuccess?: () => void
}

/**
 * Pay-on-account flow content: position summary, tender fields, an always-on
 * allocation preview (oldest bill first), and an inline overage disclosure
 * when the tender exceeds the outstanding balance. Surface-agnostic:
 * hosted by `PayBalanceDialog` (modal) and rendered inline in a patient
 * detail rail. Optional split tender uses the same editor and remains off by
 * default for the common single-method collection path.
 */
export function PayBalancePanel({
  patientId,
  patientName,
  onClose,
  onSuccess,
}: PayBalancePanelProps) {
  const balanceQuery = usePatientBalance(patientId)
  const payOnAccount = usePayOnAccount()
  const { user } = useAuth()

  const [method, setMethod] = useState('Cash')
  const [amount, setAmount] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [splitMode, setSplitMode] = useState(false)
  const [splitLegs, setSplitLegs] = useState<SplitLeg[]>([])
  const [attestation, setAttestation] = useState<StaffAttestationValue>({
    attestedById: null,
    attestationPin: null,
  })
  const [attestationError, setAttestationError] = useState<string | null>(null)
  const attestationComplete = isStaffAttestationComplete(attestation, user?.role)

  const balance = balanceQuery.data
  const submitting = payOnAccount.isPending

  const splitAllocatedCents = splitLegs.reduce(
    (sum, leg) => sum + Math.max(0, toCents(leg.amount || '0')),
    0,
  )
  const amountCents = splitMode ? splitAllocatedCents : toCents(amount || '0')
  const amountValid = splitMode
    ? splitLegs.length >= 2 && splitLegs.every((leg) => toCents(leg.amount || '0') > 0)
    : amountCents > 0
  const amountStr = fromCents(amountCents)

  const plan = useMemo(
    () => planAllocation(balance?.openBills ?? [], amountValid ? amountStr : '0.00'),
    [balance?.openBills, amountValid, amountStr],
  )
  const hasOverage = toCents(plan.overage) > 0
  const canSubmit = !!balance && amountValid && !submitting && attestationComplete

  function onFullBalance() {
    if (!balance) return
    if (splitMode) setSplitLegs([newSplitLeg(balance.grossOutstanding)])
    else setAmount(balance.grossOutstanding)
  }

  function handleSplitModeChange(next: boolean) {
    setSplitMode(next)
    if (next && splitLegs.length === 0) {
      setSplitLegs([newSplitLeg(balance?.grossOutstanding ?? amount)])
    }
  }

  async function onSubmit() {
    if (!balance || !amountValid) return
    setAttestationError(null)
    try {
      const result = await payOnAccount.mutateAsync({
        patientId,
        ...(splitMode
          ? {
              payments: splitLegs.map((leg) => ({
                method: leg.method,
                amount: leg.amount,
                referenceNumber: leg.reference.trim() || undefined,
              })),
            }
          : {
              method,
              amount: amountStr,
              referenceNumber: referenceNumber || undefined,
            }),
        allowCredit: hasOverage,
        ...(attestation.attestedById
          ? {
              attestedById: attestation.attestedById,
              attestationPin: attestation.attestationPin ?? '',
            }
          : {}),
      })
      const settledCount = result.allocations.filter((a) => a.status === 'Paid').length
      const creditedCents = toCents(result.creditedAmount)
      toast('Payment recorded', {
        description: `${formatMoney(result.appliedAmount)} · ${
          splitMode ? splitLegs.map((leg) => leg.method).join(' + ') : method
        }${
          settledCount > 0 ? ` · ${settledCount} bill${settledCount === 1 ? '' : 's'} settled` : ''
        }${creditedCents > 0 ? ` · ${formatMoney(result.creditedAmount)} banked as credit` : ''}`,
      })
      onSuccess?.()
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'OVERPAYMENT_NOT_ALLOWED') {
        toast.error('Overpayment not allowed', { description: apiErrorMessage(err) })
        return
      }
      if (err instanceof ApiError && err.code === 'D2_CROSS_BRANCH_DEPOSIT') {
        toast.error('Cross-branch deposit blocked', { description: apiErrorMessage(err) })
        return
      }
      const attestationMessage =
        err instanceof ApiError && err.code ? STAFF_ATTESTATION_ERROR_MESSAGES[err.code] : undefined
      if (attestationMessage) {
        setAttestationError(attestationMessage)
        return
      }
      toast.error('Failed to record payment', { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Pay balance</h3>
        <p className="text-sm text-muted-foreground">
          Collect a payment on account{patientName ? ` for ${patientName}` : ''}. Applies to the
          oldest open bills first.
        </p>
      </div>

      {/* Read-only position row */}
      {balanceQuery.isLoading ? (
        <Skeleton className="h-14" />
      ) : balance ? (
        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
          <div>
            <span className="text-muted-foreground">Outstanding</span>
            <p className="font-mono tabular-nums font-medium">
              {formatMoney(balance.grossOutstanding)}
            </p>
          </div>
          <div className="text-right">
            <span className="text-muted-foreground">Credit available</span>
            <p className="font-mono tabular-nums font-medium">
              {formatMoney(balance.availableCredit)}
            </p>
          </div>
        </div>
      ) : null}

      {/* Tender fields */}
      <div className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
        <Checkbox
          id="pay-balance-split"
          checked={splitMode}
          onCheckedChange={(checked) => handleSplitModeChange(checked === true)}
          disabled={submitting}
        />
        <Label htmlFor="pay-balance-split" className="cursor-pointer font-normal leading-snug">
          Split tender across multiple payment methods
        </Label>
      </div>

      {splitMode ? (
        <>
          <SplitTenderEditor
            legs={splitLegs}
            onChange={setSplitLegs}
            netAmount={balance?.grossOutstanding ?? '0.00'}
            allowOverage
          />
          <p className="text-xs text-muted-foreground">
            Commit effect: allocates every tender leg oldest-bill-first in one database transaction.
            If any leg fails, no payment or patient credit is posted.
          </p>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="pay-balance-method">
              Method <span className="text-destructive">*</span>
            </Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger id="pay-balance-method">
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

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="pay-balance-amount">
                Amount <span className="text-destructive">*</span>
              </Label>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={onFullBalance}
                disabled={!balance}
              >
                Full balance
              </Button>
            </div>
            <Input
              id="pay-balance-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </>
      )}

      {!splitMode ? (
        <div className="space-y-1.5">
          <Label htmlFor="pay-balance-reference">Reference number</Label>
          <Input
            id="pay-balance-reference"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
          />
        </div>
      ) : null}

      {/* Allocation preview, always visible before commit */}
      <div className="space-y-1.5">
        <Label>Allocation preview</Label>
        {plan.allocations.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Enter an amount to preview how it applies across open bills.
          </p>
        ) : (
          <div className="rounded-md border border-border divide-y divide-border">
            {plan.allocations.map((a) => {
              const openBill = balance?.openBills.find((b) => b.id === a.billId)
              return (
                <div key={a.billId} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1">
                    <span className="font-mono text-xs">{a.billId}</span>
                    {openBill ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · {formatDate(openBill.transactedAt)}
                      </span>
                    ) : null}
                    {openBill ? (
                      <span className="text-muted-foreground font-mono">
                        {' '}
                        · {formatMoney(openBill.amountOutstanding)}
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono tabular-nums text-xs text-muted-foreground">
                    applies {formatMoney(a.applied)}
                  </span>
                  <Badge variant={a.settles ? 'ok' : 'due'} className="text-2xs">
                    {a.settles ? 'Settled' : 'Partly paid'}
                  </Badge>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
          <span className="text-muted-foreground">Tender applied</span>
          <span className="font-mono tabular-nums font-medium">
            {formatMoney(plan.tenderApplied)}
          </span>
        </div>
        {hasOverage ? (
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">Banks as patient credit</span>
            <span className="flex items-center gap-2">
              <span className="font-mono tabular-nums font-medium">
                {formatMoney(plan.overage)}
              </span>
              <Badge variant="info" className="text-2xs">
                Credit
              </Badge>
            </span>
          </div>
        ) : null}
      </div>

      {/* Overage disclosure: inline, never a nested overlay */}
      {hasOverage ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>This payment exceeds the outstanding balance</AlertTitle>
          <AlertDescription>
            The extra {formatMoney(plan.overage)} is banked as patient credit and can be applied to
            a future bill.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* PayBalanceDialog only mounts this panel while open, so the reveal
          resets naturally there. The token covers the inline detail-rail
          usage, where the panel can stay mounted across patients. */}
      <StaffAttestationField
        value={attestation}
        onChange={setAttestation}
        disabled={submitting}
        resetToken={patientId}
        validationError={attestationError}
      />
      {attestationError && <p className="text-xs text-destructive">{attestationError}</p>}

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={onSubmit} disabled={!canSubmit}>
          {submitting
            ? 'Paying…'
            : hasOverage
              ? `Pay and bank ${formatMoney(plan.overage)} as credit`
              : `Pay ${formatMoney(amountValid ? amountStr : '0.00')}`}
        </Button>
      </div>
    </div>
  )
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
} & Omit<PayBalancePanelProps, 'onClose'>

/**
 * Modal host for `PayBalancePanel`, used where no detail rail exists. A
 * patient detail rail can render the panel inline instead (continuous flow,
 * PATTERNS.md Pattern 35).
 */
export default function PayBalanceDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
  onSuccess,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogTitle className="sr-only">Pay balance</DialogTitle>
        <DialogDescription className="sr-only">
          Collect a payment on account, applied oldest-bill-first.
        </DialogDescription>
        {open && (
          <PayBalancePanel
            patientId={patientId}
            patientName={patientName}
            onSuccess={onSuccess}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
