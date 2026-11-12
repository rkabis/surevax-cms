import { useState } from 'react'
import { Bluetooth, Download, Printer, Usb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { useAuditEvent } from '@/hooks/useAuditEvent'
import {
  downloadRawESCPOS,
  generateReceiptESCPOS,
  getPrintCapabilities,
  printViaBluetooth,
  printViaUSB,
  type ClinicInfo,
} from '@/lib/escpos'
import type { TransactionDetail } from '../api'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: TransactionDetail
  clinic: ClinicInfo
  // Triggers the browser print dialog on the existing AcknowledgementReceipt
  // HTML; caller owns the preview node and call site (window.print()).
  onStandardPrint: () => void
}

type Method = 'bluetooth' | 'usb' | 'download' | 'standard'

export default function PrintOptionsDialog({
  open,
  onOpenChange,
  transaction,
  clinic,
  onStandardPrint,
}: Props) {
  const [busy, setBusy] = useState<Method | null>(null)
  const caps = getPrintCapabilities()
  const { recordPrint, recordExport } = useAuditEvent()

  async function run(method: Method, fn: () => Promise<void> | void) {
    setBusy(method)
    try {
      await fn()
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error('Print failed', { description: message })
    } finally {
      setBusy(null)
    }
  }

  function handleBluetooth() {
    void run('bluetooth', async () => {
      const data = generateReceiptESCPOS(transaction, clinic)
      await printViaBluetooth(data)
      // Fires after the transport promise resolves: a real completion
      // signal, stronger than a raw click.
      recordPrint({ entityType: 'transactions', entityId: transaction.id, documentType: 'receipt' })
      toast.success('Sent to Bluetooth printer')
    })
  }

  function handleUSB() {
    void run('usb', async () => {
      const data = generateReceiptESCPOS(transaction, clinic)
      await printViaUSB(data)
      recordPrint({ entityType: 'transactions', entityId: transaction.id, documentType: 'receipt' })
      toast.success('Sent to USB printer')
    })
  }

  function handleDownload() {
    void run('download', () => {
      const data = generateReceiptESCPOS(transaction, clinic)
      downloadRawESCPOS(data, `receipt-${transaction.id}`)
      // A file saved to disk is an export, not a print.
      recordExport({
        entityType: 'transactions',
        entityId: transaction.id,
        documentType: 'receipt_escpos',
      })
      toast.success('ESC/POS file downloaded')
    })
  }

  function handleStandard() {
    void run('standard', () => {
      // window.print() gives no success/cancel signal, so we log at the
      // point of invocation against an already-produced receipt (the
      // dialog only opens once the transaction has loaded).
      recordPrint({ entityType: 'transactions', entityId: transaction.id, documentType: 'receipt' })
      onStandardPrint()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Print receipt</DialogTitle>
          <DialogDescription className="text-xs">
            Choose how to send the receipt. Options that aren't supported by this device are
            disabled.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            className="justify-start gap-2 h-9"
            disabled={!caps.bluetooth || busy !== null}
            onClick={handleBluetooth}
          >
            <Bluetooth className="h-4 w-4" aria-hidden />
            <span className="flex-1 text-left">
              Bluetooth thermal printer
              {!caps.bluetooth && (
                <span className="block text-2xs text-muted-foreground">
                  Not supported on this device
                </span>
              )}
            </span>
            {busy === 'bluetooth' && (
              <span className="text-2xs text-muted-foreground">Sending…</span>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="justify-start gap-2 h-9"
            disabled={!caps.usb || busy !== null}
            onClick={handleUSB}
          >
            <Usb className="h-4 w-4" aria-hidden />
            <span className="flex-1 text-left">
              USB thermal printer
              {!caps.usb && (
                <span className="block text-2xs text-muted-foreground">
                  Not supported on this device
                </span>
              )}
            </span>
            {busy === 'usb' && <span className="text-2xs text-muted-foreground">Sending…</span>}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="justify-start gap-2 h-9"
            disabled={busy !== null}
            onClick={handleDownload}
          >
            <Download className="h-4 w-4" aria-hidden />
            <span className="flex-1 text-left">Download ESC/POS file</span>
          </Button>

          <Button
            size="sm"
            className="justify-start gap-2 h-9"
            disabled={busy !== null}
            onClick={handleStandard}
          >
            <Printer className="h-4 w-4" aria-hidden />
            <span className="flex-1 text-left">Standard browser print</span>
          </Button>
        </div>

        <DialogFooter className="text-2xs text-muted-foreground font-mono tabular-nums">
          <span>
            BT {caps.bluetooth ? 'on' : 'off'} · USB {caps.usb ? 'on' : 'off'} · Serial{' '}
            {caps.serial ? 'on' : 'off'} · {caps.mobile ? 'mobile' : 'desktop'}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
