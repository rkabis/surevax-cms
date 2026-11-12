/**
 * AcronymHint — render an acronym with a hover/focus tooltip explaining it.
 *
 * Clinic staff and cashiers are the primary users; many domain acronyms
 * (BIR, OSCA, PWD, FEFO, PEP, ABTC) come from PH regulation / clinical
 * shorthand. Wrapping the acronym in a dotted-underline tooltip surfaces
 * the expansion without bloating the visible label.
 *
 * Usage:
 *   <AcronymHint term="FEFO">FEFO</AcronymHint>
 *   <AcronymHint term="BIR" label="BIR-compliant">BIR-compliant</AcronymHint>
 *
 * The `term` prop is the lookup key into `ACRONYMS`. If the term isn't in
 * the registry, the children render with no tooltip — fail-quiet, no
 * runtime error.
 */

import * as React from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const ACRONYMS: Record<string, string> = {
  BIR: 'Bureau of Internal Revenue — Philippine tax authority. POS receipts and discount fields must follow BIR formatting rules.',
  OSCA: 'Office of the Senior Citizens Affairs — issues the Senior Citizen ID required to claim the 20% senior-citizen discount.',
  PWD: 'Person With Disability — entitled to 20% statutory discount (RA 10754). Requires a valid PWD ID at point of sale.',
  'SC/PWD':
    'Senior Citizen / Person With Disability — two statutory discount classes, each 20% off pre-VAT, mutually exclusive per transaction.',
  FEFO: 'First-Expired-First-Out — the stock-rotation convention. Lots closest to expiry are listed and suggested first to minimise waste; the nurse still picks the brand when administering.',
  PEP: 'Post-Exposure Prophylaxis — the vaccine schedule (and RIG when indicated) administered after a potential rabies exposure.',
  FAT: 'Fluorescent Antibody Test — the gold-standard laboratory test to confirm rabies virus infection in animal brain tissue. Required when an animal dies or is killed during the 14-day observation period.',
  VIS: 'Vaccine Information Statement — a standardised patient education sheet provided before each vaccine dose, as required by the National Childhood Vaccine Injury Act.',
}

type Props = {
  term: keyof typeof ACRONYMS | (string & {})
  children: React.ReactNode
  className?: string
  /** Override the registry description; useful for context-specific copy. */
  description?: string
}

/**
 * Wraps `children` in a dotted-underline span with a tooltip. If the term
 * is unknown and no description is provided, renders children plain.
 */
export function AcronymHint({ term, children, className, description }: Props) {
  const copy = description ?? ACRONYMS[term as string]
  if (!copy) return <>{children}</>
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              'underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 cursor-help',
              className,
            )}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          {copy}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
