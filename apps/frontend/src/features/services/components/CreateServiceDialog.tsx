import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCreateService } from '../api'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { useSafeForm } from '@/lib/useSafeForm'

const SERVICE_TYPES = ['Vaccine', 'Consultation', 'Lab', 'Procedure', 'Product'] as const

const createSchema = z.object({
  code: z
    .string()
    .min(2, 'Code is required (min 2 chars)')
    .max(30)
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers, and dashes only'),
  name: z.string().min(1, 'Name is required').max(200),
  serviceType: z.enum(SERVICE_TYPES),
  category: z.string().max(100).optional().or(z.literal('')),
  basePrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid price (e.g. 1500 or 1500.00)'),
  requiresStock: z.boolean(),
  requiresRx: z.boolean(),
})

type CreateFormValues = z.infer<typeof createSchema>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CreateServiceDialog({ open, onOpenChange }: Props) {
  const createMutation = useCreateService()

  const form = useSafeForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      code: '',
      name: '',
      serviceType: 'Vaccine',
      category: '',
      basePrice: '0.00',
      requiresStock: false,
      requiresRx: false,
    },
  })

  function onSubmit(values: CreateFormValues) {
    createMutation.mutate(
      {
        code: values.code,
        name: values.name,
        serviceType: values.serviceType,
        category: values.category || null,
        basePrice: values.basePrice,
        requiresStock: values.requiresStock,
        requiresRx: values.requiresRx,
      },
      {
        onSuccess: () => {
          form.reset()
          onOpenChange(false)
        },
        onError: (err) => {
          toast.error('Failed to create service', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      form.reset()
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[32.5rem] xl:max-w-[42.5rem]">
        <DialogHeader>
          <DialogTitle>New service</DialogTitle>
          <DialogDescription>
            Add a new service to the catalog. Fields marked * are required.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Code <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="e.g. ARV-IM"
                        className="font-mono uppercase"
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="serviceType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Service type <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SERVICE_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Name <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. Anti-Rabies Vaccine (IM)" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. ARV, TT, Hep B" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="basePrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Default Price (PHP) <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} inputMode="decimal" placeholder="0.00" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Flags
              </h4>
              <FormField
                control={form.control}
                name="requiresStock"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="!mt-0 cursor-pointer">Requires stock</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="requiresRx"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3 space-y-0">
                    <FormControl>
                      <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                    <FormLabel className="!mt-0 cursor-pointer">Requires Rx</FormLabel>
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create service'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
