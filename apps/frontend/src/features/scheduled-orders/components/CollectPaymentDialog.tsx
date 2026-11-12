import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { apiFetch, ApiError } from '@/lib/apiFetch'
import { formatMoney } from '@/lib/format'
import { humanizeStatus } from '@/lib/status'
import { toCents, fromCents } from '@/lib/money'
import { usePayerProfiles } from '@/features/admin/payerProfilesApi'
import {
  useCreateTransaction,
  useAddPayment,
  useAddPayments,
  useApplyCredit,
  usePatientCredit,
  type PaymentMethod,
} from '@/features/transactions/api'
import StaffAttestationField, {
  isStaffAttestationComplete,
  STAFF_ATTESTATION_ERROR_MESSAGES,
  type StaffAttestationValue,
} from '@/features/transactions/components/StaffAttestationField'
import { useAuth } from '@/features/auth/context'
import {
  SplitTenderEditor,
  newSplitLeg,
  type SplitLeg,
} from '@/features/transactions/components/SplitTenderEditor'
import { usePrepayableDoses, type PrepayableDose } from '../api'

// Tender methods a nurse can take at the chairside. `HMO` and `Corporate`
// appear only once a payer profile is chosen, because those tenders mean "the
// payer settles this", which is meaningless without naming the payer.
const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'Cash', label: 'Cash' },
  { value: 'GCash', label: 'GCash' },
  { value: 'Maya', label: 'Maya' },
  { value: 'BankTransfer', label: 'Bank transfer' },
  { value: 'Card', label: 'Card' },
]

const PAYER_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'HMO', label: 'HMO / charge to payer' },
  { value: 'Corporate', label: 'Corporate account' },
]

/** Sentinel for "no payer" in the Select, Radix cannot hold an empty value. */
const NO_PAYER = '__cash__'

// Billable = not yet billed and not cancelled. This covers both prepay (future
// doses) and the pay-after-administer flow (a just-Completed, unbilled dose).
function selectable(d: PrepayableDose, prepaymentOnly: boolean): boolean {
  return (
    d.paymentStatus === null &&
    d.state !== 'cancelled' &&
    (!prepaymentOnly || d.state !== 'completed')
  )
}

export interface CollectPaymentPanelProps {
  /** Source order display_id (ORD_…): the chain it belongs to is offered. */
  orderId: string
  /** Patient display_id (PAT_…) for the new transaction. */
  patientId: string
  patientName?: string
  /**
   * When true, preselect every billable dose due TODAY (Day-0 bundle handoff
   * from the Arrivals wizard) instead of just the source dose. Lets the cashier
   * settle the whole Day-0 charge in one click.
   */
  preselectDueToday?: boolean
  /** Restrict patient-account prepay to live, not-yet-administered doses. */
  prepaymentOnly?: boolean
  /** Called on Cancel and after a successful collection. */
  onClose: () => void
}

/**
 * Collect-payment flow content: dose picker, tender method, full-vs-
 * downpayment, commit. Surface-agnostic, hosted by `CollectPaymentDialog`
 * (modal) and rendered inline as the "Collect" step of the
 * ScheduledOrderDetail rail flow (PATTERNS.md Pattern 35). State resets by
 * unmounting.
 */
export function CollectPaymentPanel({
  orderId,
  patientId,
  patientName,
  preselectDueToday = false,
  prepaymentOnly = false,
  onClose,
}: CollectPaymentPanelProps) {
  // Which payer's contracted rate prices this collection. Chosen HERE, after the
  // standing order and the brand, because price is a billing fact: the clinical
  // record does not change when an HMO card turns up at the counter. Null = cash.
  const [payerId, setPayerId] = useState<string | null>(null)
  const payersQuery = usePayerProfiles('all')
  // Doses re-price when the payer changes: server-resolved, same resolver the
  // transaction itself uses, so the total shown is the total billed.
  const dosesQuery = usePrepayableDoses(orderId, true, payerId)
  const { user } = useAuth()
  const [attestation, setAttestation] = useState<StaffAttestationValue>({
    attestedById: null,
    attestationPin: null,
  })
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  /** Spread into every money mutation below so all legs carry one attestation. */
  const attestationFields = attestation.attestedById
    ? {
        attestedById: attestation.attestedById,
        attestationPin: attestation.attestationPin ?? '',
      }
    : {}

  const createTxn = useCreateTransaction()
  const addPayment = useAddPayment()
  const addPayments = useAddPayments()
  const applyCredit = useApplyCredit()
  const credit = usePatientCredit(patientId)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [method, setMethod] = useState<PaymentMethod>('Cash')
  const [payFull, setPayFull] = useState(true)
  const [downpayment, setDownpayment] = useState('')
  const [useCredit, setUseCredit] = useState(false)
  // Off by default: most collections are a single tender, so a nurse taking
  // one cash payment never has to touch the multi-leg editor. Reuses
  // SplitTenderEditor as-is (the same component the cashier "New
  // Transaction" flow drives) rather than reimplementing split logic here.
  const [splitMode, setSplitMode] = useState(false)
  const [splitLegs, setSplitLegs] = useState<SplitLeg[]>([])
  const submitting =
    createTxn.isPending || addPayment.isPending || addPayments.isPending || applyCredit.isPending

  const doses = useMemo(() => dosesQuery.data ?? [], [dosesQuery.data])

  // Preselect once doses load: the whole Day-0 due set for the arrivals
  // bundle handoff, otherwise just the source dose.
  useEffect(() => {
    if (preselectDueToday) {
      setSelected(
        new Set(
          doses
            .filter((d) => selectable(d, prepaymentOnly) && d.state === 'due')
            .map((d) => d.orderId),
        ),
      )
    } else {
      const source = doses.find((d) => d.orderId === orderId && selectable(d, prepaymentOnly))
      setSelected(source ? new Set([source.orderId]) : new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dosesQuery.data])

  const estimatedCents = useMemo(() => {
    let cents = 0
    for (const d of doses) {
      // `d.unitPrice` is resolved server-side for the chosen payer (and for the
      // administered brand on a dose already given), so this total is not an
      // approximation: it is what the bill will say.
      if (selected.has(d.orderId)) cents += toCents(d.unitPrice)
    }
    return cents
  }, [doses, selected])
  const estimated = (estimatedCents / 100).toFixed(2)

  const availableCents = toCents(credit.data?.available)
  // The amount that WOULD be drawn if the cashier opts in, capped at what's
  // actually owed, never more than the credit on file.
  const creditApplyCents = Math.min(availableCents, estimatedCents)
  const netAfterCreditCents = useCredit
    ? Math.max(0, estimatedCents - creditApplyCents)
    : estimatedCents

  function toggle(orderIdToToggle: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(orderIdToToggle)) next.delete(orderIdToToggle)
      else next.add(orderIdToToggle)
      return next
    })
  }

  const downpaymentCents = toCents(downpayment || '0')
  // Compare against what's left AFTER credit, not the raw estimate: credit
  // already covering part of the bill shouldn't make a valid downpayment
  // read as "too small" or "too large".
  const downpaymentInvalid =
    !payFull &&
    netAfterCreditCents > 0 &&
    (downpaymentCents <= 0 || downpaymentCents > netAfterCreditCents)

  // Split legs sum toward whatever is left AFTER credit, same convention as
  // the downpayment check above. Full vs partial falls out of the sum: legs
  // summing to the net settle to Paid, less than that leaves the bill
  // Pending, there is no separate "pay in full" toggle while splitting.
  const splitAllocatedCents = splitLegs.reduce(
    (sum, l) => sum + Math.max(0, toCents(l.amount || '0')),
    0,
  )
  const splitOverpays = splitAllocatedCents > netAfterCreditCents
  const splitEmpty = splitAllocatedCents <= 0
  const positiveSplitLegCount = splitLegs.filter((leg) => toCents(leg.amount || '0') > 0).length
  const splitPaysInFull = splitAllocatedCents >= netAfterCreditCents

  function handleSplitModeChange(next: boolean) {
    setSplitMode(next)
    // Seed one leg at the full remaining balance so turning splitting on
    // never starts from an empty, unsubmittable editor.
    if (next && splitLegs.length === 0) {
      setSplitLegs([newSplitLeg(fromCents(netAfterCreditCents))])
    }
  }

  const canSubmit =
    selected.size > 0 &&
    !submitting &&
    (splitMode
      ? !splitOverpays && !splitEmpty && positiveSplitLegCount >= 2
      : !downpaymentInvalid) &&
    // This is the clinic's primary payment path (administer, then collect), so
    // it needs the same attestation as every other money surface: on the shared
    // Branch kiosk the backend refuses an unattested payment outright.
    isStaffAttestationComplete(attestation, user?.role)

  async function onSubmit() {
    if (selected.size === 0) return
    setSubmissionError(null)
    const items = doses
      .filter((d) => selected.has(d.orderId))
      .map((d) => ({
        serviceId: d.serviceId,
        clinicalOrderId: d.orderId,
        quantity: 1,
        ...(prepaymentOnly ? { isPrepaid: true } : {}),
      }))

    try {
      // 1. Create the bill linked to the selected doses (no inline payment).
      const created = await createTxn.mutateAsync({
        patientId,
        items,
        ...(payerId ? { payerId } : {}),
        ...attestationFields,
      })

      // 2. Draw patient credit first, if opted in, before tendering the
      //    remainder, keyed on patientId, scoped to this one bill.
      let creditApplied = '0.00'
      if (useCredit && availableCents > 0) {
        const creditRes = await applyCredit.mutateAsync({ patientId, transactionId: created.id })
        creditApplied = creditRes.appliedAmount
      }

      // 3. Re-read the server-computed outstanding so the tender only covers
      //    whatever credit didn't already settle.
      const detail = await apiFetch<{ amountOutstanding: string }>(
        `/api/transactions/${created.id}`,
      )
      const remainingCents = toCents(detail.amountOutstanding)

      // 4. Collect the payment (full → Paid, partial → Pending downpayment).
      //    Skipped entirely when credit already settled the bill. Split mode
      //    posts all effective legs in one atomic batch. Each leg is capped at
      //    the current outstanding so a concurrent credit change cannot overpay.
      let payCents = 0
      const paidLegs: { method: PaymentMethod; cents: number }[] = []
      if (splitMode) {
        let remaining = remainingCents
        const batch: Array<{
          method: PaymentMethod
          amount: string
          referenceNumber?: string
        }> = []
        for (const leg of splitLegs) {
          if (remaining <= 0) break
          const legCents = Math.min(toCents(leg.amount || '0'), remaining)
          if (legCents <= 0) continue
          batch.push({
            method: leg.method,
            amount: fromCents(legCents),
            referenceNumber: leg.reference.trim() || undefined,
          })
          paidLegs.push({ method: leg.method, cents: legCents })
          payCents += legCents
          remaining -= legCents
        }
        if (batch.length >= 2) {
          await addPayments.mutateAsync({
            transactionId: created.id,
            payments: batch,
            ...attestationFields,
          })
        } else if (batch.length === 1) {
          await addPayment.mutateAsync({
            transactionId: created.id,
            ...batch[0]!,
            ...attestationFields,
          })
        }
      } else {
        payCents = payFull ? remainingCents : Math.min(downpaymentCents, remainingCents)
        if (payCents > 0) {
          await addPayment.mutateAsync({
            transactionId: created.id,
            method,
            amount: (payCents / 100).toFixed(2),
            ...attestationFields,
          })
          paidLegs.push({ method, cents: payCents })
        }
      }

      const paid = remainingCents - payCents <= 0
      const creditNote =
        toCents(creditApplied) > 0 ? ` · ${formatMoney(creditApplied)} credit applied` : ''
      // Non-split keeps the exact prior wording (method always shown, even
      // when credit alone covered the bill); split only names the tenders
      // that actually posted a leg.
      const tenderNote = splitMode
        ? paidLegs.length > 0
          ? ` · ${paidLegs.map((l) => l.method).join(' + ')}`
          : ''
        : ` · ${method}`
      toast(paid ? 'Payment collected' : 'Downpayment recorded', {
        description: `${formatMoney((payCents / 100).toFixed(2))}${tenderNote}${creditNote}${
          paid
            ? ''
            : ` · ${formatMoney(((remainingCents - payCents) / 100).toFixed(2))} balance due`
        }`,
      })
      onClose()
    } catch (err) {
      const message =
        err instanceof ApiError && err.code
          ? (STAFF_ATTESTATION_ERROR_MESSAGES[err.code] ??
            (err.code === 'CLINICAL_ORDER_ALREADY_BILLED' ? apiErrorMessage(err) : undefined))
          : undefined
      if (message) {
        setSubmissionError(message)
        return
      }
      toast.error('Failed to collect payment', { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Collect payment</h3>
        <p className="text-sm text-muted-foreground">
          {prepaymentOnly ? 'Prepay' : 'Collect for'} one or more eligible doses
          {patientName ? ` for ${patientName}` : ''}. Pay in full or take a downpayment and collect
          the balance later.
        </p>
      </div>

      {/* Payer profile: the third choice in the flow, after the standing order
          and the brand. Placed above the dose list because it re-prices it. */}
      <div className="space-y-1.5">
        <Label htmlFor="collect-payer">Payer</Label>
        <Select
          value={payerId ?? NO_PAYER}
          onValueChange={(v) => {
            const next = v === NO_PAYER ? null : v
            setPayerId(next)
            // A payer-settled tender makes no sense without a payer, and a
            // direct tender is the sane default when reverting to cash.
            if (next === null && (method === 'HMO' || method === 'Corporate')) setMethod('Cash')
          }}
          disabled={submitting}
        >
          <SelectTrigger id="collect-payer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PAYER}>Cash / walk-in (no payer)</SelectItem>
            {(payersQuery.data?.data ?? [])
              .filter((p) => p.isActive)
              .map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  <span className="ml-1.5 text-xs text-muted-foreground">{p.payerType}</span>
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {payerId
            ? "Doses below are priced at this payer's contracted rate."
            : 'Doses below are priced at the clinic\u2019s cash rate.'}
        </p>
      </div>

      {/* Dose picker */}
      <div className="space-y-1.5">
        <Label>Doses</Label>
        {dosesQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : doses.length === 0 ? (
          <p className="text-xs text-muted-foreground">No doses found for this order.</p>
        ) : (
          <div className="rounded-md border border-border divide-y divide-border">
            {doses.map((d) => {
              const ok = selectable(d, prepaymentOnly)
              const price = d.unitPrice
              return (
                <label
                  key={d.orderId}
                  className={`flex items-center gap-3 px-3 py-2 text-sm ${
                    ok ? 'cursor-pointer' : 'opacity-60'
                  }`}
                >
                  <Checkbox
                    checked={selected.has(d.orderId)}
                    disabled={!ok}
                    onCheckedChange={() => ok && toggle(d.orderId)}
                  />
                  <span className="flex-1">
                    <span className="font-medium">Dose {d.doseNumber}</span>
                    <span className="text-muted-foreground"> · {d.serviceName}</span>
                    <span className="text-muted-foreground font-mono"> · {d.scheduledAt}</span>
                  </span>
                  {d.paymentStatus ? (
                    <Badge
                      variant={d.paymentStatus === 'Paid' ? 'ok' : 'info'}
                      className="text-2xs"
                    >
                      {humanizeStatus(d.paymentStatus)}
                    </Badge>
                  ) : d.state === 'cancelled' || (prepaymentOnly && d.state === 'completed') ? (
                    <Badge variant="outline" className="text-2xs">
                      {d.state === 'completed' ? 'Completed' : 'Cancelled'}
                    </Badge>
                  ) : (
                    <span className="font-mono tabular-nums text-xs">
                      {price ? formatMoney(price) : '—'}
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        )}
      </div>

      {/* Estimated total */}
      <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
        <span className="text-muted-foreground">Estimated total</span>
        <span className="font-mono tabular-nums font-medium">{formatMoney(estimated)}</span>
      </div>

      {/* Patient credit: opt-in, off by default so the cashier decides. */}
      {availableCents > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">Patient credit available</span>
            <span className="font-mono tabular-nums font-medium">
              {formatMoney(credit.data?.available)}
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={useCredit} onCheckedChange={(v) => setUseCredit(v === true)} />
            Apply {formatMoney(fromCents(creditApplyCents))} credit
          </label>
        </div>
      )}

      {/* Tender method */}
      <div className="space-y-2">
        {splitMode ? (
          <div className="space-y-1.5">
            <Label>
              Payment methods <span className="text-destructive">*</span>
            </Label>
            <SplitTenderEditor
              legs={splitLegs}
              onChange={setSplitLegs}
              netAmount={fromCents(netAfterCreditCents)}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="collect-method">
              Method <span className="text-destructive">*</span>
            </Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger id="collect-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* Payer-settled tenders only exist once a payer is named. */}
                {[...METHODS, ...(payerId ? PAYER_METHODS : [])].map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {/* Most collections are one tender; splitting is opt-in so a nurse
            taking a single cash payment never has to touch the multi-leg
            editor. Full vs partial then falls out of the legs' own sum, so
            "Pay in full" only applies to the single-method path below. */}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={splitMode}
            onCheckedChange={(v) => handleSplitModeChange(v === true)}
          />
          Split across multiple payment methods
        </label>
      </div>

      {/* Full vs downpayment (single-method path only; splitting determines
          full-vs-partial from the legs' own sum against the net, above). */}
      {!splitMode && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={payFull} onCheckedChange={(v) => setPayFull(v === true)} />
            Pay in full now
          </label>
          {!payFull && (
            <div className="space-y-1.5">
              <Label htmlFor="downpayment">
                Amount now (downpayment) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="downpayment"
                inputMode="decimal"
                placeholder="0.00"
                value={downpayment}
                onChange={(e) => setDownpayment(e.target.value)}
              />
              {downpaymentInvalid ? (
                <p className="text-xs text-destructive">
                  Enter an amount between ₱0.01 and {formatMoney(fromCents(netAfterCreditCents))}.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Balance due is collected at administration or later.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <StaffAttestationField
        value={attestation}
        onChange={setAttestation}
        disabled={submitting}
        actionLabel="Collecting payment"
        validationError={submissionError}
      />
      {submissionError && <p className="text-xs text-destructive">{submissionError}</p>}

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={onSubmit} disabled={!canSubmit}>
          {submitting
            ? 'Collecting…'
            : splitMode
              ? splitPaysInFull
                ? 'Collect payment'
                : 'Record downpayment'
              : payFull
                ? 'Collect payment'
                : 'Record downpayment'}
        </Button>
      </div>
    </div>
  )
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderId: string
  patientId: string
  patientName?: string
  preselectDueToday?: boolean
  prepaymentOnly?: boolean
}

/**
 * Modal host for `CollectPaymentPanel`, used where no detail rail exists
 * (Arrivals Day-0 hand-off). The ScheduledOrderDetail rail renders the
 * panel inline instead (continuous flow, Pattern 35).
 */
export default function CollectPaymentDialog({
  open,
  onOpenChange,
  orderId,
  patientId,
  patientName,
  preselectDueToday = false,
  prepaymentOnly = false,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle className="sr-only">Collect payment</DialogTitle>
        <DialogDescription className="sr-only">
          Prepay one or more upcoming doses.
        </DialogDescription>
        {open && (
          <CollectPaymentPanel
            orderId={orderId}
            patientId={patientId}
            patientName={patientName}
            preselectDueToday={preselectDueToday}
            prepaymentOnly={prepaymentOnly}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
