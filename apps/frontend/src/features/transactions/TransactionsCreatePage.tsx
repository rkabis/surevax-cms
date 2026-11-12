import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useFieldArray, useWatch, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Lock, Plus, Trash2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AcronymHint } from '@/components/ui/acronym-hint'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { usePatientSearch, type Patient } from '@/features/patients/api'
import { useServices } from '@/features/services/api'
import { usePatientEncounters } from '@/features/patients/api'
import { useAuth } from '@/features/auth/context'
import {
  useCreateTransaction,
  useAddPayment,
  useAddPayments,
  useApplyCredit,
  usePatientCredit,
  type CreateTransactionInput,
  type TransactionStatus,
} from './api'
import { computePreviewTotals, type DiscountType } from './totals'
import { TenderRail, type PayMethod } from './components/TenderRail'
import { SplitTenderEditor, newSplitLeg, type SplitLeg } from './components/SplitTenderEditor'
import RecordDepositDialog from './components/RecordDepositDialog'
import { payMethodToBackend, statusToFsmLabel } from './lib'
import { toCents, fromCents } from '@/lib/money'
import { formatMoney } from '@/lib/format'
import { apiFetch, ApiError } from '@/lib/apiFetch'
import { DirtyFormGuard } from '@/components/layout'
import { ServicePicker } from '@/components/forms'
import { useSafeForm } from '@/lib/useSafeForm'
import StaffAttestationField, {
  isStaffAttestationComplete,
  STAFF_ATTESTATION_ERROR_MESSAGES,
  type StaffAttestationValue,
} from './components/StaffAttestationField'
import { transactionCreateFormSchema, type TransactionCreateFormFields } from './formSchema'

const formSchema = transactionCreateFormSchema
type FormFields = TransactionCreateFormFields

const EMPTY_ITEM = {
  serviceId: '',
  quantity: 1,
  isVatExempt: false,
  isPrepaid: false,
}

function getCashierInitials(firstName: string | undefined, lastName: string | undefined): string {
  const f = firstName?.charAt(0).toUpperCase() ?? ''
  const l = lastName?.charAt(0).toUpperCase() ?? ''
  return f + l || '—'
}

function getPatientInitials(firstName: string | undefined, lastName: string | undefined): string {
  const f = firstName?.charAt(0).toUpperCase() ?? ''
  const l = lastName?.charAt(0).toUpperCase() ?? ''
  return l + f || '—'
}

/**
 * Compute precise age from a date-of-birth string and return a human label.
 * Uses exact calendar difference, not a simple year subtraction, to avoid
 * off-by-up-to-one-year error (FE-4).
 * Examples: "34y 2m", "1y 0m", "0y 8m"
 */
function computeAge(dob: string): string {
  const birth = new Date(dob)
  const now = new Date()
  let years = now.getFullYear() - birth.getFullYear()
  let months = now.getMonth() - birth.getMonth()
  if (now.getDate() < birth.getDate()) {
    months -= 1
  }
  if (months < 0) {
    years -= 1
    months += 12
  }
  if (years < 2) {
    return months > 0 ? `${years}y ${months}m` : `${years}y`
  }
  return `${years}y`
}

export default function TransactionsCreatePage() {
  const navigate = useNavigate()
  const createTxn = useCreateTransaction()
  const addPayment = useAddPayment()
  const addPayments = useAddPayments()
  const applyCredit = useApplyCredit()
  const { user } = useAuth()

  const cashierInitials = getCashierInitials(user?.firstName, user?.lastName)

  const [patientQuery, setPatientQuery] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [tenderMethod, setTenderMethod] = useState<PayMethod>('cash')
  const [tendered, setTendered] = useState<number>(0)
  // Raw string for the "Amount tendered" input — prevents formatMoney from
  // inserting ₱/commas mid-keystroke and making decimals un-typeable (FE-2).
  const [tenderedInput, setTenderedInput] = useState<string>('0.00')
  // Split-tender legs (lifted here so both the inline Tender card and the
  // TenderRail summary read the same source of truth).
  const [splitLegs, setSplitLegs] = useState<SplitLeg[]>([])
  // Patient credit: opt-in, off by default so the cashier decides.
  const [useCredit, setUseCredit] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)
  // One attestation for the whole create call, whichever leg(s) it tenders:
  // mirrors the backend's `attestedById`/`attestationPin` on createTransactionSchema.
  const [attestation, setAttestation] = useState<StaffAttestationValue>({
    attestedById: null,
    attestationPin: null,
  })
  const [attestationError, setAttestationError] = useState<string | null>(null)

  const credit = usePatientCredit(selectedPatient?.id ?? null)
  const availableCreditCents = toCents(credit.data?.available)

  // Reset the opt-in whenever the patient changes so a stale "use credit"
  // choice never carries over to a different patient's bill.
  useEffect(() => {
    setUseCredit(false)
  }, [selectedPatient?.id])

  /** Update the numeric tendered value AND the raw input string together. */
  function handleTenderedChange(n: number) {
    setTendered(n)
    setTenderedInput(Number.isFinite(n) ? n.toFixed(2) : '0.00')
  }

  const patientSearch = usePatientSearch(patientQuery, pickerOpen && patientQuery.length >= 2)
  const services = useServices('')
  const patientEncounters = usePatientEncounters(selectedPatient?.id ?? null, 5)

  const form = useSafeForm<FormFields>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      patientId: '',
      encounterId: '',
      discountIdType: 'NA',
      discountIdNumber: '',
      patients: [],
      items: [EMPTY_ITEM],
    },
  })

  const fieldArray = useFieldArray({ control: form.control, name: 'items' })
  // Additional patients (beyond the primary) on a multi-patient / family bill.
  const patientsArray = useFieldArray({ control: form.control, name: 'patients' })
  // Display labels ("Lastname, Firstname") for every patient on the bill,
  // keyed by PAT_ display id — used by the per-line patient picker + cards.
  const [patientNames, setPatientNames] = useState<Record<string, string>>({})

  function addBillPatient(p: Patient) {
    if (p.id === form.getValues('patientId')) return // already the primary
    if (patientsArray.fields.some((f) => f.patientId === p.id)) return // already added
    setPatientNames((m) => ({ ...m, [p.id]: `${p.lastName}, ${p.firstName}` }))
    patientsArray.append({ patientId: p.id, discount: { idType: 'NA', idNumber: '' } })
  }
  // useWatch, not form.watch: watch() returns RHF's live internal array, whose
  // reference never changes when a row's field is edited in place — so a
  // useMemo keyed on it never recomputes and the tender rail sticks at ₱0.00.
  // useWatch clones on every emit, giving the memos a fresh dependency.
  const watchedItems = useWatch({ control: form.control, name: 'items' })
  const watchedDiscount = useWatch({ control: form.control, name: 'discountIdType' }) ?? 'NA'
  const watchedEncounterId = useWatch({ control: form.control, name: 'encounterId' })
  const watchedPatientsRaw = useWatch({ control: form.control, name: 'patients' })
  const watchedPatients = useMemo(() => watchedPatientsRaw ?? [], [watchedPatientsRaw])

  const servicesCatalog = useMemo(
    () => Object.fromEntries((services.data ?? []).map((s) => [s.id, s])),
    [services.data],
  )

  const isMultiPatient = patientsArray.fields.length > 0

  // Every patient on the bill (primary first) — drives the per-line patient
  // picker and the per-patient discount rows.
  const billPatients = useMemo(() => {
    const list: Array<{ id: string; label: string; isPrimary: boolean }> = []
    if (selectedPatient) {
      list.push({
        id: selectedPatient.id,
        label: `${selectedPatient.lastName}, ${selectedPatient.firstName}`,
        isPrimary: true,
      })
    }
    for (const p of watchedPatients) {
      if (!p?.patientId) continue
      list.push({
        id: p.patientId,
        label: patientNames[p.patientId] ?? p.patientId,
        isPrimary: false,
      })
    }
    return list
  }, [selectedPatient, watchedPatients, patientNames])

  // PAT_ display id → that patient's SC/PWD discount (primary = the flat field).
  const discountByPatient = useMemo(() => {
    const map: Record<string, DiscountType> = {}
    if (selectedPatient) map[selectedPatient.id] = watchedDiscount as DiscountType
    for (const p of watchedPatients) {
      if (p?.patientId) map[p.patientId] = (p.discount?.idType ?? 'NA') as DiscountType
    }
    return map
  }, [selectedPatient, watchedDiscount, watchedPatients])

  const totals = useMemo(() => {
    // Map (not flatMap) so totals.lines stays index-aligned with the item rows —
    // a service can repeat across patients, so a serviceId key would collide.
    // Empty/no-service rows contribute zero. Each line uses ITS patient's discount.
    const previewItems = (watchedItems ?? []).map((it) => {
      const svc = it?.serviceId ? servicesCatalog[it.serviceId] : undefined
      const linePatientId = it?.patientId || selectedPatient?.id || ''
      return {
        serviceId: it?.serviceId || '',
        basePrice: svc?.basePrice ?? '0',
        quantity: Number(it?.quantity) || 0,
        isVatExempt: !!it?.isVatExempt,
        isPrepaid: !!it?.isPrepaid,
        discountType: (discountByPatient[linePatientId] ?? 'NA') as DiscountType,
      }
    })
    return computePreviewTotals(previewItems, watchedDiscount)
  }, [watchedItems, watchedDiscount, servicesCatalog, discountByPatient, selectedPatient])

  const latestOpenEncounter = useMemo(() => {
    const encounters = patientEncounters.data?.data ?? []
    if (watchedEncounterId) {
      return encounters.find((e) => e.id === watchedEncounterId) ?? encounters[0] ?? null
    }
    return encounters[0] ?? null
  }, [patientEncounters.data, watchedEncounterId])

  function selectPatient(p: Patient) {
    setSelectedPatient(p)
    form.setValue('patientId', p.id, { shouldValidate: true })
    form.setValue('encounterId', '')
    setPatientNames((m) => ({ ...m, [p.id]: `${p.lastName}, ${p.firstName}` }))
    // Drop any additional-patient entry that now duplicates the primary.
    const dupIdx = patientsArray.fields.findIndex((f) => f.patientId === p.id)
    if (dupIdx >= 0) patientsArray.remove(dupIdx)
    setPatientQuery(`${p.lastName}, ${p.firstName}`)
    setPickerOpen(false)
  }

  /** Switch tender method; seed a first split leg (at the full net) on entry. */
  function handleMethodChange(m: PayMethod) {
    setTenderMethod(m)
    if (m === 'split' && splitLegs.length === 0) {
      setSplitLegs([newSplitLeg(totals.netAmount)])
    }
  }

  async function onSubmit(values: FormFields) {
    setAttestationError(null)
    const discount =
      values.discountIdType === 'NA'
        ? null
        : {
            idType: values.discountIdType,
            idNumber: values.discountIdNumber?.trim() || undefined,
          }

    const items = values.items.map((it) => {
      const svc = servicesCatalog[it.serviceId]
      return {
        serviceId: it.serviceId,
        // Send the per-line patient only when it differs from the primary —
        // omit ⇒ the backend bills the line to the primary patient.
        patientId: it.patientId && it.patientId !== values.patientId ? it.patientId : undefined,
        quantity: Number(it.quantity),
        isVatExempt: svc?.isVatExempt ?? !!it.isVatExempt,
        isPrepaid: !!it.isPrepaid,
      }
    })

    // Additional patients (the primary's discount is the top-level `discount`).
    const patients = (values.patients ?? [])
      .filter((p) => p.patientId)
      .map((p) => ({
        patientId: p.patientId,
        discount:
          !p.discount || p.discount.idType === 'NA'
            ? null
            : { idType: p.discount.idType, idNumber: p.discount.idNumber?.trim() || undefined },
      }))

    const payload: CreateTransactionInput = {
      patientId: values.patientId,
      encounterId: values.encounterId?.trim() || undefined,
      discount,
      ...(patients.length > 0 ? { patients } : {}),
      items,
      ...(attestation.attestedById
        ? {
            attestedById: attestation.attestedById,
            attestationPin: attestation.attestationPin ?? '',
          }
        : {}),
    }

    // When patient credit is being drawn, defer the tender: create the bill
    // unpaid, apply credit, then tender only what credit didn't cover. Without
    // credit in play, the tender still rides along atomically with creation.
    const applyingCredit = useCredit && availableCreditCents > 0
    if (!applyingCredit) {
      if (tenderMethod === 'split') {
        const legs = splitLegs
          .map((l) => ({
            method: l.method,
            amount: (parseFloat(l.amount) || 0).toFixed(2),
            referenceNumber: l.reference.trim() || undefined,
          }))
          .filter((l) => parseFloat(l.amount) > 0)
        if (legs.length > 0) payload.payments = legs
      } else if (tendered > 0) {
        // Cap the applied amount at net: a cash over-tender is change due at the
        // drawer, not an over-payment on the bill (the backend rejects > net).
        const appliedCents = Math.min(Math.round(tendered * 100), toCents(totals.netAmount))
        payload.payment = {
          method: payMethodToBackend(tenderMethod),
          amount: fromCents(appliedCents),
        }
      }
    }

    try {
      const res = await createTxn.mutateAsync(payload)

      let finalStatus: TransactionStatus = res.status
      let finalReceiptNo = res.receiptNo
      let creditApplied = '0.00'

      if (applyingCredit) {
        // 1. Draw patient credit first, keyed on patientId, scoped to this bill.
        const creditRes = await applyCredit.mutateAsync({
          patientId: values.patientId,
          transactionId: res.id,
        })
        creditApplied = creditRes.appliedAmount

        // 2. Re-read the server-computed outstanding so the tender only covers
        //    whatever credit didn't already settle.
        const afterCredit = await apiFetch<{ amountOutstanding: string }>(
          `/api/transactions/${res.id}`,
        )
        const remainingCents = toCents(afterCredit.amountOutstanding)

        if (remainingCents > 0) {
          if (tenderMethod === 'split') {
            const legs = splitLegs
              .map((l) => ({
                method: l.method,
                amount: (parseFloat(l.amount) || 0).toFixed(2),
                referenceNumber: l.reference.trim() || undefined,
              }))
              .filter((l) => parseFloat(l.amount) > 0)
            let remaining = remainingCents
            const batch: typeof legs = []
            for (const leg of legs) {
              if (remaining <= 0) break
              const legCents = Math.min(toCents(leg.amount), remaining)
              if (legCents <= 0) continue
              batch.push({
                method: leg.method,
                amount: fromCents(legCents),
                referenceNumber: leg.referenceNumber,
              })
              remaining -= legCents
            }
            const attestationFields = attestation.attestedById
              ? {
                  attestedById: attestation.attestedById,
                  attestationPin: attestation.attestationPin ?? '',
                }
              : {}
            if (batch.length >= 2) {
              await addPayments.mutateAsync({
                transactionId: res.id,
                payments: batch,
                ...attestationFields,
              })
            } else if (batch.length === 1) {
              await addPayment.mutateAsync({
                transactionId: res.id,
                ...batch[0]!,
                ...attestationFields,
              })
            }
          } else if (tendered > 0) {
            const payCents = Math.min(Math.round(tendered * 100), remainingCents)
            if (payCents > 0) {
              await addPayment.mutateAsync({
                transactionId: res.id,
                method: payMethodToBackend(tenderMethod),
                amount: fromCents(payCents),
                ...(attestation.attestedById
                  ? {
                      attestedById: attestation.attestedById,
                      attestationPin: attestation.attestationPin ?? '',
                    }
                  : {}),
              })
            }
          }
        }

        // 3. Refresh status/receipt after the deferred credit + tender steps.
        const afterTender = await apiFetch<{
          status: TransactionStatus
          receiptNo: string | null
        }>(`/api/transactions/${res.id}`)
        finalStatus = afterTender.status
        finalReceiptNo = afterTender.receiptNo
      }

      const creditNote =
        toCents(creditApplied) > 0 ? ` · ${formatMoney(creditApplied)} credit applied` : ''
      const description =
        finalStatus === 'Paid' && finalReceiptNo
          ? `${res.id} · ${finalReceiptNo}${creditNote}`
          : `${res.id} · ${statusToFsmLabel(finalStatus)}${creditNote}`
      toast('Transaction created', { description })
      form.reset()
      setAttestation({ attestedById: null, attestationPin: null })
      navigate(`/transactions?selected=${encodeURIComponent(res.id)}`)
    } catch (err) {
      const attestationMessage =
        err instanceof ApiError && err.code ? STAFF_ATTESTATION_ERROR_MESSAGES[err.code] : undefined
      if (attestationMessage) {
        setAttestationError(attestationMessage)
        return
      }
      toast.error('Failed to create transaction', { description: apiErrorMessage(err) })
    }
  }

  function setDiscountType(value: DiscountType) {
    form.setValue('discountIdType', value, { shouldValidate: true })
  }

  const patientInitials = getPatientInitials(selectedPatient?.firstName, selectedPatient?.lastName)

  const netCents = toCents(totals.netAmount)
  const tenderedCents = Math.round((tendered || 0) * 100)
  const changeCents = Math.max(0, tenderedCents - netCents)
  const changeAmount = changeCents / 100

  const isSplit = tenderMethod === 'split'
  const splitAllocatedCents = splitLegs.reduce(
    (sum, l) => sum + Math.max(0, toCents(l.amount || '0')),
    0,
  )
  const splitRemainingCents = netCents - splitAllocatedCents
  const splitOverpays = splitAllocatedCents > netCents
  const positiveSplitLegCount = splitLegs.filter((leg) => toCents(leg.amount || '0') > 0).length
  // A split commit needs at least two funded legs and must not over-allocate.
  // Non-split commits are gated only by patient + form validity (a zero tender
  // still creates a Pending bill, matching the single-payment behaviour).
  const tenderValid =
    !isSplit || (positiveSplitLegCount >= 2 && splitAllocatedCents > 0 && !splitOverpays)
  // Only a commit that actually tenders money needs the attestation resolved:
  // a zero-tender Pending bill doesn't take anyone's cash.
  const willTender = isSplit ? splitAllocatedCents > 0 : tendered > 0
  const attestationComplete = isStaffAttestationComplete(attestation, user?.role)
  const canCommit =
    form.formState.isValid &&
    !!selectedPatient &&
    tenderValid &&
    (!willTender || attestationComplete)
  const submitting =
    createTxn.isPending || applyCredit.isPending || addPayment.isPending || addPayments.isPending
  // The amount that WOULD be drawn if the cashier opts in, capped at net.
  const creditApplyCents = Math.min(availableCreditCents, netCents)

  return (
    <div className="h-full flex flex-col">
      <DirtyFormGuard when={form.formState.isDirty} />
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Button asChild variant="ghost" size="sm">
            <Link to="/transactions">
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">
              {selectedPatient
                ? `${selectedPatient.firstName} ${selectedPatient.lastName}`
                : 'New Transaction'}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Linked to encounter{' '}
              <span className="font-mono">{latestOpenEncounter?.id ?? '—'}</span>
              {selectedPatient && (
                <>
                  {' · '}
                  <span className="font-mono">{selectedPatient.id}</span>
                </>
              )}
              {' · cashier '}
              <span className="font-mono">{cashierInitials}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* B35: "Save as draft" was permanently disabled with no plan to
              wire it. Removed entirely — Discard / Tender are the actual
              actions a cashier needs here. Restore if/when draft persistence
              is implemented. */}
          <Button variant="outline" size="sm" asChild>
            <Link to="/transactions">Discard</Link>
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => void form.handleSubmit(onSubmit)()}
            disabled={!canCommit || submitting}
          >
            {submitting ? 'Creating…' : `Tender ${formatMoney(totals.netAmount)}`}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 lg:flex-row flex-col">
        <ScrollArea className="flex-1 min-w-0">
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            id="txn-form"
            className="px-4 sm:px-6 py-4 space-y-4 max-w-2xl"
          >
            {selectedPatient ? (
              <Alert variant="destructive" className="flex items-start gap-3">
                <Lock className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
                <div className="flex-1">
                  <AlertTitle>Day-0 ARV blocked until payment commits.</AlertTitle>
                  <AlertDescription className="mt-1">
                    {`Cashier settles ${formatMoney(totals.netAmount)}`}
                    {
                      ' → nurse\'s "Administer" button unlocks after settlement. Split tender legs commit atomically.'
                    }
                  </AlertDescription>
                </div>
                <div className="shrink-0">
                  <Badge variant="outline" className="font-mono text-xs">
                    State · {statusToFsmLabel(createTxn.data?.status ?? 'Pending')}
                  </Badge>
                </div>
              </Alert>
            ) : (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Search for a patient above to load encounter context. The atomic-commit guard
                appears once a patient is selected.
              </div>
            )}

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">Patient &amp; encounter</CardTitle>
                    {selectedPatient ? (
                      <CardDescription>
                        <span className="font-mono">{selectedPatient.id}</span>
                        {selectedPatient.dateOfBirth
                          ? ` · ${computeAge(selectedPatient.dateOfBirth)}`
                          : ''}
                        {' · No HMO · No discount'}
                      </CardDescription>
                    ) : (
                      <CardDescription>Search to select a patient</CardDescription>
                    )}
                  </div>
                  {selectedPatient && <Badge variant="ok">verified</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedPatient ? (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-sm font-semibold text-primary">
                          {patientInitials}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">
                          {selectedPatient.lastName}, {selectedPatient.firstName}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {selectedPatient.dateOfBirth
                            ? `${computeAge(selectedPatient.dateOfBirth)}`
                            : null}
                          {' · No HMO · No discount'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedPatient(null)
                          form.setValue('patientId', '')
                          setPatientQuery('')
                        }}
                      >
                        Change
                      </Button>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-20 shrink-0">
                          Encounter
                        </span>
                        <select
                          className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                          {...form.register('encounterId')}
                        >
                          <option value="">— No encounter —</option>
                          {patientEncounters.data?.data.map((enc) => (
                            <option key={enc.id} value={enc.id}>
                              {`${enc.id}${enc.specialty ? ` · ${enc.specialty}` : ''}`}
                            </option>
                          ))}
                        </select>
                      </div>
                      {latestOpenEncounter?.id && (
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-20 shrink-0">
                            Standing order
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {latestOpenEncounter.id}
                            {latestOpenEncounter.bundleLabel
                              ? ` · ${latestOpenEncounter.bundleLabel}`
                              : ''}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-20 shrink-0">Cashier</span>
                        <span className="text-xs">
                          {user?.firstName} {user?.lastName} · Drawer #12
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="relative">
                    <Search
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
                      aria-hidden
                    />
                    <Input
                      placeholder="Search patient by name…"
                      value={patientQuery}
                      onChange={(e) => {
                        setPatientQuery(e.target.value)
                        setPickerOpen(true)
                        if (selectedPatient) {
                          setSelectedPatient(null)
                          form.setValue('patientId', '')
                        }
                      }}
                      onFocus={() => setPickerOpen(true)}
                      className="pl-8"
                    />
                    {pickerOpen && patientQuery.length >= 2 && (
                      <div className="absolute z-10 mt-1 w-full bg-popover border border-border rounded-md shadow-md max-h-64 overflow-auto">
                        {patientSearch.isLoading && (
                          <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
                        )}
                        {!patientSearch.isLoading &&
                          (patientSearch.data?.data?.length ?? 0) === 0 && (
                            <div className="px-3 py-2 text-sm text-muted-foreground">
                              No matches
                            </div>
                          )}
                        {patientSearch.data?.data?.map((p) => (
                          <button
                            type="button"
                            key={p.id}
                            onClick={() => selectPatient(p)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                          >
                            <span className="font-medium">
                              {p.lastName}, {p.firstName}
                            </span>
                            <span className="text-xs text-muted-foreground ml-2 font-mono">
                              {p.id}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {form.formState.errors.patientId && (
                      <p className="text-xs text-destructive mt-1">
                        {form.formState.errors.patientId.message}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">Line items</CardTitle>
                    {latestOpenEncounter?.bundleLabel && (
                      <CardDescription>
                        From encounter {latestOpenEncounter.id}
                        {latestOpenEncounter.bundleLabel
                          ? ` · ${latestOpenEncounter.bundleLabel}`
                          : ''}
                      </CardDescription>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fieldArray.append(EMPTY_ITEM)}
                    className="gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    Add item
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {services.isLoading && <Skeleton className="h-20 w-full m-4" />}

                {!services.isLoading && fieldArray.fields.length > 0 && (
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead colSpan={2}>Service</TableHead>
                        {isMultiPatient && <TableHead className="w-[10rem]">Patient</TableHead>}
                        <TableHead className="w-[3.125rem] text-right">Qty</TableHead>
                        <TableHead className="w-[5rem] text-right">Unit</TableHead>
                        <TableHead className="w-[6.25rem] text-right">Total</TableHead>
                        <TableHead className="w-[2.5rem]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fieldArray.fields.map((field, idx) => {
                        const watched = watchedItems?.[idx]
                        const svc = watched?.serviceId
                          ? servicesCatalog[watched.serviceId]
                          : undefined
                        const lineTotal = watched?.serviceId ? totals.lines[idx] : undefined
                        const rowPatientId =
                          watched?.patientId && billPatients.some((b) => b.id === watched.patientId)
                            ? watched.patientId
                            : (selectedPatient?.id ?? '')

                        return (
                          <TableRow key={field.id}>
                            <TableCell className="align-top pt-3" colSpan={2}>
                              <ServicePicker
                                value={watched?.serviceId || null}
                                onChange={(id) =>
                                  form.setValue(`items.${idx}.serviceId`, id || '', {
                                    shouldValidate: true,
                                  })
                                }
                                payerId={form.watch('payerId') || null}
                                required
                              />
                              {svc?.isVatExempt && (
                                <p className="text-xs text-muted-foreground font-mono mt-1">
                                  VAT-EX
                                </p>
                              )}
                            </TableCell>
                            {isMultiPatient && (
                              <TableCell className="align-top pt-3">
                                <select
                                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                                  value={rowPatientId}
                                  onChange={(e) =>
                                    form.setValue(`items.${idx}.patientId`, e.target.value, {
                                      shouldValidate: true,
                                    })
                                  }
                                >
                                  {billPatients.map((bp) => (
                                    <option key={bp.id} value={bp.id}>
                                      {bp.label}
                                      {bp.isPrimary ? ' (primary)' : ''}
                                    </option>
                                  ))}
                                </select>
                              </TableCell>
                            )}
                            <TableCell className="align-top pt-3">
                              <Input
                                type="number"
                                min={1}
                                step={1}
                                className="h-8 w-16 text-right font-mono text-sm"
                                {...form.register(`items.${idx}.quantity`, {
                                  valueAsNumber: true,
                                })}
                              />
                            </TableCell>
                            <TableCell className="align-top pt-3 text-right font-mono tabular-nums text-sm text-muted-foreground">
                              {svc ? formatMoney(svc.basePrice) : '—'}
                            </TableCell>
                            <TableCell className="align-top pt-3 text-right font-mono tabular-nums text-sm font-medium">
                              {lineTotal
                                ? formatMoney(lineTotal.subtotal)
                                : svc
                                  ? formatMoney(
                                      (
                                        parseFloat(svc.basePrice) * (Number(watched?.quantity) || 0)
                                      ).toFixed(2),
                                    )
                                  : '—'}
                            </TableCell>
                            <TableCell className="align-top pt-3">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => fieldArray.remove(idx)}
                                disabled={fieldArray.fields.length === 1}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
                {!services.isLoading && fieldArray.fields.length === 0 && (
                  <div className="px-4 pb-4 text-center text-sm text-muted-foreground">
                    No items added. Click &quot;Add item&quot; to begin.
                  </div>
                )}
              </CardContent>
            </Card>

            {fieldArray.fields.length > 0 && (
              <div className="flex items-center gap-4 px-1 flex-wrap">
                {fieldArray.fields.map((field, idx) => {
                  const rowServiceId = watchedItems?.[idx]?.serviceId
                  const svc = rowServiceId ? servicesCatalog[rowServiceId] : undefined
                  if (!svc) return null
                  return (
                    <div key={field.id} className="flex items-center gap-3 text-xs">
                      <span className="font-mono text-muted-foreground">{svc.sku ?? svc.code}</span>
                      <label className="flex items-center gap-1.5">
                        <Controller
                          control={form.control}
                          name={`items.${idx}.isVatExempt`}
                          render={({ field: f }) => (
                            <Checkbox
                              checked={!!f.value}
                              onCheckedChange={(v) => f.onChange(!!v)}
                            />
                          )}
                        />
                        VAT exempt
                      </label>
                      <label className="flex items-center gap-1.5">
                        <Controller
                          control={form.control}
                          name={`items.${idx}.isPrepaid`}
                          render={({ field: f }) => (
                            <Checkbox
                              checked={!!f.value}
                              onCheckedChange={(v) => f.onChange(!!v)}
                            />
                          )}
                        />
                        Prepaid
                      </label>
                    </div>
                  )
                })}
              </div>
            )}
            {form.formState.errors.items?.message && (
              <p className="text-xs text-destructive px-1">{form.formState.errors.items.message}</p>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Patients &amp; discounts</CardTitle>
                <CardDescription>
                  Bill multiple patients on one receipt. Each carries their own{' '}
                  <AcronymHint term="BIR">BIR</AcronymHint> SC/PWD discount.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {selectedPatient
                        ? `${selectedPatient.lastName}, ${selectedPatient.firstName}`
                        : 'Primary patient'}
                    </span>
                    <Badge variant="outline" className="text-2xs">
                      primary
                    </Badge>
                  </div>
                  <DiscountButtons
                    value={watchedDiscount as DiscountType}
                    idNumber={form.watch('discountIdNumber') ?? ''}
                    inputId="primary-discount-id"
                    idNumberError={form.formState.errors.discountIdNumber?.message}
                    onTypeChange={setDiscountType}
                    onIdNumberChange={(v) =>
                      form.setValue('discountIdNumber', v, { shouldValidate: true })
                    }
                  />
                </div>

                {patientsArray.fields.map((field, i) => {
                  const pid = field.patientId
                  return (
                    <div key={field.id} className="space-y-2 border-t border-border pt-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{patientNames[pid] ?? pid}</span>
                        <span className="text-xs text-muted-foreground font-mono">{pid}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-auto"
                          onClick={() => patientsArray.remove(i)}
                          aria-label="Remove patient from bill"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                      <DiscountButtons
                        value={
                          (form.watch(`patients.${i}.discount.idType`) ?? 'NA') as DiscountType
                        }
                        idNumber={form.watch(`patients.${i}.discount.idNumber`) ?? ''}
                        inputId={`patient-${field.id}-discount-id`}
                        idNumberError={
                          form.formState.errors.patients?.[i]?.discount?.idNumber?.message
                        }
                        onTypeChange={(v) =>
                          form.setValue(`patients.${i}.discount.idType`, v, {
                            shouldValidate: true,
                          })
                        }
                        onIdNumberChange={(v) =>
                          form.setValue(`patients.${i}.discount.idNumber`, v, {
                            shouldValidate: true,
                          })
                        }
                      />
                    </div>
                  )
                })}

                <div className="border-t border-border pt-3">
                  <AddPatientSearch
                    onSelect={addBillPatient}
                    excludeIds={billPatients.map((b) => b.id)}
                    disabled={!selectedPatient}
                  />
                  {!selectedPatient && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Select the primary patient first.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-border mt-1">
                  <p className="text-xs text-muted-foreground">
                    Taking money ahead of any billed items? Record it as patient credit instead.
                  </p>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => setDepositOpen(true)}
                  >
                    Record a deposit instead
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Tender</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {availableCreditCents > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
                      <span className="text-muted-foreground">Patient credit available</span>
                      <span className="font-mono tabular-nums font-medium">
                        {formatMoney(credit.data?.available)}
                      </span>
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={useCredit}
                        onCheckedChange={(v) => setUseCredit(v === true)}
                      />
                      Use {formatMoney(fromCents(creditApplyCents))} credit
                    </label>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['cash', 'Cash'],
                      ['gcash', 'GCash'],
                      ['maya', 'Maya'],
                      ['card', 'Card'],
                      ['hmo', 'HMO'],
                      ['split', 'Split'],
                    ] as const
                  ).map(([id, label]) => {
                    const active = tenderMethod === id
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => handleMethodChange(id as PayMethod)}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
                          active
                            ? 'border-ring bg-accent text-accent-foreground'
                            : 'border-border bg-background hover:bg-accent/50'
                        }`}
                      >
                        <span
                          className={`h-3.5 w-3.5 rounded-full border-2 ${
                            active
                              ? 'border-ring bg-ring shadow-[inset_0_0_0_2px_white] dark:shadow-[inset_0_0_0_2px_black]'
                              : 'border-muted-foreground/30'
                          }`}
                        />
                        {label}
                      </button>
                    )
                  })}
                </div>
                {isSplit ? (
                  <SplitTenderEditor
                    legs={splitLegs}
                    onChange={setSplitLegs}
                    netAmount={totals.netAmount}
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Amount tendered</label>
                      <Input
                        className="font-mono text-base"
                        inputMode="decimal"
                        value={tenderedInput}
                        onChange={(e) => {
                          // Allow free-form numeric entry — strip non-numeric except decimal point.
                          const raw = e.target.value.replace(/[^0-9.]/g, '')
                          setTenderedInput(raw)
                          const n = parseFloat(raw)
                          setTendered(Number.isFinite(n) ? n : 0)
                        }}
                        onBlur={() => {
                          // Format to 2 d.p. on blur so the field looks polished at rest.
                          const n = parseFloat(tenderedInput)
                          handleTenderedChange(Number.isFinite(n) ? n : 0)
                        }}
                        onFocus={(e) => {
                          // Select-all on focus so the cashier can type-over immediately.
                          e.target.select()
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Change due</label>
                      <Input
                        className="font-mono text-base"
                        value={formatMoney(changeAmount)}
                        readOnly
                      />
                    </div>
                  </div>
                )}
                {willTender && (
                  <StaffAttestationField
                    value={attestation}
                    onChange={setAttestation}
                    disabled={submitting}
                    resetToken={willTender}
                    validationError={attestationError}
                  />
                )}
                {attestationError && <p className="text-xs text-destructive">{attestationError}</p>}
              </CardContent>
            </Card>

            <div className="flex items-center justify-end gap-2 pt-2 pb-4">
              <Button asChild variant="outline" type="button">
                <Link to="/transactions">Cancel</Link>
              </Button>
              <Button type="submit" disabled={!canCommit || createTxn.isPending} form="txn-form">
                {createTxn.isPending ? 'Creating…' : `Commit ${formatMoney(totals.netAmount)}`}
              </Button>
            </div>
          </form>
        </ScrollArea>

        <div className="hidden lg:flex shrink-0">
          <TenderRail
            totals={totals}
            cashierInitials={cashierInitials}
            method={tenderMethod}
            onMethodChange={handleMethodChange}
            tendered={tendered}
            onTenderedChange={handleTenderedChange}
            splitAllocated={fromCents(splitAllocatedCents)}
            splitRemaining={fromCents(Math.abs(splitRemainingCents))}
            splitOverpays={splitOverpays}
            splitLegCount={splitLegs.length}
            onCommit={() => {
              void form.handleSubmit(onSubmit)()
            }}
            canCommit={canCommit}
            isSubmitting={submitting}
            fsmStatus={createTxn.data?.status}
            creditApplied={useCredit ? fromCents(creditApplyCents) : undefined}
          />
        </div>
      </div>

      <RecordDepositDialog
        open={depositOpen}
        onOpenChange={setDepositOpen}
        patientId={selectedPatient?.id}
        patientName={
          selectedPatient ? `${selectedPatient.lastName}, ${selectedPatient.firstName}` : undefined
        }
      />
    </div>
  )
}

/** SC/PWD/Promo discount toggle + ID-number field for a single patient. */
function DiscountButtons({
  value,
  idNumber,
  inputId,
  idNumberError,
  onTypeChange,
  onIdNumberChange,
}: {
  value: DiscountType
  idNumber: string
  inputId: string
  idNumberError?: string
  onTypeChange: (v: DiscountType) => void
  onIdNumberChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value === 'NA' && <span className="text-xs text-muted-foreground">None applied</span>}
      <Button
        type="button"
        variant={value === 'OSCA' ? 'default' : 'outline'}
        size="sm"
        onClick={() => onTypeChange(value === 'OSCA' ? 'NA' : 'OSCA')}
      >
        <AcronymHint term="OSCA">Senior</AcronymHint> (20%)
      </Button>
      <Button
        type="button"
        variant={value === 'PWD' ? 'default' : 'outline'}
        size="sm"
        onClick={() => onTypeChange(value === 'PWD' ? 'NA' : 'PWD')}
      >
        <AcronymHint term="PWD">PWD</AcronymHint> (20%)
      </Button>
      <Button
        type="button"
        variant={value === 'Other' ? 'default' : 'outline'}
        size="sm"
        onClick={() => onTypeChange(value === 'Other' ? 'NA' : 'Other')}
      >
        Promo
      </Button>
      {value !== 'NA' && (
        <div className="ml-1 space-y-1">
          <div className="flex items-center gap-2">
            <label htmlFor={inputId} className="text-xs text-muted-foreground">
              {value === 'Other' ? 'Promo reference (optional)' : 'ID number (required)'}
            </label>
            <Input
              id={inputId}
              placeholder={value === 'Other' ? 'Promo reference' : 'OSCA / PWD ID #'}
              className="h-8 w-40 text-sm"
              value={idNumber}
              aria-invalid={!!idNumberError}
              aria-describedby={idNumberError ? `${inputId}-error` : undefined}
              onChange={(e) => onIdNumberChange(e.target.value)}
            />
          </div>
          {idNumberError && (
            <p id={`${inputId}-error`} className="text-xs text-destructive">
              {idNumberError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** Debounced search to add an additional patient to a multi-patient bill. */
function AddPatientSearch({
  onSelect,
  excludeIds,
  disabled,
}: {
  onSelect: (p: Patient) => void
  excludeIds: string[]
  disabled?: boolean
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const search = usePatientSearch(q, open && q.length >= 2)
  const results = (search.data?.data ?? []).filter((p) => !excludeIds.includes(p.id))
  return (
    <div className="relative">
      <Search
        className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
        aria-hidden
      />
      <Input
        placeholder="Add another patient to this bill…"
        value={q}
        disabled={disabled}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        className="pl-8"
      />
      {open && q.length >= 2 && (
        <div className="absolute z-20 mt-1 w-full bg-popover border border-border rounded-md shadow-md max-h-64 overflow-auto">
          {search.isLoading && (
            <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
          )}
          {!search.isLoading && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
          )}
          {results.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => {
                onSelect(p)
                setQ('')
                setOpen(false)
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
            >
              <span className="font-medium">
                {p.lastName}, {p.firstName}
              </span>
              <span className="text-xs text-muted-foreground ml-2 font-mono">{p.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
