import { AlertCircle, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useTextDraft, type TextDraftBlockedReason } from '../api'

export interface TextPatientDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderId: string
  patientName: string
}

const BLOCKED_REASON_COPY: Record<TextDraftBlockedReason, string> = {
  no_contact_number: 'No mobile number on file for this patient.',
  sms_opt_in_false: 'No SMS opt-in on file for this patient.',
}

/**
 * Manual "text patient" action (R2). Renders a QR the nurse scans with THEIR
 * OWN phone: scanning opens Messages prefilled with the recipient and the
 * message body, and the nurse presses send. Nothing here transits our
 * infrastructure, no provider, no spend. See
 * docs/nurse-testing-readiness.md R2 for the scope decision (manual only,
 * automation deferred).
 */
export default function TextPatientDialog({
  open,
  onOpenChange,
  orderId,
  patientName,
}: TextPatientDialogProps) {
  const { data, isLoading, isError } = useTextDraft(orderId, open)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md xl:max-w-lg">
        <DialogHeader>
          <DialogTitle>Text patient</DialogTitle>
          <DialogDescription>
            Scan this QR with your own phone to open a prefilled text message for {patientName}.
            Nothing is sent from this app.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Preparing message…
          </div>
        )}

        {isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden />
            <AlertDescription>Could not prepare the text draft. Please try again.</AlertDescription>
          </Alert>
        )}

        {data && data.blocked && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden />
            <AlertDescription>
              {data.blockedReason
                ? BLOCKED_REASON_COPY[data.blockedReason]
                : 'Cannot text this patient.'}
            </AlertDescription>
          </Alert>
        )}

        {data && !data.blocked && data.qrDataUrl && data.smsUri && (
          <div
            className="flex flex-col items-center gap-3 py-2"
            data-testid="reminder-qr"
            data-sms-uri={data.smsUri}
          >
            <img
              src={data.qrDataUrl}
              alt={`QR code to text patient, mobile ending in ${data.maskedNumber ?? '····'}`}
              className="h-48 w-48 rounded-md border border-border bg-white p-2"
            />
            {data.maskedNumber && (
              <p className="font-mono tabular-nums text-xs text-muted-foreground">
                {data.maskedNumber}
              </p>
            )}
            {data.messageBody && (
              <p className="text-center text-sm leading-snug">{data.messageBody}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
