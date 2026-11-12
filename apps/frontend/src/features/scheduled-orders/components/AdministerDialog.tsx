import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Coins, ShieldAlert, ShieldQuestion } from 'lucide-react'
import {
  useAdministerScheduledOrder,
  useLotRecallMatches,
  useEligibleLots,
  DEFAULT_VIS_VERSION,
  ApiError,
  type AdministerBody,
  type AdministerResult,
  type DoseCalcResult,
  type EligibleLot,
} from '../api'
import DoseCalcPanel from './DoseCalcPanel'
import PostAdministrationObservationPanel from './PostAdministrationObservationPanel'
import AdministeredByField, {
  isAdministeredByComplete,
  type AdministeredByValue,
} from './AdministeredByField'
import { useAuth } from '@/features/auth/context'
import { BrandLotPicker } from '@/components/forms'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { AcronymHint } from '@/components/ui/acronym-hint'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { formatLongDate, formatLongDateTime, formatMoney } from '@/lib/format'
import { CLASS_DISPLAY } from '@/lib/status'

export interface AdministerOrderSummary {
  patientName: string
  patientMrn: string | null
  patientDateOfBirth: string | null
  serviceName: string
  serviceCode: string | null
  requiresDoseCalculation: boolean
  doseNumber: number | null
  scheduledDate: string | null
  quantity: string
  administrationRoute: string | null
  administrationSite: string | null
  indication: string | null
  allergies: string[]
  activeConditions: string[]
}

export interface AdministerPanelProps {
  orderId: string
  orderSummary: AdministerOrderSummary
  /** Called on Cancel / Close. The panel resets by unmounting. */
  onClose: () => void
  /**
   * Continue to the in-app Collect payment step for the just-administered
   * dose. When omitted, the post-administer button falls back to navigating
   * to the cashier page.
   */
  onCollectPayment?: () => void
}

/**
 * Administer-dose flow content: header, consent gate, dose calculator,
 * commit + post-commit lot/recall review, footer. Surface-agnostic: hosted
 * by `AdministerDialog` (modal, e.g. Arrivals Day-0 handoff) and rendered
 * inline as the "Administer" step of the ScheduledOrderDetail rail flow
 * (PATTERNS.md Pattern 35). State resets by unmounting: hosts unmount the
 * panel when the flow exits.
 */
// Nurse-facing copy for `administerOrderTx` failure codes (R6,
// docs/nurse-testing-readiness.md). Every code below is verified against the
// actual throw sites (scheduled_orders/db.ts, inventory/fefo.ts,
// shared/utils/consent.ts), not just the docs table. Wording avoids schema
// jargon a nurse would not recognize (an "encounter" becomes a "visit") and
// states the remedy where one exists. The error code itself is never the
// headline; it renders as a small secondary caption below the sentence.
//
// Any code NOT in this map falls back to ADMINISTER_ERROR_FALLBACK below,
// same as a request that never got a code at all (a network drop, a timeout,
// an uncaught 500). That fallback must never claim the dose was or was not
// given, because a broken response genuinely does not tell us which
// happened, and a nurse who wrongly believes a dose failed may give it twice.
const ADMINISTER_ERROR_COPY: Record<string, string> = {
  // Order lifecycle (administerOrderTx, checked before any deduction).
  NOT_FOUND:
    'This dose could not be found. It may have been removed, so refresh the worklist and try again.',
  ALREADY_COMPLETED:
    'This dose has already been administered. This attempt did not add a second dose, no further action is needed.',
  BRANCH_REQUIRED:
    'Your account is not linked to a branch, so a dose cannot be recorded under it. Ask an admin to attach your account to a branch.',
  // Consent (assertActiveConsent, then the encounter-for-consent check).
  CONSENT_REVOKED:
    "This patient's consent has been withdrawn or was never recorded. Take consent again before giving this dose.",
  CONSENT_BLOCKED:
    "This dose has no visit on file to attach consent to. Register the patient's arrival, or open a visit for them, before giving this dose.",
  // Brand/lot re-validation (deductLot). OUT_OF_STOCK belongs to the
  // automatic FEFO picker used only for point-of-sale bundles, not this
  // dialog, kept here only as a defensive match.
  LOT_NOT_FOUND:
    'That lot could not be found, it may have been removed. Refresh and pick a brand again.',
  LOT_WRONG_BRANCH: 'That lot is held at a different branch. Pick a lot that is in stock here.',
  LOT_QUARANTINED: 'That lot is quarantined and cannot be used. Pick a different brand or lot.',
  LOT_RECALLED: 'That lot is under active recall and cannot be used. Pick a different brand.',
  LOT_EXPIRED: 'That lot has expired. Pick a different brand or lot.',
  LOT_NOT_ELIGIBLE: 'That brand is not approved for this service.',
  LOT_OUT_OF_STOCK: 'That lot ran out. Pick another brand and try again.',
  INVALID_ORDER_QUANTITY:
    'This dose has an invalid quantity and was not recorded. Ask an administrator to review the order before trying again.',
  OUT_OF_STOCK: 'No inventory lot available for this service.',
  NEGATIVE_INVENTORY:
    'Stock changed at the exact moment you submitted, no dose was recorded. Pick the brand again and retry.',
  // Administering-clinician attestation (resolveAdministeringClinician). All of
  // these fail BEFORE the transaction opens, so no dose was recorded and the
  // copy can say so plainly.
  ATTESTATION_REQUIRED:
    'This is a shared clinic login, so the dose needs the name of the nurse or physician giving it. No dose was recorded.',
  ATTESTATION_PIN_REQUIRED:
    "Enter the administering clinician's 4-digit PIN. No dose was recorded.",
  ATTESTATION_PIN_INVALID: 'That PIN is incorrect. No dose was recorded, try again.',
  ATTESTATION_LOCKED_OUT:
    'Too many incorrect PIN attempts for this clinician. Wait a moment before trying again. No dose was recorded.',
  ATTESTATION_NO_PIN_SET:
    'That clinician has no kiosk PIN yet, so the dose cannot be recorded under their name. An admin can set one from their staff record.',
  ATTESTATION_USER_UNKNOWN:
    'That clinician was not found, or their account is no longer active. No dose was recorded.',
  ATTESTATION_ROLE_INVALID:
    'That staff member is not a nurse or physician, so a dose cannot be recorded under them. No dose was recorded.',
  ATTESTATION_WRONG_BRANCH:
    'That clinician is not assigned to this branch. Ask an admin to add them first. No dose was recorded.',
}

// Shown whenever the code above does not recognize what came back (a
// backend code this dialog was never taught), or nothing came back at all.
// Either way the dose's true state is unknown here, so this message never
// says the dose failed or succeeded; it points at the one safe next step,
// checking the record, rather than assuming.
const ADMINISTER_ERROR_FALLBACK =
  'Something went wrong and we could not confirm whether this dose was recorded. Refresh this order to check its status before giving another dose or trying again.'

export function AdministerPanel({
  orderId,
  orderSummary,
  onClose,
  onCollectPayment,
}: AdministerPanelProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [administeredBy, setAdministeredBy] = useState<AdministeredByValue>({
    administeredById: null,
    attestationPin: null,
  })
  const [consentObtained, setConsentObtained] = useState(false)
  const [consentBy, setConsentBy] = useState<AdministerBody['consentBy']>('Patient')
  const [observationMinutes, setObservationMinutes] = useState(15)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined)
  const [result, setResult] = useState<AdministerResult | null>(null)
  const [doseCalcReady, setDoseCalcReady] = useState(!orderSummary.requiresDoseCalculation)
  const [_doseCalcResult, setDoseCalcResult] = useState<DoseCalcResult | null>(null)

  const [selectedLotId, setSelectedLotId] = useState<string | null>(null)
  const [selectedLot, setSelectedLot] = useState<EligibleLot | null>(null)
  const [lotVerified, setLotVerified] = useState(false)
  const [varianceAcknowledged, setVarianceAcknowledged] = useState(false)
  const [recallCheckAcknowledged, setRecallCheckAcknowledged] = useState(false)

  const administer = useAdministerScheduledOrder()

  // Recall lookup runs on the internal representative lot for the selected
  // brand, so the hard stop still lands before the dose is given. After commit
  // it follows the administered lot from the response.
  const lotId = result?.lot?.lotId ?? selectedLotId
  const recallQuery = useLotRecallMatches(lotId)

  // Cross-check against the brand/lot picker's own `isRecalled` flag: that
  // flag comes from the SAME eligible-lots fetch BrandLotPicker already
  // resolved successfully before this lot became selectable, so it is an
  // independent signal that survives even when the dedicated
  // product-recalls lookup below is slow or fails outright.
  const pickerFlaggedRecall = selectedLot?.isRecalled === true
  // Only trust `matches` once the query has actually SUCCEEDED: an errored
  // or still-loading query must never fall back to `[]` and read as "no
  // recall found", which is what silently happened before this fix.
  const recallMatches = recallQuery.isSuccess ? (recallQuery.data?.matches ?? []) : []
  const isConfirmedRecalled = recallMatches.length > 0 || pickerFlaggedRecall

  // "Unresolved" = the dedicated recall check hasn't (yet) confirmed a clean
  // result, and the picker's own signal doesn't already cover it. This is
  // deliberately NOT a hard block (a flaky recall endpoint should not stop
  // a bite patient from getting PEP), but it must never look like "no
  // recall": Confirm stays off until the nurse explicitly acknowledges the
  // status is unknown (see the alert below and `canSubmit`).
  const recallCheckUnresolved =
    // `result === null`, not `!isComplete`: `isComplete` isn't declared until
    // after `handleSubmit` below, and this derivation runs before it.
    result === null && !!selectedLotId && (recallQuery.isPending || recallQuery.isError)
  const needsRecallAck = recallCheckUnresolved && !pickerFlaggedRecall

  // Same query key as the picker's, served from cache, not a second request.
  const eligibleQuery = useEligibleLots(orderId, result === null)
  const billedUnitPrice = eligibleQuery.data?.billedUnitPrice ?? null
  const priceVariance =
    selectedLot && billedUnitPrice !== null
      ? Number(selectedLot.unitPrice) - Number(billedUnitPrice)
      : 0
  const needsVarianceAck = priceVariance > 0

  function handleSubmit() {
    setError(null)
    setErrorCode(undefined)
    administer.mutate(
      {
        id: orderId,
        body: {
          consentBy,
          consentObtained: true,
          visVersion: DEFAULT_VIS_VERSION,
          observationMinutes,
          lotId: selectedLotId!,
          ...(needsVarianceAck ? { brandPriceVarianceAcknowledged: true } : {}),
          // Omitted entirely when the caller attests for themselves: the
          // server reads absence as "the session is the clinician".
          ...(administeredBy.administeredById
            ? {
                administeredById: administeredBy.administeredById,
                attestationPin: administeredBy.attestationPin ?? '',
              }
            : {}),
        },
      },
      {
        onSuccess: (data) => {
          setResult(data)
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            setErrorCode(err.code)
            setError(err.message)
          } else {
            // Network failure, timeout, or anything that never reached a
            // JSON response. `errorCode` stays undefined so the render below
            // falls through to ADMINISTER_ERROR_FALLBACK rather than a
            // message implying the dose failed. `error`'s text itself is
            // never shown for this branch, only used as the "show the
            // alert" flag.
            setErrorCode(undefined)
            setError('Request failed')
          }
        },
      },
    )
  }

  const isComplete = result !== null
  const needsDoseCalc = orderSummary.requiresDoseCalculation && !isComplete
  const canSubmit =
    consentObtained &&
    !administer.isPending &&
    selectedLotId !== null &&
    lotVerified &&
    observationMinutes >= 1 &&
    observationMinutes <= 240 &&
    // Who gave it, proved by their PIN on a shared login.
    isAdministeredByComplete(administeredBy, user?.role) &&
    // A CONFIRMED recall is a hard block, no override: pick a different lot.
    !isConfirmedRecalled &&
    // An UNRESOLVED check is not a hard block, but requires the nurse to
    // consciously acknowledge proceeding without a verified recall status.
    (!needsRecallAck || recallCheckAcknowledged) &&
    (!needsDoseCalc || doseCalcReady) &&
    (!needsVarianceAck || varianceAcknowledged)

  // ⌘↵ commits while the panel is mounted and submittable.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isComplete && canSubmit) {
        e.preventDefault()
        handleSubmit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isComplete,
    canSubmit,
    consentBy,
    selectedLotId,
    needsVarianceAck,
    varianceAcknowledged,
    administeredBy,
  ])

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">
          {isComplete ? 'Dose administered' : 'Administer dose'}
        </h3>
        <p className="text-sm text-muted-foreground">
          {isComplete
            ? 'The dose has been recorded. Review the details below.'
            : 'Confirm consent before administering. This action cannot be undone.'}
        </p>
      </div>

      {/* Bedside checkpoint: this remains visible while consent, brand, and
          clinician attribution are completed below. */}
      <div className="rounded-md border bg-muted/40 px-4 py-3 space-y-1 text-sm">
        <span className="eyebrow">Administration checkpoint</span>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Patient</span>
          <span className="font-medium">{orderSummary.patientName}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Date of birth</span>
          <span className="font-mono tabular-nums font-medium">
            {formatLongDate(orderSummary.patientDateOfBirth)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">MRN</span>
          <span className="font-mono tabular-nums font-medium">
            {orderSummary.patientMrn ?? '—'}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Vaccine / service</span>
          <span className="font-medium">{orderSummary.serviceName}</span>
        </div>
        {orderSummary.doseNumber !== null && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Dose</span>
            <span className="font-mono tabular-nums font-medium">#{orderSummary.doseNumber}</span>
          </div>
        )}
        {orderSummary.scheduledDate && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Scheduled</span>
            <span className="font-mono tabular-nums font-medium">
              {formatLongDate(orderSummary.scheduledDate)}
            </span>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Quantity</span>
          <span className="font-mono tabular-nums font-medium">{orderSummary.quantity}</span>
        </div>
        {orderSummary.administrationRoute && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Route</span>
            <span className="font-mono tabular-nums font-medium">
              {orderSummary.administrationRoute}
            </span>
          </div>
        )}
        {orderSummary.administrationSite && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Site</span>
            <span className="font-medium">{orderSummary.administrationSite}</span>
          </div>
        )}
        {orderSummary.indication && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Clinical context</span>
            <span className="font-medium text-right">{orderSummary.indication}</span>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Selected lot</span>
          <span className="font-medium text-right">
            {selectedLot ? (
              <>
                {selectedLot.product.name} ·{' '}
                <span className="font-mono tabular-nums">{selectedLot.batchNumber}</span> · exp{' '}
                <span className="font-mono tabular-nums">
                  {formatLongDate(selectedLot.expiryDate)}
                </span>
              </>
            ) : (
              'Not selected'
            )}
          </span>
        </div>
      </div>

      {(orderSummary.allergies.length > 0 || orderSummary.activeConditions.length > 0) && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" aria-hidden />
          <AlertTitle>Clinical flags on record</AlertTitle>
          <AlertDescription className="space-y-1 text-sm">
            {orderSummary.allergies.length > 0 && (
              <p>
                <span className="font-medium">Allergies:</span> {orderSummary.allergies.join(', ')}
              </p>
            )}
            {orderSummary.activeConditions.length > 0 && (
              <p>
                <span className="font-medium">Active conditions:</span>{' '}
                {orderSummary.activeConditions.join(', ')}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Lot info, only after administration */}
      {isComplete && result && (
        <div className="rounded-md border bg-muted/40 px-4 py-3 space-y-2 text-sm">
          {selectedLot && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Brand</span>
              <span className="font-medium">{selectedLot.product.name}</span>
            </div>
          )}
          {/* The attribution that actually landed, not the one that was typed.
              A nurse who picked the wrong roster row finds out here, while the
              record is fresh, instead of at an audit months later. */}
          {result.administeredBy && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Given by</span>
              <span className="font-medium">
                {result.administeredBy.fullName}
                {result.administeredBy.licenseNumber && (
                  <span className="ml-1.5 font-mono tabular-nums text-xs text-muted-foreground">
                    {result.administeredBy.licenseNumber}
                  </span>
                )}
              </span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Completed at</span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {formatLongDateTime(result.completedAt)}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Recorded lot</span>
            <span className="font-mono tabular-nums font-medium">
              {result.lot.batchNumber} · exp {formatLongDate(result.lot.expiryDate)}
            </span>
          </div>
        </div>
      )}

      {isComplete && result && (
        <PostAdministrationObservationPanel
          orderId={orderId}
          initialObservation={result.observation}
          onObservationChange={(observation) =>
            setResult((current) => (current ? { ...current, observation } : current))
          }
        />
      )}

      {/* Recall warning: confirmed via the dedicated recall-matches endpoint
          and/or the brand picker's own `isRecalled` flag. Detail lines only
          render when the dedicated endpoint actually returned matches; a
          picker-only signal still blocks Confirm (see `canSubmit`) even
          without a reason/severity to list. */}
      {isConfirmedRecalled && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" aria-hidden />
          <AlertTitle>This lot is under active recall</AlertTitle>
          <AlertDescription>
            {recallMatches.length > 0 ? (
              // text-sm, not text-xs: this is the reason and severity of an
              // active recall, read while deciding whether to proceed.
              <ul className="list-disc pl-4 mt-1 space-y-1 text-sm">
                {recallMatches.map((m) => (
                  <li key={m.id}>
                    {m.recallReason}, severity{' '}
                    <span className="font-semibold">
                      {CLASS_DISPLAY[m.recallSeverity] ?? m.recallSeverity}
                    </span>{' '}
                    (issued {formatLongDate(m.issuedAt)})
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">
                This brand is flagged as recalled and cannot be administered.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Recall check did not complete, and the picker's own signal doesn't
          already cover it: this is genuinely unknown, not "clear". Does not
          hard block (a flaky recall lookup should not stop a bite patient
          from getting PEP), but Confirm stays off until acknowledged. */}
      {needsRecallAck && !isConfirmedRecalled && (
        <Alert>
          <ShieldQuestion className="h-4 w-4" aria-hidden />
          <AlertTitle>Recall status could not be verified</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-xs">
              The recall check for this brand has not completed. This does not mean it is clear,
              only that it could not be confirmed either way.
            </p>
            <div className="flex items-start gap-3">
              <Checkbox
                id="recall-ack"
                checked={recallCheckAcknowledged}
                onCheckedChange={(v) => setRecallCheckAcknowledged(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="recall-ack" className="text-xs leading-snug cursor-pointer">
                I understand the recall status is unknown and choose to proceed
              </Label>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Physical lot selection is explicit and remains unselected by default. */}
      {!isComplete && (
        <div className="space-y-1.5">
          <Label>
            Vaccine lot <span className="text-destructive">*</span>
          </Label>
          <p className="text-xs text-muted-foreground">
            Match the batch and expiry below to the vial in hand. Only eligible stock at this branch
            is listed.
          </p>
          <BrandLotPicker
            orderId={orderId}
            value={selectedLotId}
            onChange={(id, lot) => {
              setSelectedLotId(id)
              setSelectedLot(lot)
              setLotVerified(false)
              setVarianceAcknowledged(false)
              setRecallCheckAcknowledged(false)
            }}
            disabled={administer.isPending}
          />
          {selectedLot && (
            <div className="flex items-start gap-3 pt-1">
              <Checkbox
                id="lot-verified"
                checked={lotVerified}
                onCheckedChange={(v) => setLotVerified(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="lot-verified" className="text-sm leading-snug cursor-pointer">
                I checked the vial label: lot{' '}
                <span className="font-mono tabular-nums">{selectedLot.batchNumber}</span>, expires{' '}
                <span className="font-mono tabular-nums">
                  {formatLongDate(selectedLot.expiryDate)}
                </span>
              </Label>
            </div>
          )}
        </div>
      )}

      {/* Brand costs more than what was already billed for this dose */}
      {!isComplete && needsVarianceAck && selectedLot && (
        <Alert>
          <Coins className="h-4 w-4" aria-hidden />
          <AlertTitle>This brand costs more than the amount billed</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-xs">
              {selectedLot.product.name} is{' '}
              <span className="font-mono tabular-nums">{formatMoney(String(priceVariance))}</span>{' '}
              above the{' '}
              <span className="font-mono tabular-nums">{formatMoney(billedUnitPrice ?? '0')}</span>{' '}
              already billed. The dose still goes ahead and the settled bill is not changed. The
              difference is recorded for the front desk to settle.
            </p>
            <div className="flex items-start gap-3">
              <Checkbox
                id="variance-ack"
                checked={varianceAcknowledged}
                onCheckedChange={(v) => setVarianceAcknowledged(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="variance-ack" className="text-xs leading-snug cursor-pointer">
                I understand the price difference
              </Label>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Who is giving the dose. This attribution is recorded with the dose. */}
      {!isComplete && (
        <AdministeredByField
          value={administeredBy}
          onChange={setAdministeredBy}
          disabled={administer.isPending}
          validationError={errorCode?.startsWith('ATTESTATION_') ? error : null}
        />
      )}

      {/* Dose calculator, required for ERIG/HRIG/HTIG/ATS */}
      {needsDoseCalc && orderSummary.serviceCode && (
        <DoseCalcPanel
          serviceCode={orderSummary.serviceCode}
          onReadyChange={(ready, res) => {
            setDoseCalcReady(ready)
            setDoseCalcResult(res)
          }}
        />
      )}

      {/* Consent by */}
      {!isComplete && (
        <div className="space-y-1.5">
          <Label htmlFor="consent-by">Consent from</Label>
          <Select
            value={consentBy}
            onValueChange={(v) => setConsentBy(v as AdministerBody['consentBy'])}
          >
            <SelectTrigger id="consent-by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Patient">Patient</SelectItem>
              <SelectItem value="Guardian">Guardian</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {!isComplete && (
        <div className="space-y-1.5">
          <Label htmlFor="observation-minutes">Post-dose observation</Label>
          <div className="flex items-center gap-2">
            <Input
              id="observation-minutes"
              type="number"
              min={1}
              max={240}
              step={1}
              value={observationMinutes}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (Number.isInteger(value)) setObservationMinutes(value)
              }}
              className="w-24 font-mono tabular-nums"
            />
            <span className="text-sm text-muted-foreground">minutes</span>
          </div>
          <p className="text-xs text-muted-foreground">
            The clinic default is 15 minutes. Completion starts a tracked observation; reaching the
            end time does not discharge the patient automatically.
          </p>
        </div>
      )}

      {/* VIS version (read-only) */}
      {!isComplete && (
        <div className="space-y-1.5">
          <Label>
            <AcronymHint term="VIS">VIS</AcronymHint> version
          </Label>
          <p className="font-mono tabular-nums text-sm text-muted-foreground px-3 py-2 rounded-md border bg-muted/40">
            {DEFAULT_VIS_VERSION}
          </p>
        </div>
      )}

      {/* Consent checkbox */}
      {!isComplete && (
        <div className="flex items-start gap-3">
          <Checkbox
            id="consent-obtained"
            checked={consentObtained}
            onCheckedChange={(v) => setConsentObtained(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor="consent-obtained" className="text-sm leading-snug cursor-pointer">
            I confirm consent was obtained from the {consentBy.toLowerCase()} before administration
          </Label>
        </div>
      )}

      {/* Error alert. Known codes get nurse-facing copy with a remedy where
          one exists (ADMINISTER_ERROR_COPY above); anything else, including
          no code at all, falls back to a message that cannot mislead about
          whether the dose was given (ADMINISTER_ERROR_FALLBACK). The raw
          code renders as a small secondary caption, never the headline. */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden />
          <AlertDescription>
            <p>{(errorCode && ADMINISTER_ERROR_COPY[errorCode]) || ADMINISTER_ERROR_FALLBACK}</p>
            {errorCode && (
              <p className="mt-1 text-2xs font-mono text-muted-foreground">Code: {errorCode}</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-1">
        {isComplete ? (
          <>
            <Button variant="outline" onClick={onClose}>
              {result?.observation.dischargedAt ? 'Close' : 'Return to worklist'}
            </Button>
            <Button
              onClick={() => {
                if (onCollectPayment) {
                  onCollectPayment()
                } else {
                  navigate('/transactions/new')
                }
              }}
            >
              Collect payment →
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose} disabled={administer.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {administer.isPending ? 'Administering…' : 'Confirm & administer'}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export interface AdministerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderId: string
  orderSummary: AdministerOrderSummary
  /**
   * Open the in-app Collect payment dialog for the just-administered dose.
   * When omitted, the post-administer button falls back to navigating to the
   * cashier page.
   */
  onCollectPayment?: () => void
}

/**
 * Modal host for `AdministerPanel`, used where no detail rail exists
 * (Arrivals Day-0 hand-off). The ScheduledOrderDetail rail renders the
 * panel inline instead (continuous flow, Pattern 35).
 */
export default function AdministerDialog({
  open,
  onOpenChange,
  orderId,
  orderSummary,
  onCollectPayment,
}: AdministerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md xl:max-w-lg">
        {/* Panel renders its own visible heading; these satisfy Radix a11y. */}
        <DialogTitle className="sr-only">Administer dose</DialogTitle>
        <DialogDescription className="sr-only">
          Confirm consent before administering.
        </DialogDescription>
        <AdministerPanel
          orderId={orderId}
          orderSummary={orderSummary}
          onClose={() => onOpenChange(false)}
          onCollectPayment={
            onCollectPayment
              ? () => {
                  onOpenChange(false)
                  onCollectPayment()
                }
              : undefined
          }
        />
      </DialogContent>
    </Dialog>
  )
}
