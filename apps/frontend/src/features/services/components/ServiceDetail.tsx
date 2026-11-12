import { useState, useEffect } from 'react'
import { AlertCircle, Pencil } from 'lucide-react'

import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useService, useServicePrices, useUpdateService } from '../api'
import { toast } from '@/components/ui/toast'
import { DetailSheet } from '@/components/layout'
import { apiErrorMessage } from '@/lib/apiErrors'
import { UserLabel } from '@/components/UserLabel'
import { formatMoney } from '@/lib/format'
import { useSafeForm } from '@/lib/useSafeForm'
import { useAuth } from '@/features/auth/context'
import { CATALOG_WRITE_ROLES, hasRole } from '@/lib/roles'

const SERVICE_TYPES = ['Vaccine', 'Consultation', 'Lab', 'Procedure', 'Product'] as const

const editSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  serviceType: z.enum(SERVICE_TYPES),
  category: z.string().max(100).optional().or(z.literal('')),
  basePrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid price (e.g. 1500 or 1500.00)'),
  isActive: z.boolean(),
  requiresStock: z.boolean(),
  requiresRx: z.boolean(),
})

type EditFormValues = z.infer<typeof editSchema>

type Props = {
  serviceId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  const empty = value === null || value === undefined || value === ''
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm break-all ${mono ? 'font-mono' : ''}`}>
        {empty ? <span className="text-muted-foreground">—</span> : value}
      </p>
    </div>
  )
}

function BoolBadge({ value }: { value: boolean }) {
  return (
    <Badge variant={value ? 'default' : 'outline'} className="text-xs">
      {value ? 'Yes' : 'No'}
    </Badge>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</div>
    </section>
  )
}

function formatPrice(price: string) {
  return formatMoney(price)
}

function formatDate(d: string, infinityLabel = 'System origin') {
  if (!d) return '—'
  if (d === '-infinity') return infinityLabel
  const date = new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function ServiceDetail({ serviceId, open, onOpenChange }: Props) {
  const { data: service, isLoading, isError } = useService(serviceId)
  const { data: prices } = useServicePrices(serviceId)
  const updateMutation = useUpdateService()
  // Mirrors the backend gate on PATCH/PUT /api/services/:id. A Nurse, Cashier
  // or the shared `Branch` login reads the catalog but cannot reprice it.
  const { user } = useAuth()
  const canEditCatalog = hasRole(user, CATALOG_WRITE_ROLES)

  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState('details')

  const form = useSafeForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: '',
      serviceType: 'Vaccine',
      category: '',
      basePrice: '0.00',
      isActive: true,
      requiresStock: false,
      requiresRx: false,
    },
  })

  useEffect(() => {
    if (!editing) {
      form.reset()
    }
  }, [editing, form])

  function handleStartEdit() {
    if (service) {
      form.reset({
        name: service.name,
        serviceType: service.serviceType as (typeof SERVICE_TYPES)[number],
        category: service.category ?? '',
        basePrice: service.basePrice,
        isActive: service.isActive,
        requiresStock: service.requiresStock,
        requiresRx: service.requiresRx,
      })
    }
    setEditing(true)
  }

  function handleCancelEdit() {
    setEditing(false)
  }

  function onSubmit(values: EditFormValues) {
    if (!service) return
    const body: Record<string, unknown> = {
      name: values.name,
      serviceType: values.serviceType,
      category: values.category || null,
      isActive: values.isActive,
      requiresStock: values.requiresStock,
      requiresRx: values.requiresRx,
    }
    if (values.basePrice !== service.basePrice) {
      body.basePrice = values.basePrice
    }
    updateMutation.mutate(
      { id: service.id, body },
      {
        onSuccess: () => {
          setEditing(false)
        },
        onError: (err) => {
          toast.error('Failed to update service', { description: apiErrorMessage(err) })
        },
      },
    )
  }

  function handleSheetOpenChange(open: boolean) {
    if (!open) {
      setEditing(false)
      setTab('details')
    }
    onOpenChange(open)
  }

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <DetailSheet className="overflow-y-auto">
        <SheetHeader>
          <div className="flex items-start justify-between gap-2 pr-8">
            <div>
              <SheetTitle>{service ? service.name : isLoading ? 'Loading…' : 'Service'}</SheetTitle>
              <SheetDescription>
                {service ? `${service.code} · ${service.serviceType}` : 'Service catalog entry'}
              </SheetDescription>
            </div>
            {service && !editing && canEditCatalog && (
              <Button variant="outline" size="sm" onClick={handleStartEdit} className="shrink-0">
                <Pencil className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                Edit
              </Button>
            )}
          </div>
        </SheetHeader>

        {isLoading && (
          <div className="mt-6 space-y-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-32" />
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          </div>
        )}

        {isError && (
          <div className="mt-6 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" aria-hidden />
            <span className="text-sm">Failed to load service.</span>
          </div>
        )}

        {service && (
          <Tabs value={tab} onValueChange={setTab} className="mt-6">
            <TabsList className="w-full">
              <TabsTrigger value="details" className="flex-1">
                Details
              </TabsTrigger>
              <TabsTrigger value="prices" className="flex-1">
                Prices
              </TabsTrigger>
            </TabsList>

            {/* ── Details tab ──────────────────────────────────────── */}
            <TabsContent value="details" className="space-y-6">
              {editing && canEditCatalog ? (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Name <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="serviceType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              Service Type <span className="text-destructive">*</span>
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
                    </div>

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

                    <Separator />

                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Flags
                      </h4>
                      <FormField
                        control={form.control}
                        name="isActive"
                        render={({ field }) => (
                          <FormItem className="flex items-center gap-3 space-y-0">
                            <FormControl>
                              <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                            <FormLabel className="!mt-0 cursor-pointer">Active</FormLabel>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="requiresStock"
                        render={({ field }) => (
                          <FormItem className="flex items-center gap-3 space-y-0">
                            <FormControl>
                              <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                            <FormLabel className="!mt-0 cursor-pointer">Requires Stock</FormLabel>
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

                    <Separator />

                    <div className="flex gap-2 justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancelEdit}
                        disabled={updateMutation.isPending}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" disabled={updateMutation.isPending}>
                        {updateMutation.isPending ? 'Saving…' : 'Save'}
                      </Button>
                    </div>
                  </form>
                </Form>
              ) : (
                <>
                  <Section title="Identity">
                    <Field label="Code" value={service.code} mono />
                    <Field label="Name" value={service.name} />
                    <Field label="Service type" value={service.serviceType} />
                    <Field label="Category" value={service.category} />
                  </Section>

                  <Separator />

                  <Section title="Pricing">
                    <div className="col-span-2 space-y-0.5">
                      <p className="text-xs text-muted-foreground">Default price</p>
                      <p className="text-sm font-mono tabular-nums">
                        {formatPrice(service.basePrice)}
                      </p>
                      <p className="text-xs text-muted-foreground/70">
                        Tenant-wide catch-all price; overrides can be added per branch/payer.
                      </p>
                    </div>
                  </Section>

                  <Separator />

                  <Section title="Flags">
                    <Field
                      label="Requires stock"
                      value={<BoolBadge value={service.requiresStock} />}
                    />
                    <Field label="Requires Rx" value={<BoolBadge value={service.requiresRx} />} />
                    <Field label="Active" value={<BoolBadge value={service.isActive} />} />
                  </Section>

                  <Separator />

                  <Section title="Audit">
                    <Field label="Deleted at" value={service.deletedAt} />
                    <Field label="Created at" value={service.createdAt} />
                    <Field label="Updated at" value={service.updatedAt} />
                    <Field label="Created by" value={<UserLabel user={service.createdBy} />} />
                  </Section>
                </>
              )}
            </TabsContent>

            {/* ── Prices tab ──────────────────────────────────────── */}
            <TabsContent value="prices" className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Price history for this service. Most-specific-wins resolution: branch + payer &gt;
                branch-only &gt; payer-only &gt; catch-all.
              </p>
              {prices && prices.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No price history found.
                </p>
              )}
              {prices && prices.length > 0 && (
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="text-xs">Effective From</TableHead>
                      <TableHead className="text-xs">Effective To</TableHead>
                      <TableHead className="text-xs">Branch</TableHead>
                      <TableHead className="text-xs">Payer</TableHead>
                      <TableHead className="text-xs text-right">Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {prices.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs font-mono tabular-nums">
                          {formatDate(p.effectiveFrom, 'Catch-all')}
                        </TableCell>
                        <TableCell className="text-xs font-mono tabular-nums text-muted-foreground">
                          {p.effectiveTo ? formatDate(p.effectiveTo) : 'Present'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.branchId ?? 'All'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.payerId ?? 'Retail'}
                        </TableCell>
                        <TableCell className="text-xs font-mono tabular-nums text-right font-medium">
                          {formatPrice(p.unitPrice)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DetailSheet>
    </Sheet>
  )
}
