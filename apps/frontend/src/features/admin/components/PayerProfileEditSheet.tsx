import { useEffect } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { DetailSheet } from '@/components/layout'
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
import { useUpdatePayerProfile, type PayerProfileDetail, type PayerType } from '../payerProfilesApi'
import { apiErrorMessage } from '@/lib/apiErrors'
import { useSafeForm } from '@/lib/useSafeForm'

const PAYER_TYPES: { value: PayerType; label: string }[] = [
  { value: 'HMO', label: 'HMO' },
  { value: 'Corporate', label: 'Corporate' },
  { value: 'Government', label: 'Government' },
  { value: 'Promo', label: 'Promo' },
]

const editSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Maximum 200 characters'),
  payerType: z.enum(['HMO', 'Corporate', 'Government', 'Promo']),
  contactName: z.string().max(100, 'Maximum 100 characters').nullable().optional(),
  contactNumber: z.string().max(30, 'Maximum 30 characters').nullable().optional(),
  email: z.string().email('Enter a valid email address').nullable().optional().or(z.literal('')),
  address: z.string().max(500, 'Maximum 500 characters').nullable().optional(),
  paymentTermsDays: z.coerce
    .number()
    .int('Must be a whole number')
    .positive('Must be greater than 0')
    .nullable()
    .optional(),
  notes: z.string().max(2000, 'Maximum 2000 characters').nullable().optional(),
  isActive: z.boolean(),
  priceAdjustmentPercent: z.coerce
    .number()
    .min(-100, 'Cannot discount more than 100%')
    .max(500, 'Maximum 500%')
    .nullable()
    .optional(),
})

type EditFormValues = z.infer<typeof editSchema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: PayerProfileDetail
}

export default function PayerProfileEditSheet({ open, onOpenChange, profile }: Props) {
  const mutation = useUpdatePayerProfile(profile.id)

  const form = useSafeForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: profile.name,
      payerType: profile.payerType,
      contactName: profile.contactName ?? '',
      contactNumber: profile.contactNumber ?? '',
      email: profile.email ?? '',
      address: profile.address ?? '',
      paymentTermsDays: profile.paymentTermsDays ?? undefined,
      notes: profile.notes ?? '',
      isActive: profile.isActive,
      priceAdjustmentPercent:
        profile.priceAdjustmentPercent != null ? Number(profile.priceAdjustmentPercent) : undefined,
    },
  })

  // Re-sync defaults when a different profile is opened
  useEffect(() => {
    form.reset({
      name: profile.name,
      payerType: profile.payerType,
      contactName: profile.contactName ?? '',
      contactNumber: profile.contactNumber ?? '',
      email: profile.email ?? '',
      address: profile.address ?? '',
      paymentTermsDays: profile.paymentTermsDays ?? undefined,
      notes: profile.notes ?? '',
      isActive: profile.isActive,
      priceAdjustmentPercent:
        profile.priceAdjustmentPercent != null ? Number(profile.priceAdjustmentPercent) : undefined,
    })
  }, [profile.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(values: EditFormValues) {
    try {
      await mutation.mutateAsync({
        name: values.name,
        payerType: values.payerType,
        contactName: values.contactName || null,
        contactNumber: values.contactNumber || null,
        email: values.email || null,
        address: values.address || null,
        paymentTermsDays: values.paymentTermsDays ?? null,
        notes: values.notes || null,
        isActive: values.isActive,
        priceAdjustmentPercent: values.priceAdjustmentPercent ?? null,
      })
      toast.success('Payer profile updated.')
      onOpenChange(false)
    } catch (err) {
      toast.error('Failed to update payer profile', {
        description: apiErrorMessage(err),
      })
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <DetailSheet width="standard">
        <SheetHeader className="px-6 py-4 border-b border-border">
          <SheetTitle>Edit payer profile</SheetTitle>
          <SheetDescription>Update the details for this payer profile.</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col flex-1 overflow-hidden"
          >
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Name */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Name <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. PhilHealth" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Payer type */}
              <FormField
                control={form.control}
                name="payerType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Payer type <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PAYER_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Contact name */}
              <FormField
                control={form.control}
                name="contactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        placeholder="e.g. Juan dela Cruz"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Contact number */}
              <FormField
                control={form.control}
                name="contactNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        placeholder="e.g. +63 917 123 4567"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Email */}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        type="email"
                        placeholder="e.g. claims@philhealth.gov.ph"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Address */}
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ''}
                        placeholder="Street address"
                        rows={2}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Payment terms */}
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

              {/* Price adjustment */}
              <FormField
                control={form.control}
                name="priceAdjustmentPercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price adjustment (%)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step={0.01}
                        placeholder="e.g. -10 for 10% off, 15 for 15% markup"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Applied to every service's price for this payer, except services on the
                      exclusion list below. Negative discounts, positive marks up.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Notes */}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ''}
                        placeholder="Internal notes"
                        rows={3}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Active */}
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="font-normal cursor-pointer">Active</FormLabel>
                  </FormItem>
                )}
              />
            </div>

            <SheetFooter className="px-6 py-4 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </DetailSheet>
    </Sheet>
  )
}
