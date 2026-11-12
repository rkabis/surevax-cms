import { useNavigate, useParams } from 'react-router-dom'

import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { encounterCreateSchema, type EncounterCreateInput } from '@surevax/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { PageHeader, FormSectionHeader, DirtyFormGuard } from '@/components/layout'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { useCreateEncounter } from './api'
import VitalsPanel from './components/VitalsPanel'
import BiteAssessmentPanel from './components/BiteAssessmentPanel'
import { useSafeForm } from '@/lib/useSafeForm'

const SPECIALTIES = ['General', 'Rabies', 'Flu', 'Vaccination'] as const

// patientId is injected at submit time from the route param — make it optional in the form.
const schema = encounterCreateSchema.extend({
  patientId: encounterCreateSchema.shape.patientId.optional(),
})

type FormFields = z.infer<typeof schema>

const EMPTY_FORM: FormFields = {
  patientId: '',
  specialty: 'General',
  chiefComplaint: '',
  clinicalNotes: { vitals: {} },
  specialtyData: {},
}

/** Drops keys whose value is undefined / empty string so we don't ship empty JSONB blobs. */
function pruneEmpty<T extends Record<string, unknown>>(obj: T | undefined): T | undefined {
  if (!obj) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    if (typeof v === 'string' && v.trim() === '') continue
    out[k] = v
  }
  return Object.keys(out).length > 0 ? (out as T) : undefined
}

// Native <select> styling — matches the form selects already in use across pages.
const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function EncounterNewPage() {
  const { id: patientId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const createEncounter = useCreateEncounter()

  const form = useSafeForm<FormFields>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_FORM,
  })

  const { isSubmitting } = form.formState
  const specialty = form.watch('specialty')

  async function onSubmit(values: FormFields) {
    if (!patientId) return

    const vitals = pruneEmpty(values.clinicalNotes?.vitals)
    const specialtyData = specialty === 'Rabies' ? pruneEmpty(values.specialtyData) : undefined

    const input: EncounterCreateInput = {
      patientId,
      specialty: values.specialty,
      chiefComplaint: values.chiefComplaint?.trim() || undefined,
      clinicalNotes: vitals ? { vitals } : undefined,
      specialtyData,
    }

    try {
      const enc = await createEncounter.mutateAsync(input)
      toast('Encounter started', {
        description:
          `${enc.specialty} · ${enc.patientLastName ?? ''}, ${enc.patientFirstName ?? ''}`.trim(),
      })
      // Reset before navigating so DirtyFormGuard doesn't fire.
      form.reset(values)
      navigate(`/patients/${patientId}`)
    } catch (err) {
      toast.error('Failed to start encounter', { description: apiErrorMessage(err) })
    }
  }

  function handleCancel() {
    navigate(`/patients/${patientId}`)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4 border-b border-border bg-card">
        <PageHeader
          title="Start encounter"
          description="Begin a new clinical visit. Capture vitals and, for rabies cases, the bite assessment before submitting."
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 sm:px-6 xl:px-8 2xl:px-10 py-4">
          <Form {...form}>
            <form id="encounter-form" onSubmit={form.handleSubmit(onSubmit)} noValidate>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
                {/* Main fields */}
                <Card>
                  <FormSectionHeader>Visit details</FormSectionHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
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
                              className={SELECT_CLASS}
                              value={field.value}
                              onChange={(e) => field.onChange(e.target.value)}
                            >
                              {SPECIALTIES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="chiefComplaint"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Chief complaint</FormLabel>
                          <FormControl>
                            <textarea
                              className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                              placeholder="e.g. Dog bite right hand, Category III"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                {/* Vitals */}
                <Card>
                  <FormSectionHeader>Vitals</FormSectionHeader>
                  <CardContent className="px-4 pb-4">
                    <VitalsPanel<FormFields> />
                  </CardContent>
                </Card>

                {/* Bite assessment — rabies specialty only */}
                {specialty === 'Rabies' && (
                  <Card className="xl:col-span-2">
                    <FormSectionHeader>Bite assessment</FormSectionHeader>
                    <CardContent className="px-4 pb-4">
                      <BiteAssessmentPanel<FormFields> />
                    </CardContent>
                  </Card>
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
        <Button type="submit" form="encounter-form" disabled={isSubmitting || !patientId}>
          {isSubmitting ? 'Starting…' : 'Start encounter'}
        </Button>
      </footer>

      <DirtyFormGuard
        when={form.formState.isDirty}
        message="You have an unsaved encounter. Leave anyway?"
      />
    </div>
  )
}
