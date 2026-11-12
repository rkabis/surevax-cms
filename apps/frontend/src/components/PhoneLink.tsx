import { MessageSquare, Phone } from 'lucide-react'

function digitsOnly(input: string): string {
  return input.replace(/[^\d+]/g, '')
}

export function PhoneLink({
  value,
  className,
  withSms = true,
}: {
  value: string | null | undefined
  className?: string
  withSms?: boolean
}) {
  if (!value) return <span className={className}>—</span>
  const dialable = digitsOnly(value)
  const baseClass = 'font-mono tabular-nums underline-offset-2 hover:underline text-foreground'

  if (!dialable) {
    return <span className={className}>{value}</span>
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`}>
      <a href={`tel:${dialable}`} className={baseClass}>
        {value}
      </a>
      <a
        href={`tel:${dialable}`}
        aria-label={`Call ${value}`}
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        <Phone className="h-3.5 w-3.5" aria-hidden />
      </a>
      {withSms && (
        <a
          href={`sms:${dialable}`}
          aria-label={`Send SMS to ${value}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        </a>
      )}
    </span>
  )
}
