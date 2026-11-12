import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet, FileBarChart, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PatientLabel } from '@/components/PatientLabel'
import { PayBalancePanel } from '@/features/transactions/components/PayBalancePanel'
import { formatMoney, formatDate } from '@/lib/format'
import type { ReceivableRow } from '@/features/transactions/api'

export interface ReceivableDetailProps {
  patientId: string
  row: ReceivableRow
  onClose: () => void
}

const BUCKET_LABEL: Record<ReceivableRow['bucket'], string> = {
  d0_30: '1 to 30 days',
  d31_60: '31 to 60 days',
  d61_90: '61 to 90 days',
  d90plus: '90+ days',
}

const BUCKET_BADGE_VARIANT: Record<ReceivableRow['bucket'], 'info' | 'due' | 'overdue'> = {
  d0_30: 'info',
  d31_60: 'due',
  d61_90: 'overdue',
  d90plus: 'overdue',
}

function AgingCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-2.5 py-2 text-center">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono tabular-nums text-sm font-medium mt-0.5">{formatMoney(value)}</p>
    </div>
  )
}

/**
 * Receivables detail rail body (PATTERNS.md Pattern 35, two-step inline
 * flow). Step `review` shows the patient's outstanding position; step `pay`
 * swaps in `PayBalancePanel` inline, never as a stacked dialog. The step
 * resets to `review` whenever a different patient row is selected, so the
 * rail never reopens mid-payment for the wrong patient.
 */
export default function ReceivableDetail({ patientId, row, onClose }: ReceivableDetailProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState<'review' | 'pay'>('review')

  useEffect(() => {
    setStep('review')
  }, [patientId])

  const patientName = [row.patient.lastName, row.patient.firstName].filter(Boolean).join(', ')

  if (step === 'pay') {
    return (
      <div className="p-6">
        <PayBalancePanel
          patientId={patientId}
          patientName={patientName}
          onClose={() => setStep('review')}
          onSuccess={onClose}
        />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PatientLabel patient={row.patient} showMrn />
        <Badge variant={BUCKET_BADGE_VARIANT[row.bucket]}>{BUCKET_LABEL[row.bucket]}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-md bg-muted px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">Outstanding</p>
          <p className="font-mono tabular-nums text-lg font-semibold">
            {formatMoney(row.grossOutstanding)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Credit available</p>
          <p className="font-mono tabular-nums text-lg font-semibold">
            {formatMoney(row.availableCredit)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Net owed</p>
          <p className="font-mono tabular-nums text-lg font-semibold">
            {formatMoney(row.netOutstanding)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Oldest bill</p>
          <p className="font-mono tabular-nums text-lg font-semibold">
            {row.oldestOpenBillAgeDays}d
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Aging breakdown</h3>
        <div className="grid grid-cols-4 gap-2">
          <AgingCell label="1-30" value={row.aging.d0_30} />
          <AgingCell label="31-60" value={row.aging.d31_60} />
          <AgingCell label="61-90" value={row.aging.d61_90} />
          <AgingCell label="90+" value={row.aging.d90plus} />
        </div>
      </div>

      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Open bills</span>
          <span className="font-mono tabular-nums font-medium">{row.openBillCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Last payment</span>
          <span>{formatDate(row.lastPaymentAt)}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" onClick={() => setStep('pay')}>
          <Wallet className="h-3.5 w-3.5 mr-1.5" aria-hidden />
          Pay balance
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/patients/${patientId}?tab=billing`)}
        >
          <UserRound className="h-3.5 w-3.5 mr-1.5" aria-hidden />
          Open patient account
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/patients/${patientId}/statement`)}
        >
          <FileBarChart className="h-3.5 w-3.5 mr-1.5" aria-hidden />
          Statement
        </Button>
      </div>
    </div>
  )
}
