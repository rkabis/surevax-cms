import { useState, useCallback, useEffect, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormDescription,
  FormMessage,
} from '@/components/ui/form'
import {
  useCreatePatient,
  useUpdatePatient,
  ONBOARDING_CHANNELS,
  type CreatePatientInput,
  type PatientDetail,
} from '../api'
import { usePayerProfiles } from '@/features/admin/payerProfilesApi'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { PageHeader, FormSectionHeader, CollapsibleCard, DirtyFormGuard } from '@/components/layout'
import {
  phMobileOptional,
  emailOptional,
  dateOfBirthOptional,
  personNameRequired,
  personNameOptional,
  normalizePhMobile,
} from '@/lib/phValidation'
import PatientDuplicatePanel from './PatientDuplicatePanel'
import AddressAutocomplete from './AddressAutocomplete'
import RegionCascadeSelect from './RegionCascadeSelect'
import { useSafeForm } from '@/lib/useSafeForm'

// Native <select> styling reused for the onboarding-channel dropdowns — matches
// the sex/civil-status selects already in this form.
const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const schema = z.object({
  // Validation rules are calibrated against the real export, not generic
  // regexes: see lib/phValidation.ts for what each one is catching and why.
  firstName: personNameRequired(100),
  lastName: personNameRequired(100),
  middleName: personNameOptional(100),
  dateOfBirth: dateOfBirthOptional,
  sex: z.enum(['Male', 'Female', 'Other']).optional(),
  civilStatus: z
    .enum(['Single', 'Married', 'Widowed', 'Separated', 'Divorced', 'Live-in'])
    .optional(),
  contactNumber: phMobileOptional,
  email: emailOptional,
  smsOptIn: z.boolean().optional(),
  consentBy: z.enum(['Patient', 'Guardian']).optional(),
  consentObtained: z.boolean().optional(),
  address: z.string().max(500).optional(),
  region: z.string().max(100).optional(),
  province: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  barangay: z.string().max(100).optional(),
  guardianName: z.string().max(200).optional(),
  guardianRelationship: z.string().max(100).optional(),
  guardianContact: phMobileOptional,
  allergies: z.array(z.string().max(120)).max(50).optional(),
  conditions: z.array(z.string().max(120)).max(50).optional(),
  insuranceProvider: z.string().max(200).optional(),
  insurancePolicyNumber: z.string().max(120).optional(),
  onboardingChannel: z.enum(ONBOARDING_CHANNELS).optional(),
  // PYR_… payer display id — only meaningful when the channel is Partner/HMO.
  onboardingChannelPayerId: z.string().optional(),
})

type FormFields = z.infer<typeof schema>

type Props = {
  mode: 'create' | 'edit'
  /** Pre-fills the form and switches to PATCH when in edit mode. */
  patient?: PatientDetail
  /**
   * Where the form returns on success/cancel. `'arrivals'` resumes the
   * Arrivals wizard at the encounter step; otherwise it falls back to the
   * patient record / list per mode.
   */
  returnTo?: string
}

/**
 * Tag/chip input. Tab or Enter adds the current value; clicking × removes.
 * Stays simple — no extra dependency, no autocomplete, no drag-reorder.
 */
function ChipInput({
  values,
  onChange,
  placeholder,
  ariaLabel,
}: {
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  ariaLabel: string
}) {
  const [draft, setDraft] = useState('')

  function commit() {
    const v = draft.trim()
    if (!v) return
    if (values.includes(v)) {
      setDraft('')
      return
    }
    onChange([...values, v])
    setDraft('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
      // Don't submit the form on Enter; don't leave the field on Tab while
      // there's a pending tag.
      if (draft.trim()) {
        e.preventDefault()
        commit()
      }
    } else if (e.key === 'Backspace' && !draft && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index))
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 min-h-9 focus-within:ring-2 focus-within:ring-ring"
      aria-label={ariaLabel}
    >
      {values.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs"
        >
          {v}
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${v}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="flex-1 min-w-[8ch] bg-transparent text-sm outline-none"
        value={draft}
        placeholder={values.length === 0 ? placeholder : ''}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
      />
    </div>
  )
}

export function PatientFormPage({ mode, patient, returnTo }: Props) {
  const isEditing = mode === 'edit'
  const navigate = useNavigate()
  const createPatient = useCreatePatient()
  const updatePatient = useUpdatePatient(patient?.id ?? null)
  const [hasExactMatch, setHasExactMatch] = useState(false)
  const [overrideDuplicate, setOverrideDuplicate] = useState(false)
  // Set after a successful save; the redirect fires from an effect once the
  // form's dirty state has settled (see goToPatient block below).
  const [pendingNavPath, setPendingNavPath] = useState<string | null>(null)

  const handleExactMatchChange = useCallback((value: boolean) => {
    setHasExactMatch(value)
    if (!value) setOverrideDuplicate(false)
  }, [])

  // Build initial values — prefer the loaded patient fields when editing
  function buildDefaultValues(): FormFields {
    if (patient) {
      const p = patient
      // dateOfBirth from API is ISO string; convert to YYYY-MM-DD for date input
      const dob = p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : ''
      return {
        firstName: p.firstName,
        lastName: p.lastName,
        middleName: p.middleName ?? '',
        dateOfBirth: dob,
        sex: (p.sex as FormFields['sex']) ?? undefined,
        civilStatus: (p.civilStatus as FormFields['civilStatus']) ?? undefined,
        contactNumber: p.contactNumber ?? '',
        email: p.email ?? '',
        smsOptIn: p.smsOptIn,
        consentBy: undefined,
        consentObtained: undefined,
        address: p.address ?? '',
        region: p.region ?? '',
        province: p.province ?? '',
        city: p.city ?? '',
        barangay: p.barangay ?? '',
        guardianName: p.guardianName ?? '',
        guardianRelationship: p.guardianRelationship ?? '',
        guardianContact: p.guardianContact ?? '',
        allergies: [],
        conditions: [],
        insuranceProvider: p.insuranceProvider ?? '',
        insurancePolicyNumber: p.insurancePolicyNumber ?? '',
        onboardingChannel: (p.onboardingChannel as FormFields['onboardingChannel']) ?? undefined,
        onboardingChannelPayerId: p.onboardingChannelPayer?.id ?? '',
      }
    }
    return {
      firstName: '',
      lastName: '',
      middleName: '',
      dateOfBirth: '',
      sex: undefined,
      contactNumber: '',
      email: '',
      smsOptIn: false,
      consentBy: 'Patient',
      consentObtained: false,
      address: '',
      region: '',
      province: '',
      city: '',
      barangay: '',
      guardianName: '',
      guardianRelationship: '',
      guardianContact: '',
      allergies: [],
      conditions: [],
      insuranceProvider: '',
      insurancePolicyNumber: '',
      civilStatus: undefined,
      onboardingChannel: undefined,
      onboardingChannelPayerId: '',
    }
  }

  const form = useSafeForm<FormFields>({
    resolver: zodResolver(schema),
    defaultValues: buildDefaultValues(),
  })

  // Re-populate the form when the patient arrives (the edit page fetches
  // asynchronously, so `patient` is undefined on the first render).
  useEffect(() => {
    form.reset(buildDefaultValues())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id])

  const { isSubmitting } = form.formState

  const watchedFirst = form.watch('firstName')
  const watchedLast = form.watch('lastName')
  const watchedDob = form.watch('dateOfBirth')
  const watchedRegion = form.watch('region')
  const watchedProvince = form.watch('province')
  const watchedCity = form.watch('city')
  const watchedBarangay = form.watch('barangay')

  // Onboarding-channel payer picker: shown only for Partner/HMO channels, scoped
  // to the matching payer type (Partner → Corporate payers, HMO → HMO payers).
  const watchedChannel = form.watch('onboardingChannel')
  const channelPayerType =
    watchedChannel === 'HMO' ? 'HMO' : watchedChannel === 'Partner' ? 'Corporate' : undefined
  const showChannelPayer = channelPayerType !== undefined
  const { data: channelPayerData } = usePayerProfiles(channelPayerType)
  const channelPayers = channelPayerData?.data ?? []

  // ── Collapsed-section bookkeeping ────────────────────────────────────────
  // A collapsed section has to advertise two things or it becomes a trap:
  // whether it holds anything (so an edit of an existing patient does not hide
  // their guardian behind a closed lid), and whether it holds a validation error
  // (so a form that refuses to submit always shows why).
  const values = form.watch()
  const nonEmpty = (...fields: Array<string | string[] | undefined>) =>
    fields.filter((v) => (Array.isArray(v) ? v.length > 0 : (v ?? '').trim() !== '')).length

  const filled = {
    guardian: nonEmpty(values.guardianName, values.guardianRelationship, values.guardianContact),
    medical: nonEmpty(values.allergies, values.conditions),
    coverage: nonEmpty(values.insuranceProvider, values.insurancePolicyNumber),
    onboarding: nonEmpty(values.onboardingChannel, values.onboardingChannelPayerId),
  }

  const errors = form.formState.errors
  const anyError = (...keys: Array<keyof FormFields>) => keys.some((k) => errors[k] !== undefined)
  const sectionHasError = {
    guardian: anyError('guardianName', 'guardianRelationship', 'guardianContact'),
    medical: anyError('allergies', 'conditions'),
    coverage: anyError('insuranceProvider', 'insurancePolicyNumber'),
    onboarding: anyError('onboardingChannel', 'onboardingChannelPayerId'),
  }

  function patientPath(id: string) {
    return returnTo === 'arrivals' ? `/arrivals/encounter?patientId=${id}` : `/patients/${id}`
  }

  function goToPatient(id: string) {
    navigate(patientPath(id))
  }

  // After a successful save we reset() the form (clearing isDirty) and then
  // redirect. RHF flips isDirty to false on reset, but DirtyFormGuard's
  // useBlocker still reads the PREVIOUS render's `when=true`, so navigating
  // synchronously inside the submit handler trips a spurious "Unsaved changes?"
  // dialog right after a successful registration. Defer the redirect to an
  // effect that runs once isDirty has actually settled to false.
  useEffect(() => {
    if (pendingNavPath && !form.formState.isDirty) {
      const target = pendingNavPath
      setPendingNavPath(null)
      navigate(target)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNavPath, form.formState.isDirty])

  function handleSelectExisting(id: string) {
    setHasExactMatch(false)
    setOverrideDuplicate(false)
    goToPatient(id)
  }

  function handleCancel() {
    if (returnTo === 'arrivals') {
      navigate('/arrivals/identify')
    } else if (isEditing) {
      navigate(`/patients/${patient!.id}`)
    } else {
      navigate('/patients')
    }
  }

  const submitDisabled = isSubmitting || (!isEditing && hasExactMatch && !overrideDuplicate)

  async function onSubmit(values: FormFields) {
    const blank = (s: string | undefined) => (s && s.length > 0 ? s : undefined)
    const input = {
      firstName: values.firstName,
      lastName: values.lastName,
      middleName: blank(values.middleName),
      dateOfBirth: values.dateOfBirth ? new Date(values.dateOfBirth).toISOString() : undefined,
      sex: values.sex,
      civilStatus: values.civilStatus,
      contactNumber: blank(values.contactNumber),
      email: blank(values.email),
      smsOptIn: values.smsOptIn,
      address: blank(values.address),
      region: blank(values.region),
      province: blank(values.province),
      city: blank(values.city),
      barangay: blank(values.barangay),
      guardianName: blank(values.guardianName),
      guardianRelationship: blank(values.guardianRelationship),
      guardianContact: blank(values.guardianContact),
      allergies: values.allergies && values.allergies.length > 0 ? values.allergies : undefined,
      conditions: values.conditions && values.conditions.length > 0 ? values.conditions : undefined,
      insuranceProvider: blank(values.insuranceProvider),
      insurancePolicyNumber: blank(values.insurancePolicyNumber),
      onboardingChannel: values.onboardingChannel,
      // Only attach the payer for Partner/HMO; any other channel clears it (null).
      onboardingChannelPayerId:
        (values.onboardingChannel === 'Partner' || values.onboardingChannel === 'HMO') &&
        values.onboardingChannelPayerId
          ? values.onboardingChannelPayerId
          : null,
    }

    if (isEditing) {
      try {
        const updated = await updatePatient.mutateAsync(input)
        toast('Patient updated', { description: `${updated.firstName} ${updated.lastName}` })
        form.reset(values)
        setPendingNavPath(`/patients/${patient!.id}`)
      } catch (err) {
        toast.error('Failed to update patient', { description: apiErrorMessage(err) })
      }
      return
    }

    if (values.consentObtained !== true || !values.consentBy) {
      form.setError('consentObtained', {
        type: 'required',
        message: 'Confirm that informed consent was obtained before registering the patient.',
      })
      return
    }

    try {
      const createInput: CreatePatientInput = {
        ...input,
        consentObtained: true,
        consentBy: values.consentBy,
      }
      const created = await createPatient.mutateAsync(createInput)
      toast('Patient registered', { description: `${created.firstName} ${created.lastName}` })
      form.reset(values)
      setHasExactMatch(false)
      setOverrideDuplicate(false)
      setPendingNavPath(patientPath(created.id))
    } catch (err) {
      toast.error('Failed to register patient', { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title={isEditing ? 'Edit patient' : 'Register patient'}
          description="Fill in the patient's information. Fields marked * are required."
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          <Form {...form}>
            <form id="patient-form" onSubmit={form.handleSubmit(onSubmit)} noValidate>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                {/* Identity */}
                <Card>
                  <FormSectionHeader>Identity</FormSectionHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="lastName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              Last name <span className="text-destructive"> *</span>
                            </FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Dela Cruz" autoFocus {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="firstName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              First name <span className="text-destructive"> *</span>
                            </FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Maria" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="middleName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Middle name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Santos" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="dateOfBirth"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Date of birth</FormLabel>
                            <FormControl>
                              <Input type="date" className="font-mono" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="sex"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Sex</FormLabel>
                            <FormControl>
                              <select
                                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                value={field.value ?? ''}
                                onChange={(e) => field.onChange(e.target.value || undefined)}
                              >
                                <option value="">Select…</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                                <option value="Other">Other</option>
                              </select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="civilStatus"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Civil status</FormLabel>
                          <FormControl>
                            <select
                              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value || undefined)}
                            >
                              <option value="">Select…</option>
                              {[
                                'Single',
                                'Married',
                                'Widowed',
                                'Separated',
                                'Divorced',
                                'Live-in',
                              ].map((cs) => (
                                <option key={cs} value={cs}>
                                  {cs}
                                </option>
                              ))}
                            </select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Duplicate detection — only shown when creating a new patient */}
                    {!isEditing && (
                      <PatientDuplicatePanel
                        firstName={watchedFirst ?? ''}
                        lastName={watchedLast ?? ''}
                        dateOfBirth={watchedDob ?? ''}
                        onSelectExisting={handleSelectExisting}
                        onExactMatchChange={handleExactMatchChange}
                      />
                    )}
                  </CardContent>
                </Card>

                {/* Contact */}
                <Card>
                  <FormSectionHeader>Contact</FormSectionHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="contactNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Mobile number</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="09171234567"
                                type="tel"
                                inputMode="numeric"
                                autoComplete="tel"
                                className="font-mono tabular-nums"
                                {...field}
                                // Normalise on blur, never while typing: rewriting
                                // the value mid-keystroke fights the cursor. Any of
                                // +639…, 639…, 9…, or a number with dashes lands as
                                // canonical 09XXXXXXXXX: all four spellings are in
                                // the legacy data and all mean the same number.
                                onBlur={(e) => {
                                  const normalized = normalizePhMobile(e.target.value)
                                  if (normalized && normalized !== e.target.value) {
                                    form.setValue('contactNumber', normalized, {
                                      shouldValidate: true,
                                      shouldDirty: true,
                                    })
                                  }
                                  field.onBlur()
                                }}
                              />
                            </FormControl>
                            <FormDescription>
                              Used for SMS dose reminders. Leave blank if there is none.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="maria@example.com"
                                type="email"
                                autoComplete="email"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              Optional: leave blank, don&rsquo;t type &ldquo;n/a&rdquo;.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="smsOptIn"
                      render={({ field }) => (
                        <FormItem className="flex items-start gap-2 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value ?? false}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="font-normal cursor-pointer leading-snug">
                            Patient agrees to receive SMS reminders about upcoming doses and
                            appointments at the contact number above.
                          </FormLabel>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Street address</FormLabel>
                          <FormControl>
                            <AddressAutocomplete
                              value={field.value ?? ''}
                              onChange={field.onChange}
                              onPlaceSelected={(components) => {
                                field.onChange(components.streetAddress)
                                form.setValue('region', components.region)
                                form.setValue('province', components.province)
                                form.setValue('city', components.city)
                                form.setValue('barangay', components.barangay)
                              }}
                              disabled={isSubmitting}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <RegionCascadeSelect
                      region={watchedRegion ?? ''}
                      province={watchedProvince ?? ''}
                      city={watchedCity ?? ''}
                      barangay={watchedBarangay ?? ''}
                      onRegionChange={(v) => form.setValue('region', v)}
                      onProvinceChange={(v) => form.setValue('province', v)}
                      onCityChange={(v) => form.setValue('city', v)}
                      onBarangayChange={(v) => form.setValue('barangay', v)}
                      disabled={isSubmitting}
                    />
                  </CardContent>
                </Card>

                {/* Guardian: collapsed: only ~13% of the clinic's patients are
                    minors, so this is dead weight on every adult registration. */}
                <CollapsibleCard
                  title="Guardian"
                  hint="(if minor)"
                  filledCount={filled.guardian}
                  forceOpen={sectionHasError.guardian}
                >
                  <FormField
                    control={form.control}
                    name="guardianName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Guardian name</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Juan Dela Cruz" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="guardianRelationship"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Relationship</FormLabel>
                          <FormControl>
                            <Input placeholder="Parent" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="guardianContact"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Contact</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="09171234567"
                              type="tel"
                              inputMode="numeric"
                              className="font-mono tabular-nums"
                              {...field}
                              onBlur={(e) => {
                                const normalized = normalizePhMobile(e.target.value)
                                if (normalized && normalized !== e.target.value) {
                                  form.setValue('guardianContact', normalized, {
                                    shouldValidate: true,
                                    shouldDirty: true,
                                  })
                                }
                                field.onBlur()
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CollapsibleCard>

                {/* Medical — only on create. Edit path routes users to the
                Allergies + Conditions tabs in PatientDetail, where each row
                is a tracked record with reactions/severity/diagnosis_date
                metadata. The route's update handler intentionally discards
                these arrays (see `_allergies` / `_conditions` destructure in
                apps/backend/src/modules/patients/routes.ts:145) so editing
                here would have been a silent no-op. */}
                {!isEditing && (
                  <CollapsibleCard
                    title="Medical baseline"
                    filledCount={filled.medical}
                    forceOpen={sectionHasError.medical}
                  >
                    <FormField
                      control={form.control}
                      name="allergies"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Allergies</FormLabel>
                          <FormControl>
                            <ChipInput
                              values={field.value ?? []}
                              onChange={field.onChange}
                              placeholder="Type and press Enter (e.g. Penicillin)"
                              ariaLabel="Allergies"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="conditions"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Existing conditions</FormLabel>
                          <FormControl>
                            <ChipInput
                              values={field.value ?? []}
                              onChange={field.onChange}
                              placeholder="Type and press Enter (e.g. Hypertension)"
                              ariaLabel="Conditions"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CollapsibleCard>
                )}

                {/* Insurance */}
                <CollapsibleCard
                  title="Coverage"
                  hint="(HMO / insurance)"
                  filledCount={filled.coverage}
                  forceOpen={sectionHasError.coverage}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="insuranceProvider"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Provider</FormLabel>
                          <FormControl>
                            <Input placeholder="PhilHealth, Maxicare, …" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="insurancePolicyNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Policy number</FormLabel>
                          <FormControl>
                            <Input placeholder="HMO-1234567" className="font-mono" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CollapsibleCard>

                {/* Onboarding channel — how the patient was acquired ("lead source").
                    Shown in both modes (unlike the medical baseline, this is a real
                    editable column). The payer picker appears only for Partner/HMO.
                    Collapsed: useful for the business, never urgent at the counter. */}
                <CollapsibleCard
                  title="Onboarding"
                  hint="(how they found us)"
                  filledCount={filled.onboarding}
                  forceOpen={sectionHasError.onboarding}
                >
                  <FormField
                    control={form.control}
                    name="onboardingChannel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>How did the patient find us?</FormLabel>
                        <FormControl>
                          <select
                            className={SELECT_CLASS}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(e.target.value || undefined)}
                          >
                            <option value="">Select…</option>
                            {ONBOARDING_CHANNELS.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {showChannelPayer && (
                    <FormField
                      control={form.control}
                      name="onboardingChannelPayerId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {watchedChannel === 'HMO' ? 'Which HMO?' : 'Which partner?'}
                          </FormLabel>
                          <FormControl>
                            <select
                              className={SELECT_CLASS}
                              value={field.value ?? ''}
                              onChange={(e) => field.onChange(e.target.value || undefined)}
                            >
                              <option value="">Select…</option>
                              {channelPayers.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </CollapsibleCard>

                {!isEditing && (
                  <Card className="xl:col-span-2">
                    <FormSectionHeader>Registration consent</FormSectionHeader>
                    <CardContent className="px-4 pb-4 space-y-3">
                      <FormField
                        control={form.control}
                        name="consentBy"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel htmlFor="registration-consent-by">Consent from</FormLabel>
                            <FormControl>
                              <select
                                id="registration-consent-by"
                                className={SELECT_CLASS}
                                value={field.value ?? 'Patient'}
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
                                  id="registration-consent-obtained"
                                  checked={field.value === true}
                                  onCheckedChange={(checked) => field.onChange(checked === true)}
                                  className="mt-0.5"
                                />
                              </FormControl>
                              <FormLabel
                                htmlFor="registration-consent-obtained"
                                className="font-normal cursor-pointer leading-snug"
                              >
                                I confirm informed consent was obtained from the{' '}
                                {(form.watch('consentBy') ?? 'Patient').toLowerCase()} before
                                registering this patient and using their record for care.
                              </FormLabel>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>
                )}

                {!isEditing && hasExactMatch && (
                  <label className="xl:col-span-2 flex items-start gap-2 rounded-md border border-triage-overdue/35 bg-triage-overdue-soft px-3 py-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={overrideDuplicate}
                      onChange={(e) => setOverrideDuplicate(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5"
                      aria-describedby="override-duplicate-help"
                    />
                    <span id="override-duplicate-help" className="text-foreground">
                      Create anyway — I&rsquo;ve confirmed this is a different patient with the same
                      name and date of birth.
                    </span>
                  </label>
                )}
              </div>
            </form>
          </Form>
        </div>
      </ScrollArea>

      <footer className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-3 border-t border-border flex justify-end gap-2 bg-background">
        <Button type="button" variant="outline" onClick={handleCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" form="patient-form" disabled={submitDisabled}>
          {isSubmitting
            ? isEditing
              ? 'Saving…'
              : 'Registering…'
            : isEditing
              ? 'Save changes'
              : 'Register patient'}
        </Button>
      </footer>

      <DirtyFormGuard when={form.formState.isDirty} />
    </div>
  )
}

export default PatientFormPage
