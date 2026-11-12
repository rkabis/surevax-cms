import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useTransaction } from './api'
import { useAuth } from '@/features/auth/context'
import AcknowledgementReceipt from './components/AcknowledgementReceipt'
import PrintOptionsDialog from './components/PrintOptionsDialog'
import { buildClinicInfo } from './receiptClinic'

export default function TransactionReceiptPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()

  const { data: txn, isLoading, isError } = useTransaction(id ?? null)
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false)

  // Receipt header values come from the transaction's branch (the branch of
  // sale), falling back to the signed-in user's primary branch, then the
  // SureVax brand. See buildClinicInfo.
  const clinic = buildClinicInfo(txn, user)

  function handlePrint() {
    setPrintOptionsOpen(true)
  }

  function handleBack() {
    // Re-open the detail sheet by passing the id as `selected` query param,
    // which TransactionsPage picks up in its useEffect and sets selectedId.
    navigate(`/transactions?selected=${id}`)
  }

  return (
    <>
      {/* Print-specific page CSS — only active inside @media print */}
      <style>{`
        @media print {
          @page {
            size: 80mm auto;
            margin: 4mm;
          }
          * {
            color: #000 !important;
            background: #fff !important;
          }
          .receipt-action-bar,
          nav,
          aside,
          header {
            display: none !important;
          }
          .receipt-page-wrapper {
            padding: 0 !important;
            background: #fff !important;
          }
          .receipt-card-wrapper {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
          }
        }
      `}</style>

      {/*
        `h-full`, not `min-h-screen`: AppShell already constrains this route to
        `100vh − topbar − banners` inside an `overflow-hidden` container, so a
        100vh child overflowed it with no way to scroll — measured at
        2560×1440, receipt content reached 1517px in a 1440px viewport with
        `document.scrollingElement.scrollHeight === clientHeight`, i.e. 77px of
        the receipt was unreachable. `print:min-h-0` keeps the print layout
        free of the screen height constraint.
      */}
      <div className="receipt-page-wrapper h-full print:min-h-0 bg-muted/30 flex flex-col">
        {/* Action bar — hidden on print */}
        <div className="receipt-action-bar print:hidden sticky top-0 z-10 bg-background border-b border-border px-4 py-2 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to transaction
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={handlePrint}
            disabled={isLoading || isError || !txn}
            className="gap-1.5"
          >
            <Printer className="h-4 w-4" aria-hidden />
            Print
          </Button>
        </div>

        {/* Content area — scrolls on screen so a long receipt is fully reachable. */}
        <div className="flex-1 min-h-0 overflow-y-auto print:overflow-visible flex items-start justify-center p-6">
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

          {!isLoading && (isError || !txn) && (
            <Card className="w-full max-w-sm">
              <CardContent className="p-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">Transaction not found.</p>
                <Button variant="outline" size="sm" onClick={handleBack}>
                  Back to transactions
                </Button>
              </CardContent>
            </Card>
          )}

          {!isLoading && txn && (
            <div className="receipt-card-wrapper">
              <Card className="w-full shadow-md">
                <CardContent className="p-4">
                  <AcknowledgementReceipt transaction={txn} clinic={clinic} />
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      {txn && (
        <PrintOptionsDialog
          open={printOptionsOpen}
          onOpenChange={setPrintOptionsOpen}
          transaction={txn}
          clinic={clinic}
          onStandardPrint={() => window.print()}
        />
      )}
    </>
  )
}
