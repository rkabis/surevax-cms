import { useState } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useServices } from '@/features/services/api'
import { useAppendExternalDose } from '../api'
import { useSafeForm } from '@/lib/useSafeForm'

const appendExternalDoseSchema = z.object({
  doseNumber: z.coerce.number().int().min(1, 'Dose number must be at least 1'),
  priorDoseDate: z.string().date('Must be a valid date (YYYY-MM-DD)'),
  serviceId: z.string().min(1, 'Service is required'),
  externalClinicianName: z.string().min(1).optional().or(z.literal('')),
  externalClinicName: z.string().min(1).optional().or(z.literal('')),
  externalNotes: z.string().optional(),
})

type FormValues = z.infer<typeof appendExternalDoseSchema>

interface Props {
  open: boolean
  psoId: string
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export default function AppendExternalDoseModal({ open, psoId, onOpenChange, onSuccess }: Props) {
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useSafeForm<FormValues>({
    resolver: zodResolver(appendExternalDoseSchema),
    defaultValues: {
      doseNumber: 1,
      priorDoseDate: '',
      serviceId: '',
      externalClinicianName: '',
      externalClinicName: '',
      externalNotes: '',
    },
  })

  // Services list for the serviceId selector — search with empty string = all active
  const { data: services = [] } = useServices('')

  const { mutateAsync, isPending } = useAppendExternalDose()

  async function onSubmit(values: FormValues) {
    setServerError(null)
    try {
      await mutateAsync({
        psoId,
        doseNumber: values.doseNumber,
        priorDoseDate: values.priorDoseDate,
        serviceId: values.serviceId,
        externalClinicianName: values.externalClinicianName || undefined,
        externalClinicName: values.externalClinicName || undefined,
        externalNotes: values.externalNotes || undefined,
      })
      form.reset()
      onOpenChange(false)
      onSuccess?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected error'
      setServerError(msg)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      form.reset()
      setServerError(null)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record External Dose</DialogTitle>
          <DialogDescription>
            Record a dose administered at another clinic. This dose will be marked as completed and
            counted toward the series so subsequent scheduling continues correctly.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Dose number */}
            <FormField
              control={form.control}
              name="doseNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Dose number <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input type="number" min={1} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Prior dose date */}
            <FormField
              control={form.control}
              name="priorDoseDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Date administered <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Service */}
            <FormField
              control={form.control}
              name="serviceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Service administered <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select service…" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {services.map((svc) => (
                        <SelectItem key={svc.id} value={svc.id}>
                          {svc.name} ({svc.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* External clinician name */}
            <FormField
              control={form.control}
              name="externalClinicianName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Clinician name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Dr. Cruz" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* External clinic name */}
            <FormField
              control={form.control}
              name="externalClinicName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Clinic / facility name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Marikina General Hospital" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Notes */}
            <FormField
              control={form.control}
              name="externalNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="Any additional details…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {serverError && <p className="text-sm font-medium text-destructive">{serverError}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Record dose
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
