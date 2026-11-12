import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRecordOutcome, type AnimalObservationFollowup } from '../api'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AcronymHint } from '@/components/ui/acronym-hint'
import { useSafeForm } from '@/lib/useSafeForm'

const OUTCOMES = [
  'AliveHealthy',
  'AliveSick',
  'DiedNaturally',
  'DiedUnknownCause',
  'KilledForTesting',
  'LostToFollowup',
] as const

const FAT_RESULTS = ['Positive', 'Negative', 'Pending', 'NotTested'] as const

const schema = z
  .object({
    outcome: z.enum(OUTCOMES),
    fatTestResult: z.enum(FAT_RESULTS).optional().nullable(),
    notes: z.string().max(4000).optional().nullable(),
  })
  .refine(
    (v) => {
      // FAT result required when animal died or was killed for testing
      if (v.outcome === 'DiedNaturally' || v.outcome === 'KilledForTesting') {
        return v.fatTestResult != null
      }
      return true
    },
    {
      message: 'FAT test result is required when animal died or was killed',
      path: ['fatTestResult'],
    },
  )

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  biteIncidentId: string
  followup: AnimalObservationFollowup
}

function humanizeOutcome(o: string): string {
  const map: Record<string, string> = {
    AliveHealthy: 'Alive & healthy (Day-28 will be cancelled)',
    AliveSick: 'Alive but sick',
    DiedNaturally: 'Died naturally',
    DiedUnknownCause: 'Dead — cause/testing not recorded',
    KilledForTesting: 'Killed for FAT testing',
    LostToFollowup: 'Lost to follow-up',
  }
  return map[o] ?? o
}

export default function RecordOutcomeDialog({
  open,
  onOpenChange,
  biteIncidentId,
  followup,
}: Props) {
  const mutation = useRecordOutcome()

  const form = useSafeForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      outcome: undefined,
      fatTestResult: null,
      notes: '',
    },
  })

  const outcome = form.watch('outcome')
  const showFat = outcome === 'DiedNaturally' || outcome === 'KilledForTesting'

  function onSubmit(values: FormValues) {
    mutation.mutate(
      {
        biteIncidentId,
        followupId: followup.id,
        body: {
          outcome: values.outcome,
          fatTestResult: values.fatTestResult ?? null,
          notes: values.notes ?? null,
        },
      },
      {
        onSuccess: (result) => {
          form.reset()
          onOpenChange(false)
          if (result.cancelsDay28) {
            toast.success('Outcome recorded — Day-28 dose cancelled', {
              description: result.cancelledOrderId
                ? `Order ${result.cancelledOrderId} cancelled per DOH/WHO SOP.`
                : 'No active Day-28 dose found; observation recorded.',
            })
          } else {
            toast.success('Outcome recorded', {
              description: 'Observation followup completed.',
            })
          }
        },
        onError: (err) => {
          toast.error('Failed to record outcome', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[30rem]">
        <DialogHeader>
          <DialogTitle>Record Day-14 observation outcome</DialogTitle>
          <DialogDescription>
            Due: <strong>{followup.dueDate}</strong> — record the animal's condition and any FAT
            test result.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="outcome"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Animal outcome <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select outcome" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {OUTCOMES.map((o) => (
                        <SelectItem key={o} value={o}>
                          {humanizeOutcome(o)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {showFat && (
              <FormField
                control={form.control}
                name="fatTestResult"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <AcronymHint term="FAT">FAT</AcronymHint> test result{' '}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value ?? undefined}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select result" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {FAT_RESULTS.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional clinical notes…"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Record outcome'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
