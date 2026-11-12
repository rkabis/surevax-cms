import { useState } from 'react'
import { AlertCircle, Plus, Trash2, Star } from 'lucide-react'
import { apiErrorMessage } from '@/lib/apiErrors'
import { toast } from '@/components/ui/toast'
import {
  useEmergencyContacts,
  useAddEmergencyContact,
  useDeleteEmergencyContact,
  type AddEmergencyContactInput,
} from '../api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { PhoneLink } from '@/components/PhoneLink'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog'

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-PH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

type Props = {
  patientId: string
  isCrossBranch?: boolean
}

const EMPTY_FORM: AddEmergencyContactInput = {
  name: '',
  relation: '',
  phone: '',
  email: '',
  isPrimary: false,
  notes: '',
}

export default function EmergencyContactsTab({ patientId, isCrossBranch = false }: Props) {
  const { data, isLoading, isError } = useEmergencyContacts(patientId)
  const addMutation = useAddEmergencyContact(patientId)
  const deleteMutation = useDeleteEmergencyContact(patientId)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<AddEmergencyContactInput>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.name.trim() || !form.relation.trim() || !form.phone.trim()) {
      setFormError('Name, relationship, and phone are required.')
      return
    }
    const payload: AddEmergencyContactInput = {
      name: form.name.trim(),
      relation: form.relation.trim(),
      phone: form.phone.trim(),
      ...(form.email?.trim() ? { email: form.email.trim() } : {}),
      ...(form.isPrimary ? { isPrimary: true } : {}),
      ...(form.notes?.trim() ? { notes: form.notes.trim() } : {}),
    }
    addMutation.mutate(payload, {
      onSuccess: () => {
        setOpen(false)
        setForm(EMPTY_FORM)
      },
      onError: (err) => setFormError(apiErrorMessage(err)),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.length} contact${data.length !== 1 ? 's' : ''}` : ''}
        </p>
        {!isCrossBranch && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus className="h-4 w-4" aria-hidden />
                Add contact
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm xl:max-w-md">
              <DialogHeader>
                <DialogTitle>Add emergency contact</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-3 mt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ec-name">Name *</Label>
                  <Input
                    id="ec-name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Full name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ec-relation">Relationship *</Label>
                  <Input
                    id="ec-relation"
                    value={form.relation}
                    onChange={(e) => setForm((f) => ({ ...f, relation: e.target.value }))}
                    placeholder="e.g. Spouse, Parent"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ec-phone">Phone *</Label>
                  <Input
                    id="ec-phone"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+63 9XX XXX XXXX"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ec-email">Email</Label>
                  <Input
                    id="ec-email"
                    type="email"
                    value={form.email ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="optional"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="ec-primary"
                    type="checkbox"
                    checked={form.isPrimary ?? false}
                    onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="ec-primary" className="cursor-pointer">
                    Primary contact
                  </Label>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ec-notes">Notes</Label>
                  <Input
                    id="ec-notes"
                    value={form.notes ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="optional"
                  />
                </div>
                {formError && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                    {formError}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <DialogClose asChild>
                    <Button type="button" variant="outline" size="sm">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button type="submit" size="sm" disabled={addMutation.isPending}>
                    {addMutation.isPending ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" aria-hidden />
          Failed to load emergency contacts.
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No emergency contacts recorded.</p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {data.map((contact, idx) => (
            <li key={contact.id}>
              <div className="flex items-start justify-between gap-3 px-3 py-3">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{contact.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {contact.relation}
                    </Badge>
                    {contact.isPrimary && (
                      <Badge variant="default" className="text-xs gap-1">
                        <Star className="h-3 w-3" aria-hidden />
                        Primary
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs">
                    <PhoneLink value={contact.phone} className="text-muted-foreground" />
                  </p>
                  {contact.email && (
                    <p className="text-xs text-muted-foreground">{contact.email}</p>
                  )}
                  {/* contact.notes was removed from EmergencyContact (no DB column). */}
                  <p className="text-xs text-muted-foreground">
                    Added {fmtDate(contact.createdAt)}
                  </p>
                </div>
                {!isCrossBranch && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                    disabled={deleteMutation.isPending}
                    onClick={() =>
                      deleteMutation.mutate(contact.id, {
                        onError: (err) =>
                          toast.error('Failed to delete contact', {
                            description: apiErrorMessage(err),
                          }),
                      })
                    }
                    aria-label={`Delete contact ${contact.name}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </div>
              {idx < data.length - 1 && <Separator />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
