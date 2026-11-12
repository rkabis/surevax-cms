import { useEffect } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  FormDescription,
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
import {
  type NotificationTemplate,
  type CreateNotificationTemplateInput,
  type UpdateNotificationTemplateInput,
  type NotificationTemplateChannel,
  useCreateNotificationTemplate,
  useUpdateNotificationTemplate,
} from './notificationsApi'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { useSafeForm } from '@/lib/useSafeForm'

const CHANNELS: NotificationTemplateChannel[] = ['SMS', 'Email', 'Push']

// `name` is intentionally absent — notification_templates has no `name` column,
// `code` is the human-readable identifier.
const schema = z.object({
  code: z.string().min(1, 'Code is required').max(100),
  channel: z.enum(['SMS', 'Email', 'Push']),
  language: z.string().max(10).optional().or(z.literal('')),
  subject: z.string().max(500).optional().or(z.literal('')),
  body: z.string().min(1, 'Body is required'),
  isActive: z.boolean(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  template?: NotificationTemplate | null
}

function toFormValues(t?: NotificationTemplate | null): FormValues {
  if (!t) {
    return {
      code: '',
      channel: 'SMS',
      language: 'en',
      subject: '',
      body: '',
      isActive: true,
    }
  }
  return {
    code: t.code,
    channel: t.channel,
    language: t.language,
    subject: t.subject ?? '',
    body: t.body,
    isActive: t.isActive,
  }
}

export default function NotificationTemplateDialog({ open, onOpenChange, template }: Props) {
  const isEdit = !!template
  const createMutation = useCreateNotificationTemplate()
  const updateMutation = useUpdateNotificationTemplate()

  const form = useSafeForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(template),
  })

  useEffect(() => {
    if (open) {
      form.reset(toFormValues(template))
    }
  }, [open, template, form])

  const isPending = createMutation.isPending || updateMutation.isPending

  async function onSubmit(values: FormValues) {
    if (isEdit && template) {
      const body: UpdateNotificationTemplateInput = {}
      if (values.code !== template.code) body.code = values.code
      if (values.channel !== template.channel) body.channel = values.channel
      if (values.language !== template.language) body.language = values.language || undefined
      if ((values.subject || '') !== (template.subject ?? ''))
        body.subject = values.subject || undefined
      if (values.body !== template.body) body.body = values.body
      if (values.isActive !== template.isActive) body.isActive = values.isActive

      updateMutation.mutate(
        { id: template.id, body },
        {
          onSuccess: () => onOpenChange(false),
          onError: (err) => {
            toast.error('Failed to update template', { description: apiErrorMessage(err) })
          },
        },
      )
    } else {
      const body: CreateNotificationTemplateInput = {
        code: values.code,
        channel: values.channel,
        language: values.language || 'en',
        subject: values.subject || undefined,
        body: values.body,
        isActive: values.isActive,
      }

      createMutation.mutate(body, {
        onSuccess: () => onOpenChange(false),
        onError: (err) => {
          toast.error('Failed to create template', { description: apiErrorMessage(err) })
        },
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg xl:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit template' : 'New template'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the notification template body, channel, or status.'
              : 'Create a new notification template with channel and body.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Code <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. appointment-reminder" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="channel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Channel <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select channel" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CHANNELS.map((ch) => (
                          <SelectItem key={ch} value={ch}>
                            {ch}
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
                name="language"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Language</FormLabel>
                    <FormControl>
                      <Input placeholder="en" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject</FormLabel>
                  <FormControl>
                    <Input placeholder="Notification subject line" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Body <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      rows={6}
                      placeholder="Template body with {{variable}} placeholders…"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Use {'{{variableName}}'} for dynamic values that will be interpolated at send
                    time.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel>Active</FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create template'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
