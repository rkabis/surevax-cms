import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useUpdateAdverseEvent, type AdverseEvent } from '../api'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSafeForm } from '@/lib/useSafeForm'

const SEVERITIES = ['Mild', 'Moderate', 'Severe', 'LifeThreatening', 'Fatal'] as const
const OUTCOMES = ['Recovered', 'Recovering', 'NotRecovered', 'Fatal', 'Unknown'] as const

const schema = z.object({
  severity: z.enum(SEVERITIES),
  outcome: z.enum(OUTCOMES).optional(),
  description: z.string().min(1, 'Description is required'),
  treatmentGiven: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  event: AdverseEvent
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function UpdateAdverseEventDialog({ event, open, onOpenChange }: Props) {
  const updateMutation = useUpdateAdverseEvent()

  const form = useSafeForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      severity: event.severity as (typeof SEVERITIES)[number],
      outcome: (event.outcome as (typeof OUTCOMES)[number]) ?? undefined,
      description: event.description,
      treatmentGiven: event.treatmentGiven ?? '',
    },
  })

  function onSubmit(values: FormValues) {
    updateMutation.mutate(
      {
        id: event.id,
        body: {
          severity: values.severity,
          outcome: values.outcome,
          description: values.description,
          treatmentGiven: values.treatmentGiven || undefined,
        },
      },
      {
        onSuccess: () => {
          onOpenChange(false)
        },
        onError: (err) => {
          toast.error('Failed to update adverse event', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[30rem] xl:max-w-[40rem]">
        <DialogHeader>
          <DialogTitle>Update adverse event</DialogTitle>
          <DialogDescription>
            Edit severity, outcome, and notes for this adverse event record.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="severity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Severity</FormLabel>
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
              name="outcome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Outcome</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select outcome (optional)" />
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
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="Describe the adverse event…" {...field} />
                  </FormControl>
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
                    <Textarea rows={2} placeholder="Treatment administered (optional)" {...field} />
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
                disabled={updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
