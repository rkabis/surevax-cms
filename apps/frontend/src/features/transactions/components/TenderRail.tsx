import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCurrentShift } from '@/features/shift/api'
import { computePreviewTotals } from '../totals'
import { formatMoney } from '@/lib/format'
import { statusToFsmLabel } from '../lib'
import type { TransactionStatus } from '../api'
import { toCents, fromCents } from '@/lib/money'

export type PayMethod = 'cash' | 'card' | 'gcash' | 'split' | 'maya' | 'hmo'

type Props = {
  totals: ReturnType<typeof computePreviewTotals>
  cashierInitials: string
  /** Lifted state — parent owns method + tendered so it can build the
   *  inline payment payload at submit time. */
  method: PayMethod
  onMethodChange: (m: PayMethod) => void
  tendered: number
  onTenderedChange: (n: number) => void
  /** Split-tender summary (only meaningful when `method === 'split'`). Legs are
   *  edited in the inline Tender card; the rail shows the running tally. */
  splitAllocated?: string
  /** Absolute remaining/over amount (decimal string); sign carried by splitOverpays. */
  splitRemaining?: string
  splitOverpays?: boolean
  splitLegCount?: number
  /** Trigger the form's submit. When undefined the commit button stays disabled. */
  onCommit?: () => void
  /** Enables the commit CTA. */
  canCommit: boolean
  isSubmitting: boolean
  /** Live FSM state when the txn already exists; defaults to awaiting_payment
   *  pre-create. */
  fsmStatus?: TransactionStatus
  /**
   * Patient credit being applied to this bill (decimal string). When set, the
   * rail settles against net MINUS credit, because that is the cash the cashier
   * actually has to collect. Without this the rail showed the full total as
   * "Due" while the inline Tender card showed the post-credit remainder, and the
   * two money figures on one screen disagreed.
   */
  creditApplied?: string
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
}

export function TenderRail({
  totals,
  cashierInitials,
  method,
  onMethodChange,
  tendered,
  onTenderedChange,
  splitAllocated,
  splitRemaining,
  splitOverpays,
  splitLegCount,
  onCommit,
  canCommit,
  isSubmitting,
  fsmStatus,
  creditApplied,
}: Props) {
  // Work in integer cents throughout to avoid float drift.
  const netCents = toCents(totals.netAmount)
  // Cash still to collect once patient credit is applied. Clamped at zero: credit
  // can cover the bill entirely, and a negative "Due" is meaningless.
  const creditCents = Math.min(toCents(creditApplied), netCents)
  const dueCents = Math.max(netCents - creditCents, 0)
  const dueStr = fromCents(dueCents)
  const netAmount = dueCents / 100
  const shift = useCurrentShift()
  const drawer = shift.data?.data ?? null

  // FE-3: Do NOT auto-reset tendered when items change — that would silently
  // zero out change-due for a cashier who already typed "500" before adding
  // another line item. The cashier can tap "Exact" to auto-fill at any time.

  // `tendered` is a plain PHP-peso number from the numeric input; convert to cents for math.
  const tenderedCents = Math.round(tendered * 100)
  const changeCents = Math.max(0, tenderedCents - dueCents)
  const change = changeCents / 100
  const floatCents = drawer ? toCents(drawer.floatAmount) : 0
  const collectedCents = drawer ? toCents(drawer.collectedSoFar) : 0
  const expectedDrawerStr = fromCents(floatCents + collectedCents + tenderedCents)

  const fsmLabel = statusToFsmLabel(fsmStatus ?? 'Pending')

  function addToTendered(amount: number) {
    onTenderedChange(tendered + amount)
  }

  function setExact() {
    onTenderedChange(Number.isFinite(netAmount) ? netAmount : 0)
  }

  return (
    <div className="flex flex-col h-full w-[22.5rem] border-l border-border bg-card">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="eyebrow">Tender &middot; cashier mode</span>
          <h2 className="text-xl font-semibold mt-1 font-mono tabular-nums">
            Settle {formatMoney(dueStr)}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Keyboard-first &middot; scan-to-pull &middot; one keystroke commits.
          </p>
        </div>
        <span className="font-mono text-2xs text-muted-foreground shrink-0 mt-0.5 whitespace-nowrap">
          State &middot; {fsmLabel}
        </span>
      </div>

      {/* Body - scrollable */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Method tabs */}
        <div>
          <Tabs value={method} onValueChange={(v: string) => onMethodChange(v as PayMethod)}>
            <TabsList className="grid grid-cols-6 w-full">
              <TabsTrigger value="cash">
                Cash <kbd className="ml-1 text-xs opacity-60">1</kbd>
              </TabsTrigger>
              <TabsTrigger value="card">
                Card <kbd className="ml-1 text-xs opacity-60">2</kbd>
              </TabsTrigger>
              <TabsTrigger value="gcash">
                GCash <kbd className="ml-1 text-xs opacity-60">3</kbd>
              </TabsTrigger>
              <TabsTrigger value="maya">
                Maya <kbd className="ml-1 text-xs opacity-60">4</kbd>
              </TabsTrigger>
              <TabsTrigger value="hmo">
                HMO <kbd className="ml-1 text-xs opacity-60">5</kbd>
              </TabsTrigger>
              <TabsTrigger value="split">
                Split <kbd className="ml-1 text-xs opacity-60">6</kbd>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Tendered field — single method. For split, show the leg tally
            (legs are edited in the inline Tender card). */}
        {method === 'split' ? (
          <div className="space-y-2">
            <span className="eyebrow">Split tender · {splitLegCount ?? 0} legs</span>
            <div className="rounded-md border border-input bg-background px-3.5 py-3 space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Allocated</span>
                <span className="font-mono tabular-nums font-medium">
                  {formatMoney(splitAllocated ?? '0')}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {splitOverpays ? 'Over by' : 'Remaining'}
                </span>
                <span
                  className={`font-mono tabular-nums font-medium ${
                    splitOverpays ? 'text-destructive' : 'text-triage-ok'
                  }`}
                >
                  {formatMoney(splitRemaining ?? '0')}
                </span>
              </div>
            </div>
            <p className="text-2xs text-muted-foreground">
              Edit payment legs in the Tender panel on the left.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <span className="eyebrow">Tendered</span>
            <div className="flex items-center h-11 px-3.5 border border-input rounded-md bg-background">
              <span className="font-mono text-muted-foreground mr-1">PHP</span>
              <span className="font-mono tabular-nums text-2xl font-semibold flex-1 leading-none">
                {tendered.toLocaleString('en-PH', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <div className="flex gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => addToTendered(500)}
              >
                +&#8369;500
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => addToTendered(1000)}
              >
                +&#8369;1,000
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => addToTendered(5000)}
              >
                +&#8369;5,000
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={setExact}
              >
                Exact
              </Button>
            </div>
          </div>
        )}

        <Separator />

        {/* Totals breakdown */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex-1">Subtotal</span>
            <span className="font-mono tabular-nums">{formatMoney(totals.grossAmount)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex-1">VAT</span>
            <span className="font-mono tabular-nums">{formatMoney(totals.vatAmount)}</span>
          </div>
          {parseFloat(totals.discountAmount) > 0 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex-1">Discount</span>
              <span className="font-mono tabular-nums text-triage-ok">
                -{formatMoney(totals.discountAmount)}
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex-1">Discount</span>
              <span className="text-muted-foreground font-mono">&#8212;</span>
            </div>
          )}

          {creditCents > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex-1">Patient credit</span>
              <span className="font-mono tabular-nums text-triage-ok font-medium">
                -{formatMoney(fromCents(creditCents))}
              </span>
            </div>
          )}

          <Separator className="my-1" />

          <div className="flex items-center justify-between">
            <span className="text-base font-semibold flex-1">Due</span>
            <span className="font-mono tabular-nums text-base font-bold">
              {formatMoney(dueStr)}
            </span>
          </div>
          {method !== 'split' && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex-1">Change</span>
              <span className="font-mono tabular-nums text-triage-ok font-medium">
                {formatMoney(change)}
              </span>
            </div>
          )}
        </div>

        <Separator />

        {/* Drawer card */}
        <Card>
          <CardContent className="pt-3 pb-3 px-4 space-y-1.5">
            <span className="eyebrow">
              {drawer
                ? `Drawer · ${drawer.drawerState.toUpperCase()} since ${fmtTime(drawer.openedAt)} · ${cashierInitials}`
                : `Drawer · ${cashierInitials}`}
            </span>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Float</span>
              <span className="font-mono tabular-nums">
                {drawer ? formatMoney(drawer.floatAmount) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Collected so far</span>
              <span className="font-mono tabular-nums">
                {drawer ? formatMoney(drawer.collectedSoFar) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Expected after this</span>
              <span className="font-mono tabular-nums font-medium">
                {drawer ? formatMoney(expectedDrawerStr) : '—'}
              </span>
            </div>
            {!drawer && !shift.isLoading && (
              <p className="text-2xs text-muted-foreground pt-1">
                No open shift — clock in to track the drawer.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-border space-y-2">
        <Button
          type="button"
          variant="default"
          size="lg"
          className="w-full"
          onClick={onCommit}
          disabled={!canCommit || !onCommit || isSubmitting}
          title={
            !canCommit
              ? 'Add a patient + items before committing'
              : 'Commit the transaction with this payment'
          }
        >
          <Check className="h-4 w-4 mr-2" aria-hidden />
          {isSubmitting ? 'Committing…' : `Commit ${formatMoney(dueStr)} · unlock administer`}
          <kbd className="ml-2 text-xs opacity-70" aria-hidden>
            &#8984;&#8629;
          </kbd>
        </Button>
        <p className="text-2xs text-muted-foreground text-center">
          Single transaction &middot; payment + receipt + state + audit roll back together if any
          step fails.
        </p>
      </div>
    </div>
  )
}
