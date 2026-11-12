import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useShipTransfer } from '../api'
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import BranchPicker from '@/components/forms/BranchPicker'
import LotPicker from '@/components/forms/LotPicker'
import { useSafeForm } from '@/lib/useSafeForm'

const schema = z
  .object({
    sourceBranchId: z.string().min(1, 'Source branch is required'),
    destinationBranchId: z.string().min(1, 'Destination branch is required'),
    lotId: z.string().min(1, 'Lot ID is required'),
    quantity: z.coerce.number().positive('Quantity must be greater than 0'),
    notes: z.string().max(4000).optional().nullable(),
  })
  .refine((d) => d.sourceBranchId !== d.destinationBranchId, {
    message: 'Source and destination branch must be different',
    path: ['destinationBranchId'],
  })

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ShipTransferDialog({ open, onOpenChange }: Props) {
  const shipMutation = useShipTransfer()

  const form = useSafeForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      sourceBranchId: '',
      destinationBranchId: '',
      lotId: '',
      quantity: 1,
      notes: '',
    },
  })

  function onSubmit(values: FormValues) {
    shipMutation.mutate(
      {
        sourceBranchId: values.sourceBranchId,
        destinationBranchId: values.destinationBranchId,
        lotId: values.lotId,
        quantity: values.quantity,
        notes: values.notes ?? null,
      },
      {
        onSuccess: () => {
          toast('Transfer initiated — awaiting receipt confirmation.')
          form.reset()
          onOpenChange(false)
        },
        onError: (err) => {
          toast.error('Failed to initiate transfer', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send transfer</DialogTitle>
          <DialogDescription>
            Initiate an inventory transfer between branches. The receiving branch must confirm
            receipt.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="sourceBranchId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Source branch <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <BranchPicker
                      value={field.value || null}
                      onChange={(v) => field.onChange(v ?? '')}
                      placeholder="Select source branch…"
                      required
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="destinationBranchId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Destination branch <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <BranchPicker
                      value={field.value || null}
                      onChange={(v) => field.onChange(v ?? '')}
                      placeholder="Select destination branch…"
                      required
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lotId"
              render={() => (
                <FormItem>
                  <FormLabel>
                    Lot ID <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <LotPicker
                      value={form.watch('lotId') || null}
                      onChange={(id) => form.setValue('lotId', id || '')}
                      required
                      disabled={shipMutation.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Quantity <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input type="number" min={1} step="any" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Optional notes…"
                      rows={2}
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
              <Button type="submit" disabled={shipMutation.isPending}>
                {shipMutation.isPending ? 'Sending…' : 'Send transfer'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
