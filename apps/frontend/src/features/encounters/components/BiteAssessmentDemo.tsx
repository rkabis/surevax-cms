/**
 * BiteAssessmentDemo — dev-only fixture that mounts BiteAssessmentPanel
 * inside a real RHF form so the component renders end-to-end and typechecks
 * against a parent schema. Reachable at `/dev/bite-assessment`.
 */

import { useState } from 'react'
import { FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import BiteAssessmentPanel, { biteAssessmentSchema } from './BiteAssessmentPanel'
import { useSafeForm } from '@/lib/useSafeForm'

const demoSchema = z.object({
  specialty: z.literal('Rabies'),
  specialtyData: biteAssessmentSchema,
})

type DemoFields = z.infer<typeof demoSchema>

export default function BiteAssessmentDemo() {
  const form = useSafeForm<DemoFields>({
    resolver: zodResolver(demoSchema),
    defaultValues: {
      specialty: 'Rabies',
      specialtyData: {},
    },
  })

  const [submitted, setSubmitted] = useState<DemoFields | null>(null)

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Bite assessment — demo</h1>
        <p className="text-sm text-muted-foreground">
          Renders the panel against a parent RHF form. Submit logs the JSONB shape that would be
          persisted to <code>encounters.specialtyData</code>.
        </p>
      </div>

      <FormProvider {...form}>
        <form
          onSubmit={form.handleSubmit((values) => setSubmitted(values))}
          className="space-y-6"
          noValidate
        >
          {/* Conditional rendering note: parent renders panel only when
              specialty === 'Rabies'. Hardcoded here for the demo. */}
          {form.watch('specialty') === 'Rabies' && <BiteAssessmentPanel />}

          <div className="flex gap-2">
            <Button type="submit">Submit</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                form.reset()
                setSubmitted(null)
              }}
            >
              Reset
            </Button>
          </div>
        </form>
      </FormProvider>

      {submitted && (
        <pre className="rounded-md bg-muted p-3 text-xs overflow-auto">
          {JSON.stringify(submitted, null, 2)}
        </pre>
      )}
    </div>
  )
}
