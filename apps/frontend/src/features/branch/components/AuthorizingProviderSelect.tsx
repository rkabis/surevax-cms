import { useBranchPhysicians } from '../api'

type Props = {
  value: string | null
  onChange: (value: string | null) => void
  required?: boolean
  disabled?: boolean
  id?: string
}

/** Dropdown of physicians at the caller's branch — used by Branch/Nurse
 *  sessions to record who authorized a physician-required action.
 *  Metadata-only: does not re-authenticate the chosen physician. */
export default function AuthorizingProviderSelect({
  value,
  onChange,
  required,
  disabled,
  id,
}: Props) {
  const { data, isLoading } = useBranchPhysicians()
  const physicians = data ?? []

  return (
    <select
      id={id}
      className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      required={required}
      disabled={disabled || isLoading}
      aria-label="Authorized by"
    >
      <option value="">{isLoading ? 'Loading…' : 'Select physician…'}</option>
      {physicians.map((p) => (
        <option key={p.id} value={p.id}>
          {`Dr. ${`${p.firstName} ${p.lastName}`.replace(/^dr\.?\s+/i, '')}${
            p.licenseNumber ? ` (${p.licenseNumber})` : ''
          }`}
        </option>
      ))}
    </select>
  )
}
