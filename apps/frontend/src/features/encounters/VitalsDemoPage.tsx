import { useState } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Activity } from 'lucide-react'
import { Form } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import VitalsPanel, { vitalsSchema } from './components/VitalsPanel'
import { useSafeForm } from '@/lib/useSafeForm'

/**
 * Demo route for VitalsPanel. Not linked from nav — reachable at `/vitals-demo`.
 * Verifies the panel renders end-to-end against a real RHF form and that the
 * shared sub-schema composes into a parent encounter-shaped schema.
 */
const demoSchema = z.object({
  chiefComplaint: z.string().optional(),
  clinicalNotes: z.object({
    vitals: vitalsSchema.optional(),
  }),
})

type DemoFields = z.infer<typeof demoSchema>

export default function VitalsDemoPage() {
  const [submitted, setSubmitted] = useState<DemoFields | null>(null)

  const form = useSafeForm<DemoFields>({
    resolver: zodResolver(demoSchema),
    defaultValues: {
      chiefComplaint: '',
      clinicalNotes: { vitals: {} },
    },
  })

  function onSubmit(values: DemoFields) {
    setSubmitted(values)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page head */}
      <div className="px-6 py-4 border-b flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
              Developer tool
            </p>
          </div>
          {/* eslint-disable-next-line no-restricted-syntax -- demo harness, not a routed list page; PageHeader's action-group contract doesn't apply */}
          <h1 className="text-xl font-semibold mt-0.5">Vitals Panel Demo</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Standalone harness for the reusable vitals capture panel.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Capture vitals</CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
                  <VitalsPanel<DemoFields> />

                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => form.reset()}>
                      Reset
                    </Button>
                    <Button type="submit">Submit</Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          {submitted && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Submitted payload</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  clinicalNotes.vitals
                </p>
                <pre className="text-xs font-mono overflow-auto rounded-md bg-muted/40 p-3">
                  {JSON.stringify(submitted.clinicalNotes.vitals, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
