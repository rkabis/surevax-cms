import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCreateAdverseEvent, usePatientClinicalOrders } from '../api'
import { formatDate } from '@/lib/format'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { humanizeStatus } from '@/lib/status'
import { Button } from '@/components/ui/button'
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
import PatientPicker from '@/components/forms/PatientPicker'
import { useSafeForm } from '@/lib/useSafeForm'

const SEVERITIES = ['Mild', 'Moderate', 'Severe', 'LifeThreatening', 'Fatal'] as const
const OUTCOMES = ['Recovered', 'Recovering', 'NotRecovered', 'Fatal', 'Unknown'] as const

const schema = z.object({
  patientId: z.string().min(1, 'Patient ID is required'),
  clinicalOrderId: z.string().optional(),
  severity: z.enum(SEVERITIES),
  description: z.string().min(1, 'Description is required'),
  // datetime-local yields "YYYY-MM-DDTHH:mm" with no timezone — we convert
  // to a full ISO-8601 string with offset before sending so the backend
  // stores the correct UTC value instead of drifting 8 h on PHT (FE-5).
  onsetAt: z.string().optional(),
  outcome: z.enum(OUTCOMES).optional(),
  treatmentGiven: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ReportAdverseEventDialog({ open, onOpenChange }: Props) {
  const createMutation = useCreateAdverseEvent()

  const form = useSafeForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      patientId: '',
      clinicalOrderId: '',
      severity: 'Mild',
      description: '',
      onsetAt: '',
      outcome: undefined,
      treatmentGiven: '',
    },
  })

  // Implicated-dose picker — the selected patient's clinical orders.
  const watchedPatientId = form.watch('patientId')
  const { data: patientOrders } = usePatientClinicalOrders(watchedPatientId || null)
  const orderOptions = patientOrders?.data ?? []

  function onSubmit(values: FormValues) {
    // Convert naive datetime-local string to a full ISO-8601 timestamp with
    // the browser's local timezone offset so the backend receives the correct
    // UTC value (avoids 8-hour PHT drift on regulatory records — FE-5).
    let onsetAtIso: string | undefined
    if (values.onsetAt) {
      const d = new Date(values.onsetAt)
      onsetAtIso = Number.isFinite(d.getTime()) ? d.toISOString() : undefined
    }

    createMutation.mutate(
      {
        patientId: values.patientId,
        clinicalOrderId: values.clinicalOrderId || undefined,
        severity: values.severity,
        description: values.description,
        onsetAt: onsetAtIso,
        outcome: values.outcome,
        treatmentGiven: values.treatmentGiven || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Adverse event reported')
          form.reset()
          onOpenChange(false)
        },
        onError: (err) => {
          toast.error('Failed to report adverse event', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[32.5rem] xl:max-w-[42.5rem]">
        <DialogHeader>
          <DialogTitle>Report adverse event</DialogTitle>
          <DialogDescription>
            Record a post-vaccination adverse event for a patient. All fields marked * are required.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="patientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Patient <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <PatientPicker
                      value={field.value || null}
                      onChange={(id) => {
                        field.onChange(id ?? '')
                        // The implicated dose belongs to the previous patient — clear it.
                        form.setValue('clinicalOrderId', '')
                      }}
                      required
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="clinicalOrderId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Implicated dose / clinical order</FormLabel>
                  <Select
                    onValueChange={(v) => field.onChange(v === 'none' ? '' : v)}
                    value={field.value || 'none'}
                    disabled={!watchedPatientId}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            watchedPatientId ? 'Link to a dose (optional)' : 'Pick a patient first'
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Not linked to a specific dose</SelectItem>
                      {orderOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {`Dose ${o.doseNumber} · ${o.service ?? 'Service'}${
                            o.scheduledDate ? ` · ${formatDate(o.scheduledDate + 'T00:00:00')}` : ''
                          } (${humanizeStatus(o.status)})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="severity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Severity <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select severity" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SEVERITIES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {humanizeStatus(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Description <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="Describe the adverse event…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="onsetAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Onset date</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="outcome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Outcome</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select outcome" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {OUTCOMES.map((o) => (
                        <SelectItem key={o} value={o}>
                          {humanizeStatus(o)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="treatmentGiven"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Treatment given</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Treatment administered…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Submitting…' : 'Submit report'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
