import { useState } from 'react'
import { useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Trash2, Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/toast'
import { ErrorBanner } from '@/components/layout'
import { useSubmitLabResult, useAcknowledgeCritical } from '../api'
import { useSafeForm } from '@/lib/useSafeForm'

const observationSchema = z.object({
  code: z.string().min(1, 'Code or analyte name required'),
  value: z.string().min(1, 'Value required'),
  units: z.string().optional(),
  refRange: z.string().optional(),
  interpretation: z.enum(['Normal', 'Low', 'High', 'Critical']).optional(),
})

const schema = z.object({
  observations: z.array(observationSchema).min(1),
  notes: z.string().max(2000).optional(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  orderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const BLANK_OBSERVATION: FormValues['observations'][number] = {
  code: '',
  value: '',
  units: '',
  refRange: '',
  interpretation: undefined,
}

export function EnterLabResultDialog({ orderId, open, onOpenChange }: Props) {
  const [apiError, setApiError] = useState<string | null>(null)
  const submitResult = useSubmitLabResult(orderId)
  const ackCritical = useAcknowledgeCritical(orderId)

  const form = useSafeForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      observations: [{ ...BLANK_OBSERVATION }],
      notes: '',
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'observations',
  })

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset()
      setApiError(null)
    }
    onOpenChange(next)
  }

  async function onSubmit(values: FormValues) {
    setApiError(null)
    try {
      await submitResult.mutateAsync({
        resultData: { observations: values.observations },
        notes: values.notes || undefined,
      })

      const hasCritical = values.observations.some((o) => o.interpretation === 'Critical')
      if (hasCritical) {
        await ackCritical.mutateAsync()
      }

      toast('Lab result saved.')
      handleOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save lab result.'
      setApiError(message)
    }
  }

  const isPending = submitResult.isPending || ackCritical.isPending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enter lab result</DialogTitle>
          <DialogDescription>
            Record structured observations for this lab order. Add one row per analyte.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-4">
              {fields.map((field, index) => (
                <div key={field.id} className="space-y-3">
                  {index > 0 && <Separator />}
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-muted-foreground">
                      Observation {index + 1}
                    </p>
                    {fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(index)}
                        aria-label="Remove observation"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name={`observations.${index}.code`}
                      render={({ field: f }) => (
                        <FormItem>
                          <FormLabel>
                            Code / Analyte <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Glucose" {...f} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`observations.${index}.value`}
                      render={({ field: f }) => (
                        <FormItem>
                          <FormLabel>
                            Value <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. 5.2" {...f} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`observations.${index}.units`}
                      render={({ field: f }) => (
                        <FormItem>
                          <FormLabel>Units</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. mmol/L" {...f} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`observations.${index}.refRange`}
                      render={({ field: f }) => (
                        <FormItem>
                          <FormLabel>Reference range</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. 3.9–5.5" {...f} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`observations.${index}.interpretation`}
                      render={({ field: f }) => (
                        <FormItem className="col-span-2">
                          <FormLabel>Interpretation</FormLabel>
                          <Select onValueChange={f.onChange} value={f.value ?? ''}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select interpretation" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Normal">Normal</SelectItem>
                              <SelectItem value="Low">Low</SelectItem>
                              <SelectItem value="High">High</SelectItem>
                              <SelectItem value="Critical">Critical</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ ...BLANK_OBSERVATION })}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add another observation
            </Button>

            <Separator />

            <FormField
              control={form.control}
              name="notes"
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Additional notes about this result…"
                      className="resize-none"
                      rows={3}
                      {...f}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {apiError && <ErrorBanner message={apiError} />}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving…' : 'Save result'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
