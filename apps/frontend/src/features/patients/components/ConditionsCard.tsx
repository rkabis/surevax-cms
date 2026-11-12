import { useState } from 'react'

import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, Edit, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import {
  usePatientConditions,
  useAddPatientCondition,
  useUpdatePatientCondition,
  useDeletePatientCondition,
  type PatientCondition,
  type AddPatientConditionInput,
} from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ICD10Picker from '@/components/forms/ICD10Picker'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from '@/components/ui/toast'
import { DirtyFormGuard } from '@/components/layout'
import { useSafeForm } from '@/lib/useSafeForm'

const STATUSES = ['Active', 'Resolved'] as const

const STATUS_VARIANT: Record<string, 'due' | 'ok'> = {
  Active: 'due',
  Resolved: 'ok',
}

const schema = z.object({
  conditionName: z.string().min(1, 'Condition name is required').max(200),
  icd10Code: z.string().max(20).optional().or(z.literal('')),
  status: z.enum(STATUSES).optional(),
  onsetDate: z.string().optional().or(z.literal('')),
  notes: z.string().max(1000).optional().or(z.literal('')),
})

type FormValues = z.infer<typeof schema>

type Props = {
  patientId: string
  /**
   * True when this patient is homed at a DIFFERENT branch than the caller's
   * session (Cross-Branch PHI RFC Tier-2 masking, extended to conditions).
   * The list query still returns a row per recorded condition (so the count
   * is honest) but every detail field is nulled server-side; never render
   * the masked fields as if they were real data, and never offer
   * add/edit/delete (cross-branch writes are rejected server-side
   * regardless).
   */
  isCrossBranch?: boolean
  /**
   * Full (unmasked) rows from a successful break-glass reveal. When present,
   * these replace the masked query result for display: the reveal is
   * read-only, so add/edit/delete stay hidden even once revealed.
   */
  revealedConditions?: PatientCondition[]
}

const EMPTY_FORM: FormValues = {
  conditionName: '',
  icd10Code: '',
  status: undefined,
  onsetDate: '',
  notes: '',
}

export default function ConditionsCard({
  patientId,
  isCrossBranch = false,
  revealedConditions,
}: Props) {
  const { data, isLoading, isError } = usePatientConditions(patientId)
  const addMutation = useAddPatientCondition(patientId)
  const updateMutation = useUpdatePatientCondition(patientId)
  const deleteMutation = useDeletePatientCondition(patientId)
  const revealed = revealedConditions !== undefined
  // Display data: the revealed (full-detail) rows once break-glass has run,
  // otherwise whatever the query returned (masked or not, per isCrossBranch).
  const displayData = revealed ? revealedConditions : data
  // Add/edit/delete are never offered for a cross-branch patient, revealed or
  // not: the reveal is read-only by design (patterns.md) and the write
  // routes reject it server-side regardless.
  const canWrite = !isCrossBranch

  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<PatientCondition | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PatientCondition | null>(null)
  // N3: track which row's delete is in-flight
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const addForm = useSafeForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_FORM,
  })

  const editForm = useSafeForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_FORM,
  })

  function openEdit(condition: PatientCondition) {
    // conditionName is only ever null on a masked (cross-branch) row, and
    // the edit affordance that calls this is never rendered for one; the
    // fallback is just to satisfy the (now-nullable) PatientCondition type.
    editForm.reset({
      conditionName: condition.conditionName ?? '',
      icd10Code: condition.icd10Code ?? '',
      status: (condition.status as FormValues['status']) ?? undefined,
      onsetDate: condition.onsetDate ? condition.onsetDate.slice(0, 10) : '',
      notes: condition.notes ?? '',
    })
    setEditTarget(condition)
  }

  function onAddSubmit(values: FormValues) {
    const payload: AddPatientConditionInput = {
      conditionName: values.conditionName.trim(),
      ...(values.icd10Code?.trim() ? { icd10Code: values.icd10Code.trim() } : {}),
      ...(values.status ? { status: values.status } : {}),
      ...(values.onsetDate?.trim() ? { onsetDate: values.onsetDate } : {}),
      ...(values.notes?.trim() ? { notes: values.notes.trim() } : {}),
    }
    addMutation.mutate(payload, {
      onSuccess: () => {
        setAddOpen(false)
        addForm.reset(EMPTY_FORM)
      },
    })
  }

  function onEditSubmit(values: FormValues) {
    if (!editTarget) return
    updateMutation.mutate(
      {
        conditionId: editTarget.id,
        data: {
          conditionName: values.conditionName.trim(),
          ...(values.icd10Code?.trim() ? { icd10Code: values.icd10Code.trim() } : {}),
          ...(values.status ? { status: values.status } : {}),
          ...(values.onsetDate?.trim() ? { onsetDate: values.onsetDate } : {}),
          ...(values.notes?.trim() ? { notes: values.notes.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          setEditTarget(null)
          editForm.reset(EMPTY_FORM)
        },
      },
    )
  }

  // N1 + N2 + N3: confirm → set deletingId → mutate → clear / toast on error
  function onConfirmDelete() {
    if (!deleteTarget) return
    const id = deleteTarget.id
    const label = deleteTarget.conditionName
    setDeleteTarget(null)
    setDeletingId(id)
    deleteMutation.mutate(id, {
      onSuccess: () => {
        setDeletingId(null)
      },
      onError: () => {
        setDeletingId(null)
        toast.error('Failed to delete condition', {
          description: `Could not remove "${label}". Please try again.`,
        })
      },
    })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Conditions</CardTitle>
          {canWrite && (
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1 px-2"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add
              </Button>
              <DialogContent className="sm:max-w-sm xl:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add condition</DialogTitle>
                </DialogHeader>
                <DirtyFormGuard when={addForm.formState.isDirty} />
                <Form {...addForm}>
                  <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-3">
                    <FormField
                      control={addForm.control}
                      name="conditionName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Condition name <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Asthma" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={addForm.control}
                      name="icd10Code"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ICD-10 code</FormLabel>
                          <FormControl>
                            <ICD10Picker
                              value={field.value ?? ''}
                              onChange={(code, description) => {
                                field.onChange(code)
                                // Auto-fill conditionName from the picker description
                                // when it's still blank — user can still override.
                                if (!addForm.getValues('conditionName')) {
                                  addForm.setValue('conditionName', description, {
                                    shouldDirty: true,
                                  })
                                }
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={addForm.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select status" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={addForm.control}
                      name="onsetDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Onset date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={addForm.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes</FormLabel>
                          <FormControl>
                            <Textarea rows={2} placeholder="Optional" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {addMutation.isError && (
                      <p className="text-sm text-destructive flex items-center gap-1" role="alert">
                        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                        {addMutation.error.message}
                      </p>
                    )}
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setAddOpen(false)
                          addForm.reset(EMPTY_FORM)
                        }}
                        disabled={addMutation.isPending}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={addMutation.isPending}>
                        {addMutation.isPending ? 'Saving…' : 'Save'}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && !revealed ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError && !revealed ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" aria-hidden />
            Failed to load conditions.
          </div>
        ) : !displayData || displayData.length === 0 ? (
          // A genuinely empty array is honest either way: masking nulls
          // fields on existing rows, it never fabricates an empty result
          // from real data, so "None on record" is never a lie here.
          <p className="text-xs text-muted-foreground">None on record</p>
        ) : isCrossBranch && !revealed ? (
          // Masked: the row survives (so the count above is truthful) but
          // every field is nulled. Disclose existence, not detail: a nurse
          // who saw nothing at all here might not think to break the glass
          // before administering.
          <div className="flex items-center gap-2 rounded border border-border bg-muted/40 px-3 py-2.5">
            <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
            <p className="text-xs text-muted-foreground">
              {displayData.length} {displayData.length === 1 ? 'condition' : 'conditions'} on record
              at another branch, hidden here. Break the glass to view.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded border border-border">
            {displayData.map((condition) => (
              <li key={condition.id}>
                <div className="flex items-start justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{condition.conditionName}</span>
                      {condition.status && (
                        <Badge
                          variant={STATUS_VARIANT[condition.status] ?? 'outline'}
                          className="text-xs"
                        >
                          {condition.status}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {condition.icd10Code && (
                        <span className="font-mono tabular-nums">{condition.icd10Code}</span>
                      )}
                      {condition.onsetDate && (
                        <span>
                          {condition.icd10Code && '·'} Onset{' '}
                          {new Date(condition.onsetDate).toLocaleDateString('en-PH', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      )}
                    </div>
                    {condition.notes && (
                      <p className="text-xs text-muted-foreground">{condition.notes}</p>
                    )}
                  </div>
                  {canWrite && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => openEdit(condition)}
                        aria-label={`Edit ${condition.conditionName}`}
                      >
                        <Edit className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      {/* N1: open confirm dialog instead of immediate delete */}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={deletingId === condition.id}
                        onClick={() => setDeleteTarget(condition)}
                        aria-label={`Delete ${condition.conditionName}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Edit Dialog */}
        <Dialog
          open={editTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setEditTarget(null)
              editForm.reset(EMPTY_FORM)
            }
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Edit condition</DialogTitle>
            </DialogHeader>
            <DirtyFormGuard when={editForm.formState.isDirty} />
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-3">
                <FormField
                  control={editForm.control}
                  name="conditionName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Condition name <span className="text-destructive">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="icd10Code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ICD-10 code</FormLabel>
                      <FormControl>
                        <ICD10Picker
                          value={field.value ?? ''}
                          onChange={(code) => field.onChange(code)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="onsetDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Onset date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea rows={2} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {updateMutation.isError && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                    {updateMutation.error.message}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditTarget(null)
                      editForm.reset(EMPTY_FORM)
                    }}
                    disabled={updateMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? 'Saving…' : 'Save'}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* N1: Delete confirmation dialog */}
        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete condition?</AlertDialogTitle>
              <AlertDialogDescription>
                Remove <strong>{deleteTarget?.conditionName}</strong> from this patient&apos;s
                condition record. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={onConfirmDelete}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
