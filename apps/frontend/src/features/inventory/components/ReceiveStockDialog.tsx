import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useReceiveStock } from '../api'
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
import ProductPicker from '@/components/forms/ProductPicker'
import { useSafeForm } from '@/lib/useSafeForm'
import { clinicCalendarDateString } from '@/lib/clinicDate'

const schema = z.object({
  productId: z.string().min(1, 'Product is required'),
  batchNumber: z.string().min(1, 'Batch number is required').max(120),
  expiryDate: z
    .string()
    .min(1, 'Expiry date is required')
    .refine((v) => v >= clinicCalendarDateString(), 'Expiry date cannot be in the past'),
  quantity: z.coerce.number().positive('Quantity must be greater than 0'),
  unitCost: z
    .string()
    .min(1, 'Unit cost is required')
    .refine(
      (v) => /^\d+(\.\d{1,4})?$/.test(v.trim()),
      'Enter a non-negative amount, up to 4 decimal places',
    ),
  manufacturer: z.string().min(1, 'Manufacturer is required').max(200),
  supplierName: z.string().max(200).optional().nullable(),
  supplierInvoiceNumber: z.string().max(200).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Record a delivery of stock at the nurse's own branch: the sole in-app path
 * that can originate supply (previously only the seed script or hand-written
 * SQL could create a lot). Closes STATUS P1 #19 / readiness R9's "no in-app
 * restock path" caveat.
 */
export default function ReceiveStockDialog({ open, onOpenChange }: Props) {
  const receiveMutation = useReceiveStock()

  const form = useSafeForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      productId: '',
      batchNumber: '',
      expiryDate: '',
      quantity: 1,
      unitCost: '',
      manufacturer: '',
      supplierName: '',
      supplierInvoiceNumber: '',
      notes: '',
    },
  })

  function onSubmit(values: FormValues) {
    receiveMutation.mutate(
      {
        productId: values.productId,
        batchNumber: values.batchNumber,
        expiryDate: values.expiryDate,
        quantity: values.quantity,
        unitCost: values.unitCost.trim(),
        manufacturer: values.manufacturer,
        supplierName: values.supplierName?.trim() || null,
        supplierInvoiceNumber: values.supplierInvoiceNumber?.trim() || null,
        notes: values.notes?.trim() || null,
      },
      {
        onSuccess: (result) => {
          toast(
            result.isNewLot
              ? `Lot ${result.id} received: ${result.quantityOnHand} on hand.`
              : `Batch topped up: ${result.quantityOnHand} now on hand for ${result.batchNumber}.`,
          )
          form.reset()
          onOpenChange(false)
        },
        onError: (err) => {
          toast.error('Failed to receive stock', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Receive stock</DialogTitle>
          <DialogDescription>
            Record a delivery at this branch. A repeat delivery of a batch already on hand tops up
            its existing lot instead of creating a duplicate.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="productId"
              render={() => (
                <FormItem>
                  <FormLabel>
                    Product <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <ProductPicker
                      value={form.watch('productId') || null}
                      onChange={(id) => form.setValue('productId', id || '')}
                      required
                      disabled={receiveMutation.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="batchNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Batch number <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. VRB-2026-004" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="expiryDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Expiry date <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="date" min={clinicCalendarDateString()} {...field} />
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
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="unitCost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Unit cost <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="manufacturer"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Manufacturer <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Abhayrab" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="supplierName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Supplier</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="supplierInvoiceNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice number</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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
              <Button type="submit" disabled={receiveMutation.isPending}>
                {receiveMutation.isPending ? 'Receiving…' : 'Receive stock'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
