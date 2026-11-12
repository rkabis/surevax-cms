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
import { useUpdateTemplate, type StandingOrderTemplate } from '../api'
import { apiErrorMessage } from '@/lib/apiErrors'
import { useSafeForm } from '@/lib/useSafeForm'

// Mirrors the backend's `updateTemplateBody` (strict Zod schema in
// apps/backend/src/modules/standing_orders/contract.ts): name, description,
// requiresPhysicianAuth, isActive are the only fields the PUT endpoint
// accepts. Dose items (day offset, sequence, service) are not editable
// through this route, so this form deliberately does not attempt them.
const editSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Maximum 200 characters'),
  description: z.string().max(500, 'Maximum 500 characters').nullable().optional(),
  requiresPhysicianAuth: z.boolean(),
  isActive: z.boolean(),
})

type EditFormValues = z.infer<typeof editSchema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: StandingOrderTemplate
}

export default function StandingOrderTemplateEditSheet({ open, onOpenChange, template }: Props) {
  const mutation = useUpdateTemplate()

  const form = useSafeForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: template.name,
      description: template.description ?? '',
      requiresPhysicianAuth: template.requiresPhysicianAuth,
      isActive: template.isActive,
    },
  })

  // Re-sync defaults when a different template is opened
  useEffect(() => {
    form.reset({
      name: template.name,
      description: template.description ?? '',
      requiresPhysicianAuth: template.requiresPhysicianAuth,
      isActive: template.isActive,
    })
  }, [template.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(values: EditFormValues) {
    try {
      await mutation.mutateAsync({
        id: template.id,
        name: values.name,
        description: values.description || null,
        requiresPhysicianAuth: values.requiresPhysicianAuth,
        isActive: values.isActive,
      })
      toast.success('Template updated.')
      onOpenChange(false)
    } catch (err) {
      toast.error('Failed to update template', {
        description: apiErrorMessage(err),
      })
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <DetailSheet width="standard">
        <SheetHeader className="px-6 py-4 border-b border-border">
          <SheetTitle>Edit standing order template</SheetTitle>
          <SheetDescription>
            Update the name, description, and status for this template.
          </SheetDescription>
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
                      <Input {...field} placeholder="e.g. Anti-rabies PEP (IM)" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ''}
                        placeholder="Protocol summary"
                        rows={3}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Requires physician auth */}
              <FormField
                control={form.control}
                name="requiresPhysicianAuth"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="font-normal cursor-pointer">
                      Requires physician authorization
                    </FormLabel>
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
