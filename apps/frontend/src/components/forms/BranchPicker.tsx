import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAdminBranches } from '@/features/admin/usersApi'

type Props = {
  value: string | null
  onChange: (id: string | null) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
}

/**
 * Branch picker backed by GET /api/admin/branches.
 * Renders a shadcn <Select> with branch name and code.
 */
export default function BranchPicker({
  value,
  onChange,
  placeholder = 'Select branch…',
  required,
  disabled,
}: Props) {
  const { data, isLoading } = useAdminBranches()
  const branches = data ?? []

  return (
    <Select
      value={value ?? ''}
      onValueChange={(v) => onChange(v || null)}
      required={required}
      disabled={disabled || isLoading}
    >
      <SelectTrigger aria-label="Select branch">
        <SelectValue placeholder={isLoading ? 'Loading…' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name ?? b.code}
            <span className="ml-1.5 text-xs text-muted-foreground font-mono">{b.code}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
