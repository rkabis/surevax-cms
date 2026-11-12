import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form'
import { deriveReceiptMode, useUpdateBranchReceiptConfig, type BranchDetail } from '../branchesApi'
import { apiErrorMessage } from '@/lib/apiErrors'
import { useSafeForm } from '@/lib/useSafeForm'

// Mirrors the backend's `branchReceiptConfigSchema`
// (apps/backend/src/modules/admin/branches.ts): tin, registeredName and
// permitNo are the statutory core fields the reader's `BranchReceiptConfig`
// type treats as mandatory; accreditationNo and orSeries stay optional even
// in official mode.
const formSchema = z
  .object({
    mode: z.enum(['acknowledgement', 'bir_official']),
    tin: z.string().trim().max(50),
    registeredName: z.string().trim().max(200),
    permitNo: z.string().trim().max(100),
    accreditationNo: z.string().trim().max(100),
    orSeries: z.string().trim().max(100),
  })
  .superRefine((val, ctx) => {
    if (val.mode !== 'bir_official') return
    if (!val.tin) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tin'], message: 'TIN is required' })
    }
    if (!val.registeredName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['registeredName'],
        message: 'Registered name is required',
      })
    }
    if (!val.permitNo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['permitNo'],
        message: 'Permit or ATP number is required',
      })
    }
  })

type FormValues = z.infer<typeof formSchema>

type Props = {
  branch: BranchDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}

function defaultsFor(branch: BranchDetail): FormValues {
  const current = deriveReceiptMode(branch.settings)
  return {
    mode: current.mode,
    tin: current.bir?.tin ?? '',
    registeredName: current.bir?.registeredName ?? '',
    permitNo: current.bir?.permitNo ?? '',
    accreditationNo: current.bir?.accreditationNo ?? '',
    orSeries: current.bir?.orSeries ?? '',
  }
}

export default function BranchReceiptConfigDialog({ branch, open, onOpenChange }: Props) {
  const mutation = useUpdateBranchReceiptConfig(branch.id)

  const form = useSafeForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultsFor(branch),
  })

  // Re-sync defaults whenever a fresh branch row (or the dialog re-opening) arrives.
  useEffect(() => {
    if (open) form.reset(defaultsFor(branch))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branch.id, branch.settings])

  const mode = form.watch('mode')
  const isOfficial = mode === 'bir_official'

  async function onSubmit(values: FormValues) {
    try {
      await mutation.mutateAsync({
        mode: values.mode,
        tin: values.tin || null,
        registeredName: values.registeredName || null,
        permitNo: values.permitNo || null,
        accreditationNo: values.accreditationNo || null,
        orSeries: values.orSeries || null,
      })
      toast.success(
        values.mode === 'bir_official'
          ? 'Branch flipped to BIR official receipts.'
          : 'Branch reset to acknowledgement receipts.',
      )
      onOpenChange(false)
    } catch (err) {
      toast.error('Failed to update receipt configuration', { description: apiErrorMessage(err) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure branch receipts</DialogTitle>
          <DialogDescription>
            Set this branch to print acknowledgement receipts (default, manual OR issued on request)
            or BIR official receipts once its statutory registration details are on file.
            Placeholder values only, not the real registration numbers.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Receipt mode <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="acknowledgement">Acknowledgement receipt</SelectItem>
                      <SelectItem value="bir_official">BIR official receipt</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Official mode requires TIN, registered name and permit or ATP number below.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    TIN{isOfficial && <span className="text-destructive"> *</span>}
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. 000-000-000-000" className="font-mono" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="registeredName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Registered name{isOfficial && <span className="text-destructive"> *</span>}
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Business name on file with BIR" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="permitNo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Permit or ATP number{isOfficial && <span className="text-destructive"> *</span>}
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. PTU-0000000000" className="font-mono" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="accreditationNo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Accreditation number</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Optional" className="font-mono" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="orSeries"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>OR series</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. 000001 to 000999" className="font-mono" />
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
                {mutation.isPending ? 'Saving…' : 'Save receipt configuration'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
