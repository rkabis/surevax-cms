import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from '@/components/ui/toast'
import { apiErrorMessage } from '@/lib/apiErrors'
import { useCreateUser, useAdminBranches, ALL_ROLES, type UserRole } from '../usersApi'

type Props = {
  onSuccess: () => void
  onCancel: () => void
}

export default function UserCreateForm({ onSuccess, onCancel }: Props) {
  const createUser = useCreateUser()
  const branchesQuery = useAdminBranches()
  const branches = branchesQuery.data ?? []

  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [selectedRoles, setSelectedRoles] = useState<UserRole[]>([])
  const [selectedBranches, setSelectedBranches] = useState<string[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})

  function toggleRole(role: UserRole) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    )
  }

  function toggleBranch(branchId: string) {
    setSelectedBranches((prev) =>
      prev.includes(branchId) ? prev.filter((b) => b !== branchId) : [...prev, branchId],
    )
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!email.trim()) errs['email'] = 'Email is required'
    if (!firstName.trim()) errs['firstName'] = 'First name is required'
    if (!lastName.trim()) errs['lastName'] = 'Last name is required'
    if (!password.trim()) errs['password'] = 'Password is required'
    else if (password.length < 8) errs['password'] = 'Minimum 8 characters'
    if (selectedRoles.length === 0) errs['roles'] = 'Select at least one role'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    try {
      await createUser.mutateAsync({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        password,
        role: selectedRoles[0],
        roles: selectedRoles,
        ...(selectedBranches.length > 0 && {
          branchId: selectedBranches[0],
          branches: selectedBranches,
        }),
        ...(licenseNumber.trim() && { licenseNumber: licenseNumber.trim() }),
        isActive: true,
        canLogin: true,
      })
      toast('User created', {
        description: `${firstName} ${lastName} has been added.`,
      })
      onSuccess()
    } catch (err) {
      toast.error('Error', { description: apiErrorMessage(err) })
    }
  }

  return (
    <ScrollArea className="h-full">
      <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="uc-first">
              First name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="uc-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Juan"
            />
            {errors['firstName'] && (
              <p className="text-xs text-destructive">{errors['firstName']}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="uc-last">
              Last name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="uc-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="dela Cruz"
            />
            {errors['lastName'] && <p className="text-xs text-destructive">{errors['lastName']}</p>}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="uc-email">
            Email <span className="text-destructive">*</span>
          </Label>
          <Input
            id="uc-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="juan@clinic.ph"
          />
          {errors['email'] && <p className="text-xs text-destructive">{errors['email']}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="uc-password">
            Password <span className="text-destructive">*</span>
          </Label>
          <Input
            id="uc-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 8 characters"
            autoComplete="new-password"
          />
          {errors['password'] && <p className="text-xs text-destructive">{errors['password']}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="uc-license">License number</Label>
          <Input
            id="uc-license"
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
            placeholder="Optional"
          />
        </div>

        {/* Roles multi-select */}
        <div className="space-y-2">
          <Label>Roles</Label>
          <div className="grid grid-cols-2 gap-2">
            {ALL_ROLES.map((role) => (
              <label
                key={role}
                className="flex items-center gap-2 cursor-pointer rounded-md border border-border px-3 py-2 hover:bg-accent/50 transition-colors"
              >
                <Checkbox
                  checked={selectedRoles.includes(role)}
                  onCheckedChange={() => toggleRole(role)}
                />
                <span className="text-sm">{role}</span>
              </label>
            ))}
          </div>
          {errors['roles'] && <p className="text-xs text-destructive">{errors['roles']}</p>}
        </div>

        {/* Branches multi-select — sourced from /api/admin/branches */}
        <div className="space-y-2">
          <Label>Branches</Label>
          {branchesQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading branches…</p>
          ) : branches.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No branches configured. Leave unchecked for tenant-wide access.
            </p>
          ) : (
            <div className="space-y-2">
              {branches.map((branch) => (
                <label
                  key={branch.id}
                  className="flex items-center gap-2 cursor-pointer rounded-md border border-border px-3 py-2 hover:bg-accent/50 transition-colors"
                >
                  <Checkbox
                    checked={selectedBranches.includes(branch.id)}
                    onCheckedChange={() => toggleBranch(branch.id)}
                  />
                  <span className="text-sm">
                    <span className="font-mono tabular-nums text-xs text-muted-foreground mr-2">
                      {branch.code}
                    </span>
                    {branch.name}
                  </span>
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Leave unchecked for tenant-wide access.</p>
        </div>

        <div className="flex gap-2 pt-2">
          <Button type="submit" size="sm" disabled={createUser.isPending}>
            {createUser.isPending ? 'Creating…' : 'Create user'}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </ScrollArea>
  )
}
