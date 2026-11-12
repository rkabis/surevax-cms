import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Copy } from 'lucide-react'

export type UserRef = {
  id?: number
  displayId: string
  firstName: string
  lastName: string
}

export interface UserLabelProps {
  user: UserRef | null | undefined
  variant?: 'default' | 'compact'
  showCopy?: boolean
}

export function UserLabel({ user, variant = 'default', showCopy = false }: UserLabelProps) {
  if (!user) return <span className="text-muted-foreground">—</span>

  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.displayId

  if (variant === 'compact') {
    const initials = [user.firstName?.[0], user.lastName?.[0]]
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
          <p className="font-mono text-2xs text-muted-foreground">{user.displayId}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(user.displayId).catch(() => undefined)
  }

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className="text-sm">{fullName}</span>
      <Badge variant="outline" className="font-mono tabular-nums text-2xs px-1 py-0 leading-4">
        {user.displayId}
      </Badge>
      {showCopy && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
              aria-label="Copy user ID"
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
