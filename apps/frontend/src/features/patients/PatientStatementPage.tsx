import { useCallback, useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuditEvent } from '@/hooks/useAuditEvent'
import { usePatientLedger } from './accountApi'
import StatementOfAccount from './components/StatementOfAccount'

// Page shell mirrors features/transactions/TransactionReceiptPage.tsx (action
// bar, centered card, loading/not-found states), but this is an A4 statement
// of account, not an 80mm thermal receipt, so the print stylesheet and
// auto-print effect are taken from features/day-summary/DaySummaryPage.tsx
// instead of TransactionReceiptPage's 80mm @page rule. No PrintOptionsDialog
// or ESC/POS here, plain window.print() only.

export default function PatientStatementPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const asOf = searchParams.get('asOf') ?? undefined

  const {
    data: ledger,
    isLoading,
    isError,
  } = usePatientLedger(id ?? null, asOf ? { asOf } : undefined)
  const { recordPrint } = useAuditEvent()

  // Prints the on-screen statement and records the DPA print-audit trail in
  // the same action. window.print() has no success/cancel signal, so the
  // event fires at the moment print is invoked against an already-loaded
  // statement (both call sites below already gate on `ledger` being
  // present), not after some unobservable "print completed" state.
  const printStatement = useCallback(() => {
    if (ledger) {
      recordPrint({
        entityType: 'patients',
        entityId: ledger.patient.displayId,
        documentType: 'patient_statement',
      })
    }
    window.print()
  }, [ledger, recordPrint])

  // Auto-print when reached via a deep link (?print=1), e.g. a "Print
  // statement" action elsewhere in the app. Fires once per mount, after the
  // ledger has loaded, mirroring DaySummaryPage's autoPrintedRef effect.
  const autoPrintedRef = useRef(false)
  useEffect(() => {
    if (autoPrintedRef.current) return
    if (searchParams.get('print') !== '1') return
    if (isLoading || isError || !ledger) return
    autoPrintedRef.current = true
    const t = setTimeout(() => printStatement(), 350)
    return () => clearTimeout(t)
  }, [searchParams, isLoading, isError, ledger, printStatement])

  function handleBack() {
    navigate(`/patients/${id ?? ''}`)
  }

  function handlePrint() {
    printStatement()
  }

  return (
    <>
      {/* A4 print stylesheet, same shape as DaySummaryPage's: let the report
          flow off the fixed-height scroll viewport onto one or more pages
          instead of being clipped to one screenful. */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 12mm;
          }
          #main-content,
          #main-content > div,
          [data-radix-scroll-area-viewport] {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
          }
          .statement-action-bar,
          nav,
          aside,
          header {
            display: none !important;
          }
          .statement-page-wrapper {
            padding: 0 !important;
            background: #fff !important;
          }
          .statement-card-wrapper {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
          }
          * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>

      <div className="statement-page-wrapper min-h-screen bg-muted/30 flex flex-col">
        {/* Action bar, hidden on print */}
        <div className="statement-action-bar print:hidden sticky top-0 z-10 bg-background border-b border-border px-4 py-2 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to patient
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={handlePrint}
            disabled={isLoading || isError || !ledger}
            className="gap-1.5"
          >
            <Printer className="h-4 w-4" aria-hidden />
            Print
          </Button>
        </div>

        {/* Content area */}
        <div className="flex-1 flex items-start justify-center p-6">
          {isLoading && (
            <Card className="w-full max-w-sm">
              <CardContent className="p-6 space-y-3">
                <Skeleton className="h-5 w-3/4 mx-auto" />
                <Skeleton className="h-4 w-1/2 mx-auto" />
                <Skeleton className="h-4 w-2/3 mx-auto" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </CardContent>
            </Card>
          )}

          {!isLoading && (isError || !ledger) && (
            <Card className="w-full max-w-sm">
              <CardContent className="p-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">Patient statement not found.</p>
                <Button variant="outline" size="sm" onClick={handleBack}>
                  Back to patient
                </Button>
              </CardContent>
            </Card>
          )}

          {!isLoading && ledger && (
            <div className="statement-card-wrapper w-full" style={{ maxWidth: '186mm' }}>
              <Card className="w-full shadow-md">
                <CardContent className="p-4">
                  <StatementOfAccount ledger={ledger} />
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
