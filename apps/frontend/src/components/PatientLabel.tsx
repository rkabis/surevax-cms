import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Copy } from 'lucide-react'

export type PatientRef = {
  id?: number
  displayId: string
  firstName: string
  lastName: string
  mrn?: string | null
}

export interface PatientLabelProps {
  patient: PatientRef | null | undefined
  variant?: 'default' | 'compact'
  /** When true, show MRN badge instead of displayId (default: true) */
  showMrn?: boolean
  showCopy?: boolean
}

export function PatientLabel({
  patient,
  variant = 'default',
  showMrn = true,
  showCopy = false,
}: PatientLabelProps) {
  if (!patient) return <span className="text-muted-foreground">—</span>

  const fullName =
    [patient.lastName, patient.firstName].filter(Boolean).join(', ').trim() || patient.displayId

  const badgeText = showMrn && patient.mrn ? patient.mrn : patient.displayId

  if (variant === 'compact') {
    const initials = [patient.firstName?.[0], patient.lastName?.[0]]
      .filter(Boolean)
      .join('')
      .toUpperCase()
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-muted text-muted-foreground text-xs font-medium select-none cursor-default">
            {initials || '?'}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{fullName}</p>
          <p className="font-mono text-2xs text-muted-foreground">{badgeText}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(badgeText).catch(() => undefined)
  }

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className="text-sm">{fullName}</span>
      <Badge variant="outline" className="font-mono tabular-nums text-2xs px-1 py-0 leading-4">
        {badgeText}
      </Badge>
      {showCopy && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
              aria-label="Copy patient ID"
            >
              <Copy className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy ID</TooltipContent>
        </Tooltip>
      )}
    </span>
  )
}
