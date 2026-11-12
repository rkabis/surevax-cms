import { useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Stethoscope } from 'lucide-react'
import { differenceInYears, format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { encounterVitalsSchema, biteAssessmentSchema } from '@surevax/shared'
import VitalsPanel from '@/features/encounters/components/VitalsPanel'
import BiteAssessmentPanel from '@/features/encounters/components/BiteAssessmentPanel'
import { usePatient } from '@/features/patients/api'
import { useArrival, useWizardGuardTarget } from '../context'
import { useAdvanceShortcut } from '../use-advance-shortcut'
import { useSafeForm } from '@/lib/useSafeForm'

const SPECIALTIES = ['Rabies', 'Flu', 'Vaccination', 'General'] as const
type Specialty = (typeof SPECIALTIES)[number]

const SPECIALTY_SEVERITY: Record<Specialty, 'overdue' | 'due' | 'ok' | 'info'> = {
  Rabies: 'overdue',
  Flu: 'due',
  Vaccination: 'ok',
  General: 'info',
}

const baseSchema = z.object({
  specialty: z.enum(SPECIALTIES, {
    errorMap: () => ({ message: 'Select a specialty before continuing.' }),
  }),
  chiefComplaint: z.string().min(1, 'Required').max(2000),
  // Vitals nested under clinicalNotes.vitals to match VitalsPanel's default fieldPath.
  clinicalNotes: z.object({ vitals: encounterVitalsSchema.optional() }).optional(),
  // Bite assessment nested under specialtyData to match BiteAssessmentPanel's default path.
  specialtyData: biteAssessmentSchema.optional(),
  consentBy: z.enum(['Patient', 'Guardian']),
  consentObtained: z.literal(true, {
    errorMap: () => ({ message: 'Confirm that consent was obtained before continuing.' }),
  }),
})

/**
 * A rabies encounter cannot progress without a WHO exposure category. The
 * panel keeps the remaining intake fields optional because they are often
 * gathered later, but this classification drives the clinical pathway.
 */
export const encounterFormSchema = baseSchema.superRefine((values, ctx) => {
  if (values.specialty === 'Rabies' && !values.specialtyData?.whoCategory) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['specialtyData', 'whoCategory'],
      message: 'Select the WHO exposure category before continuing.',
    })
  }
})

type FormFields = z.infer<typeof encounterFormSchema>

export default function Step2Encounter() {
  const navigate = useNavigate()
  const { selectedPatientId, encounterDraft, setEncounterDraft } = useArrival()
  const { data: patient, isLoading: patientLoading } = usePatient(selectedPatientId)

  // Guard target — computed here (before early return) so hook call order is stable.
  const guardTarget = useWizardGuardTarget(2)

  const prev = encounterDraft
  const prevVitals = prev?.vitals as Record<string, unknown> | undefined
  const prevBite = prev?.biteAssessment as Record<string, unknown> | undefined

  const form = useSafeForm<FormFields>({
    resolver: zodResolver(encounterFormSchema),
    defaultValues: {
      // Choosing a pathway is a clinical decision. Do not preselect Rabies
      // for a generic walk-in arrival.
      // React Hook Form leaves an undefined native <select> uncontrolled,
      // which makes the browser visibly choose the first enabled option even
      // though validation still sees no value. Use the empty placeholder as
      // the runtime default so the displayed pathway and form state agree.
      specialty: (prev?.specialty ?? '') as Specialty,
      chiefComplaint: prev?.chiefComplaint ?? '',
      clinicalNotes: {
        vitals: prevVitals
          ? {
              bpSystolic: prevVitals.bpSystolic as number | undefined,
              bpDiastolic: prevVitals.bpDiastolic as number | undefined,
              heartRate: prevVitals.heartRate as number | undefined,
              respiratoryRate: prevVitals.respiratoryRate as number | undefined,
              temperatureC: prevVitals.temperatureC as number | undefined,
              spo2: prevVitals.spo2 as number | undefined,
              weightKg: prevVitals.weightKg as number | undefined,
              heightCm: prevVitals.heightCm as number | undefined,
            }
          : undefined,
      },
      specialtyData: prevBite ? (prevBite as FormFields['specialtyData']) : undefined,
      consentBy: prev?.consentBy ?? 'Patient',
      consentObtained: prev?.consentObtained === true ? true : undefined,
    },
  })

  const watchedSpecialty = form.watch('specialty') as Specialty | undefined

  // Imperative redirect when no patient (handles the case where state is
  // cleared mid-session without a full re-render, e.g. reset() call).
  useEffect(() => {
    if (!selectedPatientId) {
      navigate('/arrivals/identify', { replace: true })
    }
  }, [selectedPatientId, navigate])

  function onSubmit(values: FormFields) {
    if (!selectedPatientId) return

    const vitals = values.clinicalNotes?.vitals
    const biteAssessment =
      values.specialty === 'Rabies' && values.specialtyData ? values.specialtyData : undefined

    setEncounterDraft({
      specialty: values.specialty,
      chiefComplaint: values.chiefComplaint,
      vitals: vitals ? (vitals as Record<string, unknown>) : undefined,
      biteAssessment: biteAssessment ? (biteAssessment as Record<string, unknown>) : undefined,
      consentBy: values.consentBy,
      consentObtained: values.consentObtained,
    })

    navigate(`/arrivals/protocol?patientId=${selectedPatientId}`)
  }

  useAdvanceShortcut(() => {
    void form.handleSubmit(onSubmit)()
  })

  // Redirect AFTER all hooks — rules of hooks require stable call order.
  if (guardTarget) return <Navigate replace to={guardTarget} />

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
            <h2 className="text-lg font-semibold">Open Encounter</h2>
          </div>
          <Badge
            variant={watchedSpecialty ? SPECIALTY_SEVERITY[watchedSpecialty] : 'outline'}
            className="shrink-0 text-2xs mt-0.5"
          >
            {watchedSpecialty ?? 'Select specialty'}
          </Badge>
        </div>

        {/* KV row — patient identity */}
        <div className="mt-2 flex items-center gap-2 text-xs">
          {patientLoading ? (
            <Skeleton className="h-4 w-48" />
          ) : patient ? (
            <>
              <span className="text-muted-foreground">Patient:</span>
              <span className="font-medium">
                {patient.lastName}, {patient.firstName}
                {patient.middleName ? ` ${patient.middleName[0]}.` : ''}
              </span>
              <span className="font-mono tabular-nums text-muted-foreground/70">
                MRN {patient.mrn}
              </span>
              {patient.dateOfBirth && (
                <span className="font-mono tabular-nums text-muted-foreground/70">
                  DOB {format(new Date(patient.dateOfBirth), 'MMM d, yyyy')} ·{' '}
                  {differenceInYears(new Date(), new Date(patient.dateOfBirth))} yrs
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">No patient selected</span>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl xl:max-w-3xl px-4 sm:px-6 xl:px-8 2xl:px-10 py-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 pb-20" noValidate>
              {/* Specialty */}
              <FormField
                control={form.control}
                name="specialty"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Specialty <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value || undefined)}
                      >
                        <option value="">Choose the visit specialty…</option>
                        {SPECIALTIES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Select the clinical pathway before documenting the encounter.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Chief complaint */}
              <FormField
                control={form.control}
                name="chiefComplaint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Chief complaint <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <textarea
                        className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                        placeholder="Describe what brought the patient in today…"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <fieldset className="rounded-md border border-border bg-muted/30 p-4">
                <legend className="eyebrow px-1">Arrival consent</legend>
                <div className="mt-2 space-y-3">
                  <FormField
                    control={form.control}
                    name="consentBy"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="arrival-consent-by">Consent from</FormLabel>
                        <FormControl>
                          <select
                            id="arrival-consent-by"
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            value={field.value}
                            onChange={(event) => field.onChange(event.target.value)}
                          >
                            <option value="Patient">Patient</option>
                            <option value="Guardian">Guardian</option>
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="consentObtained"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-start gap-3">
                          <FormControl>
                            <Checkbox
                              id="arrival-consent-obtained"
                              checked={field.value}
                              onCheckedChange={(checked) => field.onChange(checked === true)}
                              className="mt-0.5"
                            />
                          </FormControl>
                          <Label
                            htmlFor="arrival-consent-obtained"
                            className="cursor-pointer text-sm leading-snug"
                          >
                            I confirm informed consent was obtained from the{' '}
                            {form.watch('consentBy').toLowerCase()} before creating this visit.
                          </Label>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </fieldset>

              <Separator />

              {/* Vitals panel — shared component, reads/writes via FormProvider context */}
              <fieldset className="border rounded-md p-4">
                <legend className="eyebrow px-1">Vitals · optional at intake</legend>
                <div className="mt-2">
                  <VitalsPanel fieldPath="clinicalNotes.vitals" />
                </div>
              </fieldset>

              {/* Bite assessment — shown only for Rabies specialty */}
              {watchedSpecialty === 'Rabies' && (
                <fieldset className="border rounded-md p-4">
                  <legend className="eyebrow px-1">Rabies exposure assessment</legend>
                  <div className="mt-2">
                    <BiteAssessmentPanel path="specialtyData" />
                  </div>
                </fieldset>
              )}

              <div className="sticky bottom-0 z-10 -mx-4 sm:-mx-6 xl:-mx-8 2xl:-mx-10 border-t border-border bg-background/95 px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(`/arrivals/identify?patientId=${selectedPatientId}`)}
                >
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground hidden sm:block">
                    or{' '}
                    <kbd className="px-1 py-0.5 rounded border border-border bg-muted font-mono text-xs">
                      ⌘↵
                    </kbd>
                  </span>
                  <Button type="submit">Save &amp; continue</Button>
                </div>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </div>
  )
}
