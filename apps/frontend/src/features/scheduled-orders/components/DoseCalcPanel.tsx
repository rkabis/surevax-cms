/**
 * DoseCalcPanel — weight-based immunoglobulin dose calculator UI (CLIN-1).
 *
 * Shown in AdministerDialog when the selected service has
 * `requiresDoseCalculation = true` (ERIG, HRIG, HTIG, ATS).
 *
 * The user enters patient weight (kg), the panel calls POST /api/dose-calc,
 * and displays totalIu, volumeMl, and the INF/IM split. Warnings and the
 * cappedAtMax badge are surfaced prominently. The parent dialog uses
 * `isCalcReady` to enable/disable the confirm button.
 */
import { useState, useEffect } from 'react'
import { AlertCircle, AlertTriangle, Syringe } from 'lucide-react'
import { useDoseCalc, type DoseCalcResult, ApiError } from '../api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'

export interface DoseCalcPanelProps {
  serviceCode: string
  /** Called whenever the calc state changes so the parent can gate confirm. */
  onReadyChange: (isReady: boolean, result: DoseCalcResult | null) => void
}

function parseWeight(raw: string): number | null {
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function fmt2(n: number): string {
  return n.toFixed(2)
}

export default function DoseCalcPanel({ serviceCode, onReadyChange }: DoseCalcPanelProps) {
  const [weightRaw, setWeightRaw] = useState('')
  const [calcError, setCalcError] = useState<string | null>(null)
  const calc = useDoseCalc()

  const weightKg = parseWeight(weightRaw)
  const hasWeight = weightKg !== null

  // When the mutation resolves, propagate readiness to parent.
  useEffect(() => {
    if (calc.isSuccess && calc.data) {
      onReadyChange(true, calc.data)
    } else {
      onReadyChange(false, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calc.isSuccess, calc.data])

  // Reset on service change.
  useEffect(() => {
    calc.reset()
    setWeightRaw('')
    setCalcError(null)
    onReadyChange(false, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceCode])

  function handleWeightChange(value: string) {
    setWeightRaw(value)
    // Clear prior result so we don't show stale data.
    if (calc.isSuccess || calc.isError) {
      calc.reset()
      setCalcError(null)
      onReadyChange(false, null)
    }
  }

  function handleCalculate() {
    setCalcError(null)
    calc.mutate(
      { serviceCode, weightKg },
      {
        onError: (err) => {
          if (err instanceof ApiError) {
            setCalcError(err.message)
          } else {
            setCalcError('Calculation failed. Please retry.')
          }
          onReadyChange(false, null)
        },
      },
    )
  }

  const result = calc.isSuccess ? calc.data : null

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Syringe className="h-4 w-4 text-muted-foreground" aria-hidden />
        Weight-based dose calculator
      </div>

      <Separator className="my-1" />

      {/* Weight input */}
      <div className="space-y-1.5">
        <Label htmlFor="dose-calc-weight" className="text-sm">
          Patient weight (kg) <span className="text-destructive">*</span>
        </Label>
        <div className="flex gap-2">
          <Input
            id="dose-calc-weight"
            type="number"
            min="0.1"
            max="500"
            step="0.1"
            placeholder="e.g. 60"
            value={weightRaw}
            onChange={(e) => handleWeightChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hasWeight && !calc.isPending) handleCalculate()
            }}
            className="w-36"
          />
          <button
            type="button"
            onClick={handleCalculate}
            disabled={!hasWeight || calc.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {calc.isPending ? 'Calculating…' : 'Calculate'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Required for <span className="font-mono tabular-nums">{serviceCode}</span> — dose is
          weight-based.
        </p>
      </div>

      {/* Calc error */}
      {calcError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden />
          <AlertDescription className="text-xs">{calcError}</AlertDescription>
        </Alert>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-2">
          <Separator className="my-1" />

          {/* cappedAtMax badge */}
          {result.cappedAtMax && (
            <Badge variant="destructive" className="text-xs">
              Capped at max dose
            </Badge>
          )}

          {/* Dose summary grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">Total dose</span>
            <span className="font-mono tabular-nums font-medium text-right">
              {fmt2(result.totalIu)} IU
            </span>

            <span className="text-muted-foreground">Total volume</span>
            <span className="font-mono tabular-nums font-medium text-right">
              {fmt2(result.volumeMl)} mL
            </span>

            {result.route === 'INF' && (
              <>
                <span className="text-muted-foreground">Infiltration (INF)</span>
                <span className="font-mono tabular-nums font-medium text-right">
                  {fmt2(result.infiltrationMl)} mL
                </span>

                <span className="text-muted-foreground">Intramuscular (IM)</span>
                <span className="font-mono tabular-nums font-medium text-right">
                  {fmt2(result.imMl)} mL
                </span>
              </>
            )}
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <Alert variant="default" className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
              <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
              <AlertTitle className="text-amber-800 dark:text-amber-200 text-xs font-semibold">
                Clinical notes
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 mt-1 space-y-1 text-xs text-amber-900 dark:text-amber-100">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Notes from dosing rule */}
          {result.notes && (
            <p className="text-xs text-muted-foreground leading-relaxed">{result.notes}</p>
          )}
        </div>
      )}
    </div>
  )
}
