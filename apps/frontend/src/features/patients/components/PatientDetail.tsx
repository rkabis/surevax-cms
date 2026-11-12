import { useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { format, differenceInYears } from 'date-fns'
import { DASH, formatMoney } from '@/lib/format'
import { toCents } from '@/lib/money'
import {
  AlertCircle,
  Stethoscope,
  ArrowLeft,
  Edit,
  Printer,
  AlertTriangle,
  Trash2,
  FileText,
  ShieldAlert,
  PackageX,
  FlaskConical,
  Eye,
  Workflow,
} from 'lucide-react'
import {
  usePatient,
  usePatientEncounters,
  useCancelPendingOrders,
  usePatientDemographic,
  downloadHealthCard,
  type PatientEncounter,
  type BreakGlassChart,
} from '../api'
import { useAuth } from '@/features/auth/context'
import BreakGlassReveal from './BreakGlassReveal'
import { usePatientBalance } from '../accountApi'
import PayBalanceDialog from '@/features/transactions/components/PayBalancePanel'
import { PhoneLink } from '@/components/PhoneLink'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { avatarColor } from '@/lib/avatarColor'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'

import EmergencyContactsTab from './EmergencyContactsTab'
import ExternalImmunizationsTab from './ExternalImmunizationsTab'
import ConsentsTab from './ConsentsTab'
import StandingOrderTab from './StandingOrderTab'
import PatientAccountTab from './PatientAccountTab'
import AllergiesCard from './AllergiesCard'
import ConditionsCard from './ConditionsCard'

import { ComingSoonButton, ErrorBanner } from '@/components/layout'
import { DoseStrip } from '@/components/clinical'
import { ENCOUNTER_STATUS_VARIANT as STATUS_VARIANT, humanizeStatus } from '@/lib/status'
import { useAuditEvent } from '@/hooks/useAuditEvent'
import { ADMIN_ROLES } from '@/lib/roles'

// ADMIN_ROLES (@/lib/roles) is the one admin notion, shared with AppShell nav
// and App.tsx's RequireAdminLayout. The bulk-cancel endpoint itself is mounted
// requireRole('TenantAdmin') only (narrower than that set), so a BranchAdmin
// could still see the button below and get a real 403; the mutation's onError
// handler makes that visible instead of silent.

function providerLabel(e: PatientEncounter): string {
  const first = e.providerFirstName ?? ''
  const last = e.providerLastName ?? ''
  return `${first} ${last}`.trim()
}

function initials(firstName: string, lastName: string): string {
  return `${lastName[0] ?? ''}${firstName[0] ?? ''}`.toUpperCase()
}

function encounterKind(e: PatientEncounter): {
  label: string
  variant: 'due' | 'info' | 'outline'
} {
  const s = e.specialty?.toLowerCase() ?? ''
  if (s.includes('pep') || s.includes('rabies')) return { label: 'pep-start', variant: 'due' }
  if (s.includes('vaccin') || s.includes('immun')) return { label: 'vaccine', variant: 'info' }
  if (s.includes('consult')) return { label: 'consult', variant: 'outline' }
  return { label: 'encounter', variant: 'outline' }
}

/**
 * The ordinary encounter endpoint is branch-scoped. Once break-glass succeeds,
 * its audited response is the only source allowed to widen this read surface.
 */
export function patientDetailEncounters(
  branchEncounters: PatientEncounter[],
  revealedChart: BreakGlassChart | null,
): PatientEncounter[] {
  if (!revealedChart) return branchEncounters

  return revealedChart.encounters.map((encounter) => ({
    id: encounter.id,
    specialty: encounter.specialty,
    status: encounter.status,
    bundleLabel: encounter.visitNo
      ? `Visit ${encounter.visitNo}`
      : 'Cross-branch clinical encounter',
    chiefComplaint: encounter.chiefComplaint,
    startedAt: encounter.startedAt,
    completedAt: encounter.completedAt,
    providerFirstName: encounter.provider?.firstName ?? null,
    providerLastName: encounter.provider?.lastName ?? null,
    providerLicenseNumber: encounter.provider?.licenseNumber ?? null,
    branchDisplayId: encounter.branch?.displayId ?? null,
    branchName: encounter.branch?.name ?? null,
  }))
}

export function PatientTimeline({
  encounters,
  isLoading,
  isError,
}: {
  encounters: PatientEncounter[]
  isLoading: boolean
  isError: boolean
}) {
  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    )
  }
  if (isError) {
    return (
      <div className="p-4 flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" aria-hidden />
        Failed to load encounters.
      </div>
    )
  }
  if (encounters.length === 0) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">No encounters yet.</p>
      </div>
    )
  }

  return encounters.map((encounter, index) => {
    const kind = encounterKind(encounter)
    return (
      <div
        key={encounter.id}
        className={cn(
          'flex items-start gap-3 px-4 py-3',
          index < encounters.length - 1 && 'border-b border-border',
        )}
      >
        <div className="w-20 shrink-0">
          <p className="text-sm font-medium">
            {encounter.startedAt ? format(new Date(encounter.startedAt), 'MMM d') : '—'}
          </p>
          <p className="text-xs text-muted-foreground">
            {encounter.startedAt ? format(new Date(encounter.startedAt), 'HH:mm') : '—'}
          </p>
        </div>
        <Badge variant={kind.variant} className="text-xs">
          {kind.label}
        </Badge>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{encounter.specialty}</p>
          {encounter.chiefComplaint && (
            <p className="text-xs text-muted-foreground mt-0.5">{encounter.chiefComplaint}</p>
          )}
        </div>
        <div className="shrink-0 text-right text-xs text-muted-foreground">
          {providerLabel(encounter) && <p>{providerLabel(encounter)}</p>}
          {encounter.providerLicenseNumber && (
            <p className="font-mono tabular-nums">{encounter.providerLicenseNumber}</p>
          )}
          {encounter.branchName && (
            <p>
              {encounter.branchName}
              {encounter.branchDisplayId ? ` · ${encounter.branchDisplayId}` : ''}
            </p>
          )}
        </div>
      </div>
    )
  })
}

type Props = {
  patientId: string
  onBack?: () => void
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm mt-0.5">{value ?? DASH}</dd>
    </div>
  )
}

export default function PatientDetail({ patientId, onBack }: Props) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const isAdmin = ADMIN_ROLES.has(user?.role ?? '')
  const { data: patient, isLoading, isError } = usePatient(patientId)
  const {
    data: encountersData,
    isLoading: encountersLoading,
    isError: encountersError,
  } = usePatientEncounters(patientId, 5)
  // Tier-1 cross-branch demographic projection (always fetch, provides safety
  // signals). isError/refetch matter: this call used to 403 silently for the
  // Branch persona (the only login a real clinic uses), which left
  // `demographic` undefined and rendered a chart with no recall banner and no
  // critical-lab flag: looking clean when it just hadn't loaded. See the
  // error banner below and usePatientDemographic's JSDoc.
  const {
    data: demographic,
    isError: demographicError,
    isLoading: demographicLoading,
    refetch: refetchDemographic,
  } = usePatientDemographic(patientId)
  // Cross-branch detection must precede financial reads. A break-glass chart
  // remains clinical read-only and never widens account/export access.
  const isCrossBranch =
    demographic?.homeBranchId != null &&
    user?.branchId != null &&
    String(demographic.homeBranchId) !== String(user.branchId)
  // Fail closed while branch context is loading or unavailable: otherwise a
  // local-action button can flash briefly before a cross-branch response lands.
  const patientActionsReadOnly = demographic == null || isCrossBranch
  // Server-computed accounts-receivable position: fail closed until the
  // demographic projection proves this is a local patient.
  const { data: balance } = usePatientBalance(patientId, {
    enabled: !patientActionsReadOnly,
  })
  const [showMoreDemo, setShowMoreDemo] = useState(false)
  const [payBalanceOpen, setPayBalanceOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelResult, setCancelResult] = useState<{
    cancelledCount: number
    cancelledOrderIds: string[]
  } | null>(null)
  const cancelReasonRef = useRef<HTMLTextAreaElement>(null)
  const cancelPendingOrders = useCancelPendingOrders(patientId)
  const { recordExport } = useAuditEvent()
  const [healthCardLoading, setHealthCardLoading] = useState(false)
  const [healthCardError, setHealthCardError] = useState<string | null>(null)
  // Cross-branch reveal state (Step 8c)
  const [breakGlassOpen, setBreakGlassOpen] = useState(false)
  const [crossBranchChart, setCrossBranchChart] = useState<BreakGlassChart | null>(null)

  async function handleDownloadHealthCard() {
    setHealthCardLoading(true)
    setHealthCardError(null)
    try {
      const blob = await downloadHealthCard(patientId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `health-card-${patientId}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      // A health card is PHI leaving the building, so record who took it.
      // Fired after the blob resolved and the download was actually triggered,
      // so a failed fetch is never logged as an export. Non-blocking: losing
      // the trail entry is bad, but refusing a nurse a health card because an
      // audit write hiccuped is worse.
      recordExport({
        entityType: 'patients',
        entityId: patientId,
        documentType: 'health_card_pdf',
      })
    } catch (err) {
      setHealthCardError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setHealthCardLoading(false)
    }
  }

  const encounters = patientDetailEncounters(encountersData?.data ?? [], crossBranchChart)
  const encountersAreLoading = !crossBranchChart && encountersLoading
  const encountersHaveError = !crossBranchChart && encountersError
  const activeEncounter = encounters[0]
  const outstandingStr = balance?.grossOutstanding ?? '0.00'
  const outstandingCents = toCents(outstandingStr)
  const openBillCount = balance?.openBillCount ?? 0

  // Tab state, URL-as-state (PATTERNS.md Pattern 34): `?tab=` survives
  // refresh and powers deep links (e.g. `?tab=billing` from a receivables list).
  const requestedTab = searchParams.get('tab') ?? 'overview'
  const tab = patientActionsReadOnly && requestedTab === 'billing' ? 'overview' : requestedTab
  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'overview') {
      params.delete('tab')
    } else {
      params.set('tab', next)
    }
    setSearchParams(params, { replace: true })
  }

  // Safety signals from Tier-1 projection (always visible regardless of branch)
  const activeRecalls = demographic?.activeRecalls ?? []
  const recentCritical = demographic?.recentCriticalLabResults ?? []
  const recordedAllergies = demographic?.allergies ?? []
  const activeConditions = demographic?.activeConditions ?? []
  const hasRecalls = activeRecalls.length > 0
  const hasCritical = recentCritical.some((r) => r.criticalAcknowledgedAt === null)

  if (isLoading) {
    return (
      <ScrollArea className="h-full">
        <div className="p-6 space-y-4">
          <Skeleton className="h-4 w-32" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="space-y-1">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        </div>
      </ScrollArea>
    )
  }

  if (isError || !patient) {
    return <ErrorBanner message="Failed to load patient." className="p-6" />
  }

  const age = patient.dateOfBirth
    ? differenceInYears(new Date(), new Date(patient.dateOfBirth))
    : null

  const dob = patient.dateOfBirth ? format(new Date(patient.dateOfBirth), 'MMM d, yyyy') : null

  const fullName = `${patient.lastName}, ${patient.firstName}${patient.middleName ? ` ${patient.middleName[0]}.` : ''}`

  return (
    <ScrollArea className="h-full">
      <div className="p-6 xl:p-8 space-y-4">
        {/* Back link */}
        <button
          type="button"
          onClick={() => (onBack ? onBack() : navigate('/patients'))}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to Patients
        </button>

        {/* Header */}
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback
              className="text-white"
              style={{ backgroundColor: avatarColor(patient.id) }}
            >
              {initials(patient.firstName, patient.lastName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold truncate">{fullName}</h2>
            <p className="text-sm text-muted-foreground font-mono tabular-nums">
              MRN {patient.mrn} · DOB {dob ?? 'not recorded'}
              {age !== null ? ` · ${age} yrs` : ''}
              {patient.sex ? ` · ${patient.sex}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <TooltipProvider>
              {!patientActionsReadOnly && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1 px-2"
                      onClick={() => navigate(`/patients/${patient.id}/edit`)}
                      disabled={!!patient.deletedAt}
                    >
                      <Edit className="h-3.5 w-3.5" aria-hidden />
                      Edit
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit patient details</TooltipContent>
                </Tooltip>
              )}
              <ComingSoonButton
                size="sm"
                className="h-8 text-xs px-2"
                icon={<Printer className="h-3.5 w-3.5" aria-hidden />}
              >
                Print
              </ComingSoonButton>
              {!patientActionsReadOnly && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1 px-2"
                      onClick={handleDownloadHealthCard}
                      disabled={healthCardLoading || !!patient.deletedAt}
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                      {healthCardLoading ? 'Downloading…' : 'Health card'}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Download patient health card PDF</TooltipContent>
                </Tooltip>
              )}
            </TooltipProvider>
            {healthCardError && <p className="text-xs text-destructive mt-1">{healthCardError}</p>}
            {!patientActionsReadOnly && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/initiate-protocol?patientId=${patient.id}`)}
                  disabled={!patient.isActive || !!patient.deletedAt}
                  className="h-8 text-xs gap-1 px-2"
                >
                  <Workflow className="h-3.5 w-3.5" aria-hidden />
                  Initiate protocol
                </Button>
                <Button
                  size="sm"
                  onClick={() => navigate(`/patients/${patient.id}/encounters/new`)}
                  disabled={!patient.isActive || !!patient.deletedAt}
                  className="h-8 text-xs gap-1 px-2"
                >
                  <Stethoscope className="h-3.5 w-3.5" aria-hidden />
                  New encounter
                </Button>
              </>
            )}
            {isAdmin && !patientActionsReadOnly && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8 text-xs gap-1 px-2"
                      onClick={() => {
                        setCancelReason('')
                        setCancelResult(null)
                        setCancelModalOpen(true)
                      }}
                      disabled={!!patient.deletedAt}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Cancel pending
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Cancel all pending / scheduled orders for this patient
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>

        {/* ── Tier-1 safety banners — always visible (cross-branch + same-branch) ── */}

        {/* Tier-1 safety-check failure: a failed fetch must be VISIBLE, never
            rendered as a silently clean chart. Do not read this as "no
            recalls" or "no critical labs": those signals could not be
            verified at all. Loading state is excluded so this doesn't flash
            on every page open. */}
        {demographicError && !demographicLoading && (
          <div className="flex items-center gap-3 rounded-lg border border-triage-overdue/35 bg-triage-overdue-soft px-4 py-3">
            <AlertCircle className="h-4 w-4 text-triage-overdue shrink-0" aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-triage-overdue">Safety check unavailable</p>
              <p className="text-xs text-muted-foreground">
                Could not verify product recalls or critical lab results for this patient. Retry
                before administering.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 px-2 shrink-0"
              onClick={() => refetchDemographic()}
            >
              Retry
            </Button>
          </div>
        )}

        {/* Active product recall banner (RFC §4.2) */}
        {hasRecalls && (
          <div className="flex items-center gap-3 rounded-lg border border-triage-overdue/35 bg-triage-overdue-soft px-4 py-3">
            <PackageX className="h-4 w-4 text-triage-overdue shrink-0" aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-triage-overdue">
                {activeRecalls.length} active product recall
                {activeRecalls.length !== 1 ? 's' : ''} affecting administered lots
              </p>
              <p className="text-xs text-muted-foreground">
                {activeRecalls.map((r) => r.recallSeverity + ' — ' + r.recallReason).join(' · ')}
              </p>
            </div>
          </div>
        )}

        {/* Unacknowledged critical lab banner (D5) */}
        {hasCritical && (
          <div className="flex items-center gap-3 rounded-lg border border-triage-overdue/35 bg-triage-overdue-soft px-4 py-3">
            <FlaskConical className="h-4 w-4 text-triage-overdue shrink-0" aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-triage-overdue">
                Unacknowledged critical lab result
                {recentCritical.filter((r) => !r.criticalAcknowledgedAt).length !== 1
                  ? 's'
                  : ''}{' '}
                (last 90 days)
              </p>
              <p className="text-xs text-muted-foreground">
                Review in the Lab Orders section and acknowledge.
              </p>
            </div>
          </div>
        )}

        {/* Cross-branch access banner — shown when patient's home branch ≠ caller's branch */}
        {isCrossBranch && !crossBranchChart && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
            <ShieldAlert className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Cross-branch record</p>
              <p className="text-xs text-muted-foreground">
                This patient&apos;s full clinical chart is at another branch. Identity, safety
                flags, and recent doses are shown above. Reveal the complete chart to view
                encounters and transactions.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 px-2 shrink-0"
              onClick={() => setBreakGlassOpen(true)}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden />
              Reveal record
            </Button>
          </div>
        )}

        {/* Cross-branch revealed indicator */}
        {isCrossBranch && crossBranchChart && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
            <ShieldAlert className="h-4 w-4 text-triage-ok shrink-0" aria-hidden />
            <p className="text-sm text-muted-foreground flex-1">
              Cross-branch record revealed — access logged (
              <span className="font-mono text-xs">{crossBranchChart.grantId}</span>)
            </p>
          </div>
        )}

        {/* A compact clinical context keeps established risks in the nurse's
            scan path. It uses the Tier-1 demographic projection, which is
            intentionally available cross-branch; detailed editing remains in
            the overview cards below. */}
        {!demographicLoading && (recordedAllergies.length > 0 || activeConditions.length > 0) && (
          <section
            aria-label="Clinical context"
            className="flex items-start gap-3 rounded-lg border border-triage-due/35 bg-triage-due-soft px-4 py-3"
          >
            <AlertTriangle className="h-4 w-4 text-triage-due shrink-0 mt-0.5" aria-hidden />
            <div className="min-w-0 space-y-1 text-xs">
              <p className="text-sm font-medium text-foreground">Clinical context</p>
              {recordedAllergies.length > 0 && (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Allergies:</span>{' '}
                  {recordedAllergies
                    .slice(0, 3)
                    .map((allergy) =>
                      allergy.severity
                        ? `${allergy.allergen} (${allergy.severity})`
                        : allergy.allergen,
                    )
                    .join(' · ')}
                  {recordedAllergies.length > 3 ? ` · +${recordedAllergies.length - 3} more` : ''}
                </p>
              )}
              {activeConditions.length > 0 && (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Active conditions:</span>{' '}
                  {activeConditions
                    .slice(0, 3)
                    .map((condition) => condition.name)
                    .join(' · ')}
                  {activeConditions.length > 3 ? ` · +${activeConditions.length - 3} more` : ''}
                </p>
              )}
            </div>
          </section>
        )}

        {/* Alert banner: outstanding balance across this patient's open bills */}
        {!patientActionsReadOnly && outstandingCents > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-triage-overdue/35 bg-triage-overdue-soft px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-triage-overdue shrink-0" aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-triage-overdue">
                {openBillCount} unsettled invoice{openBillCount !== 1 ? 's' : ''} ·{' '}
                {formatMoney(outstandingStr)}
              </p>
              <p className="text-xs text-muted-foreground">
                Payment required before next administration.
              </p>
            </div>
            <Button
              size="sm"
              className="h-7 text-xs gap-1 px-2"
              onClick={() => setPayBalanceOpen(true)}
            >
              Take payment
            </Button>
          </div>
        )}

        {/* Tab bar */}
        <Tabs value={tab} onValueChange={setTab}>
          <div className="border-b border-border">
            <TabsList className="w-full justify-start rounded-none bg-transparent p-0 h-auto gap-0">
              {[
                { id: 'overview', label: 'Overview' },
                {
                  id: 'timeline',
                  label: 'Timeline',
                  count: encounters.length,
                },
                { id: 'contacts', label: 'Contacts' },
                { id: 'immunizations', label: 'Immunizations' },
                { id: 'standing-order', label: 'Standing order' },
                { id: 'consents', label: 'Consents' },
                {
                  id: 'billing',
                  label: 'Account',
                  count: openBillCount,
                  alert: outstandingCents > 0,
                },
              ]
                .filter((t) => !patientActionsReadOnly || t.id !== 'billing')
                .map((t) => (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none h-10 px-3 text-sm font-medium"
                  >
                    {t.label}
                    {t.count != null && (
                      <span
                        className={cn(
                          'ml-1.5 text-xs',
                          t.alert ? 'text-triage-overdue' : 'text-muted-foreground',
                        )}
                      >
                        · {t.count}
                        {t.alert ? ' unpaid' : ''}
                      </span>
                    )}
                  </TabsTrigger>
                ))}
            </TabsList>
          </div>

          {/* ── Overview tab ──────────────────────────────────────────── */}
          <TabsContent value="overview" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] xl:grid-cols-[1fr_23.75rem] gap-4">
              {/* Left column */}
              <div className="space-y-4">
                {/* Active Encounter card */}
                {activeEncounter && (
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-sm">Active Encounter</CardTitle>
                          <CardDescription>
                            {activeEncounter.specialty} · {activeEncounter.bundleLabel}
                            {activeEncounter.startedAt &&
                              ` · started ${format(new Date(activeEncounter.startedAt), 'MMM d, yyyy')}`}
                          </CardDescription>
                        </div>
                        <Badge
                          variant={
                            STATUS_VARIANT[activeEncounter.status] === 'due'
                              ? 'due'
                              : STATUS_VARIANT[activeEncounter.status] === 'overdue'
                                ? 'overdue'
                                : 'ok'
                          }
                        >
                          {humanizeStatus(activeEncounter.status)}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Real per-dose schedule for the patient's active
                          standing-order course (getActiveDoseStatesTx,
                          patients/db.ts), mirrors the list endpoint's
                          doseStates (see PatientList.tsx). This card used to
                          render a hardcoded D0/D3/D7/D14 strip for every
                          patient regardless of their real schedule; that was
                          removed as fiction until the detail read actually
                          carried the data. Courses longer than 8 doses fall
                          back to a count badge, same cutoff as the list. */}
                      {patient.pepTotal != null &&
                        patient.pepTotal > 0 &&
                        (patient.pepTotal <= 8 ? (
                          <div className="flex items-center gap-2">
                            <DoseStrip
                              size="sm"
                              doses={(
                                patient.doseStates ??
                                Array.from({ length: patient.pepTotal }, (_, i) =>
                                  i < (patient.pepCompleted ?? 0)
                                    ? ('done' as const)
                                    : ('upcoming' as const),
                                )
                              ).map((state, i) => ({
                                label: `Dose ${i + 1}`,
                                state: state === 'upcoming' ? ('' as const) : state,
                              }))}
                            />
                            <span className="text-xs font-mono tabular-nums text-muted-foreground">
                              {patient.pepCompleted ?? 0}/{patient.pepTotal}
                            </span>
                          </div>
                        ) : (
                          <Badge
                            variant={patient.pepCompleted === patient.pepTotal ? 'ok' : 'due'}
                            className="text-xs"
                          >
                            {patient.pepCompleted ?? 0}/{patient.pepTotal}
                          </Badge>
                        ))}
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <span className="text-xs text-muted-foreground">Clinician</span>
                          <p className="text-sm font-medium">
                            {providerLabel(activeEncounter) || '—'}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 px-2 shrink-0"
                          onClick={() => setTab('standing-order')}
                        >
                          View schedule
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Recent Activity */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Recent activity</CardTitle>
                      <ComingSoonButton size="sm" className="h-7 text-xs">
                        View all
                      </ComingSoonButton>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {encountersAreLoading ? (
                      <div className="p-4 space-y-2">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <Skeleton key={i} className="h-12" />
                        ))}
                      </div>
                    ) : encounters.length === 0 ? (
                      <div className="p-4">
                        <p className="text-sm text-muted-foreground">No activity yet.</p>
                      </div>
                    ) : (
                      <div>
                        {encounters.slice(0, 4).map((e, i) => {
                          const kind = encounterKind(e)
                          return (
                            <div
                              key={e.id}
                              className={cn(
                                'flex items-start gap-3 px-4 py-3',
                                i < Math.min(encounters.length, 4) - 1 && 'border-b border-border',
                              )}
                            >
                              <div className="w-14 shrink-0">
                                <p className="text-sm font-medium">
                                  {e.startedAt ? format(new Date(e.startedAt), 'MMM d') : '—'}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {e.startedAt ? format(new Date(e.startedAt), 'HH:mm') : '—'}
                                </p>
                              </div>
                              <div
                                className={cn(
                                  'h-1.5 w-1.5 rounded-full mt-2 shrink-0',
                                  kind.variant === 'due' && 'bg-triage-due',
                                  kind.variant === 'info' && 'bg-triage-info',
                                  kind.variant === 'outline' && 'bg-muted-foreground',
                                )}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{e.specialty}</p>
                                {e.chiefComplaint && (
                                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                    {e.chiefComplaint}
                                  </p>
                                )}
                                <p className="text-xs text-muted-foreground mt-1">
                                  {providerLabel(e)}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Vitals + Allergies */}
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Vitals (last)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <dl className="space-y-2">
                        <div className="flex justify-between">
                          <dt className="text-xs text-muted-foreground">BP</dt>
                          <dd className="text-sm font-medium">—</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-xs text-muted-foreground">Heart rate</dt>
                          <dd className="text-sm font-medium">—</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-xs text-muted-foreground">Temp</dt>
                          <dd className="text-sm font-medium">—</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-xs text-muted-foreground">SpO₂</dt>
                          <dd className="text-sm font-medium">—</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-xs text-muted-foreground">Taken</dt>
                          <dd className="text-xs text-muted-foreground">No readings</dd>
                        </div>
                      </dl>
                    </CardContent>
                  </Card>

                  <AllergiesCard
                    patientId={patientId}
                    isCrossBranch={patientActionsReadOnly}
                    revealedAllergies={crossBranchChart?.allergies}
                  />
                  <ConditionsCard
                    patientId={patientId}
                    isCrossBranch={patientActionsReadOnly}
                    revealedConditions={crossBranchChart?.conditions}
                  />
                </div>
              </div>

              {/* Right column */}
              <div className="space-y-4">
                {/* Demographics */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Demographics</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="space-y-3">
                      {patient.contactNumber && (
                        <div>
                          <dt className="text-xs text-muted-foreground">Phone</dt>
                          <dd className="text-sm mt-0.5">
                            <PhoneLink value={patient.contactNumber} />
                          </dd>
                        </div>
                      )}
                      {(patient.address || patient.city) && (
                        <Field
                          label="Address"
                          value={[patient.address, patient.city, patient.province]
                            .filter(Boolean)
                            .join(', ')}
                        />
                      )}
                      {patient.guardianName && (
                        <div>
                          <dt className="text-xs text-muted-foreground">Emergency</dt>
                          <dd className="text-sm mt-0.5">
                            {patient.guardianName}
                            {patient.guardianRelationship
                              ? ` (${patient.guardianRelationship})`
                              : ''}
                            {patient.guardianContact ? (
                              <>
                                {' · '}
                                <PhoneLink value={patient.guardianContact} />
                              </>
                            ) : null}
                          </dd>
                        </div>
                      )}
                      {showMoreDemo && (
                        <>
                          {patient.email && <Field label="Email" value={patient.email} />}
                          <Field label="Civil status" value={patient.civilStatus} />
                          <Field label="Nationality" value={patient.nationality} />
                          {patient.barangay && <Field label="Barangay" value={patient.barangay} />}
                        </>
                      )}
                    </dl>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs mt-2"
                      onClick={() => setShowMoreDemo((v) => !v)}
                    >
                      {showMoreDemo ? 'Show less' : 'More details'}
                    </Button>
                  </CardContent>
                </Card>

                {/* Outstanding balance */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Outstanding balance</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Unsettled</p>
                      <p
                        className={cn(
                          'text-2xl font-semibold font-mono tabular-nums',
                          outstandingCents > 0 ? 'text-triage-overdue' : 'text-foreground',
                        )}
                      >
                        {formatMoney(outstandingStr)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {outstandingCents > 0
                          ? `across ${openBillCount} open bill${openBillCount !== 1 ? 's' : ''}`
                          : 'Nothing owed'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Credit available</p>
                        <p className="text-sm font-mono tabular-nums font-medium">
                          {formatMoney(balance?.availableCredit)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Net position</p>
                        <p className="text-sm font-mono tabular-nums font-medium">
                          {formatMoney(balance?.netOutstanding)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {outstandingCents > 0 && (
                        <ComingSoonButton size="sm" className="h-7 text-xs px-2">
                          Send invoice
                        </ComingSoonButton>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2"
                        onClick={() => navigate(`/patients/${patientId}/statement`)}
                      >
                        Statement
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Coverage */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Coverage</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="space-y-3">
                      <Field
                        label="PhilHealth"
                        value={
                          patient.insuranceProvider?.toLowerCase().includes('philhealth')
                            ? 'Active'
                            : 'No record'
                        }
                      />
                      <Field label="HMO" value="—" />
                      <Field label="Discount" value="—" />
                      <Field label="Insurance" value={patient.insuranceProvider ?? 'None'} />
                      {patient.insurancePolicyNumber && (
                        <Field label="Policy number" value={patient.insurancePolicyNumber} />
                      )}
                    </dl>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* ── Timeline tab ──────────────────────────────────────────── */}
          <TabsContent value="timeline" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <PatientTimeline
                  encounters={encounters}
                  isLoading={encountersAreLoading}
                  isError={encountersHaveError}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Contacts tab ──────────────────────────────────────────── */}
          <TabsContent value="contacts" className="mt-4">
            <EmergencyContactsTab patientId={patientId} isCrossBranch={patientActionsReadOnly} />
          </TabsContent>

          {/* ── Immunizations tab ─────────────────────────────────────── */}
          <TabsContent value="immunizations" className="mt-4">
            <ExternalImmunizationsTab
              patientId={patientId}
              isCrossBranch={patientActionsReadOnly}
            />
          </TabsContent>

          {/* ── Standing order tab ────────────────────────────────────── */}
          <TabsContent value="standing-order" className="mt-4">
            <StandingOrderTab
              patientId={patientId}
              patientName={fullName}
              isCrossBranch={patientActionsReadOnly}
            />
          </TabsContent>

          {/* ── Consents tab ──────────────────────────────────────────── */}
          <TabsContent value="consents" className="mt-4">
            <ConsentsTab patientId={patientId} />
          </TabsContent>

          {/* ── Account tab (billing) ────────────────────────────────── */}
          {!patientActionsReadOnly && (
            <TabsContent value="billing" className="mt-4">
              <PatientAccountTab patientId={patientId} patientName={fullName} />
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Cancel pending orders modal */}
      <Dialog
        open={cancelModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCancelModalOpen(false)
            setCancelResult(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel pending orders</DialogTitle>
            <DialogDescription>
              This will cancel all <strong>Scheduled</strong> and <strong>Pending</strong> clinical
              orders for {patient.firstName} {patient.lastName}. Completed orders will not be
              affected. This action is audited and cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {cancelResult ? (
            <div className="py-2 space-y-2">
              <p className="text-sm text-muted-foreground">
                {cancelResult.cancelledCount === 0
                  ? 'No pending orders found — nothing was changed.'
                  : `${cancelResult.cancelledCount} order${cancelResult.cancelledCount !== 1 ? 's' : ''} cancelled successfully.`}
              </p>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="cancel-reason">
                  Reason <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="cancel-reason"
                  ref={cancelReasonRef}
                  placeholder="e.g. Patient deceased, bulk cancel"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={3}
                />
                {cancelReason.length > 0 && cancelReason.length < 5 && (
                  <p className="text-xs text-destructive">Minimum 5 characters required.</p>
                )}
              </div>
              {cancelPendingOrders.isError && (
                <p className="text-sm text-destructive flex items-center gap-1" role="alert">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                  {apiErrorMessage(cancelPendingOrders.error)}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCancelModalOpen(false)
                setCancelResult(null)
              }}
            >
              {cancelResult ? 'Close' : 'Cancel'}
            </Button>
            {!cancelResult && (
              <Button
                variant="destructive"
                disabled={cancelReason.trim().length < 5 || cancelPendingOrders.isPending}
                onClick={() => {
                  cancelPendingOrders.mutate(
                    { reason: cancelReason.trim() },
                    {
                      onSuccess: (data) => {
                        setCancelResult(data)
                      },
                      onError: (error) => {
                        toast.error('Failed to cancel pending orders', {
                          description: apiErrorMessage(error),
                        })
                      },
                    },
                  )
                }}
              >
                {cancelPendingOrders.isPending ? 'Cancelling…' : 'Confirm cancel'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Break-glass cross-branch reveal modal (RFC Step 8c). Uses
          homeBranchDisplayId (e.g. "SVX.TMG"), not homeBranchId stringified:
          the backend resolves targetBranchId as a branch display_id
          (breakGlassBody, patients/contract.ts), and the bigint FK would
          never match, silently 404ing every reveal as BRANCH_NOT_FOUND. This
          path was unreachable for the Branch persona until R3 widened the
          role gate, so the mismatch had never been exercised. */}
      {isCrossBranch && demographic && demographic.homeBranchDisplayId && (
        <BreakGlassReveal
          open={breakGlassOpen}
          onOpenChange={setBreakGlassOpen}
          patientDisplayId={patientId}
          targetBranchDisplayId={demographic.homeBranchDisplayId}
          onReveal={(chart) => setCrossBranchChart(chart)}
        />
      )}

      {/* Pay balance dialog, opened from the alert banner's "Take payment" */}
      {!patientActionsReadOnly && (
        <PayBalanceDialog
          open={payBalanceOpen}
          onOpenChange={setPayBalanceOpen}
          patientId={patientId}
          patientName={fullName}
        />
      )}
    </ScrollArea>
  )
}
