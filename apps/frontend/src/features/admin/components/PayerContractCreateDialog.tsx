import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { useCreatePayerContract } from '../payerContractsApi'
import { apiErrorMessage } from '@/lib/apiErrors'
import { useSafeForm } from '@/lib/useSafeForm'

const createContractSchema = z.object({
  contractNumber: z
    .string()
    .trim()
    .min(1, 'Contract number is required')
    .max(100, 'Maximum 100 characters'),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date')
    .or(z.literal(''))
    .nullable()
    .optional(),
  paymentTermsDays: z.coerce
    .number()
    .int('Must be a whole number')
    .positive('Must be greater than 0')
    .nullable()
    .optional(),
  claimSubmissionFormat: z.string().max(50, 'Maximum 50 characters').nullable().optional(),
  requiresPriorAuth: z.boolean(),
  feeScheduleNotes: z.string().max(2000, 'Maximum 2000 characters').nullable().optional(),
  contactName: z.string().max(100, 'Maximum 100 characters').nullable().optional(),
  contactNumber: z.string().max(30, 'Maximum 30 characters').nullable().optional(),
  contactEmail: z
    .string()
    .email('Enter a valid email address')
    .nullable()
    .optional()
    .or(z.literal('')),
})

type CreateContractFormValues = z.infer<typeof createContractSchema>

const EMPTY_VALUES: CreateContractFormValues = {
  contractNumber: '',
  effectiveFrom: '',
  effectiveTo: '',
  paymentTermsDays: undefined,
  claimSubmissionFormat: '',
  requiresPriorAuth: false,
  feeScheduleNotes: '',
  contactName: '',
  contactNumber: '',
  contactEmail: '',
}

type Props = {
  payerId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function PayerContractCreateDialog({ payerId, open, onOpenChange }: Props) {
  const mutation = useCreatePayerContract(payerId)

  const form = useSafeForm<CreateContractFormValues>({
    resolver: zodResolver(createContractSchema),
    defaultValues: EMPTY_VALUES,
  })

  async function onSubmit(values: CreateContractFormValues) {
    try {
      await mutation.mutateAsync({
        contractNumber: values.contractNumber,
        effectiveFrom: values.effectiveFrom,
        effectiveTo: values.effectiveTo || null,
        paymentTermsDays: values.paymentTermsDays ?? null,
        claimSubmissionFormat: values.claimSubmissionFormat || null,
        requiresPriorAuth: values.requiresPriorAuth,
        feeScheduleNotes: values.feeScheduleNotes || null,
        contactName: values.contactName || null,
        contactNumber: values.contactNumber || null,
        contactEmail: values.contactEmail || null,
      })
      toast.success('Payer contract created.')
      form.reset(EMPTY_VALUES)
      onOpenChange(false)
    } catch (err) {
      toast.error('Failed to create payer contract', { description: apiErrorMessage(err) })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) form.reset(EMPTY_VALUES)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New payer contract</DialogTitle>
          <DialogDescription>
            Add a fee schedule and terms agreement for this payer. Claims can reference this
            contract for rate and prior-authorization enforcement.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="contractNumber"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>
                      Contract number <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. CTR-2026-001" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="effectiveFrom"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Effective from <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} type="date" className="font-mono tabular-nums" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="effectiveTo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Effective to</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        type="date"
                        className="font-mono tabular-nums"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="paymentTermsDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment terms (days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        placeholder="e.g. 30"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="claimSubmissionFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Claim submission format</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} placeholder="e.g. EDI-837, PDF" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="requiresPriorAuth"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="font-normal cursor-pointer">
                    Requires prior authorization
                  </FormLabel>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="feeScheduleNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fee schedule notes</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value ?? ''}
                      placeholder="Rate variances, coverage caps, exclusions…"
                      rows={2}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="contactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact name</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} placeholder="Account manager" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="contactNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact phone</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} placeholder="+63 917 123 4567" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="contactEmail"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Contact email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        type="email"
                        placeholder="claims@payer.example"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Creating…' : 'Create contract'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
