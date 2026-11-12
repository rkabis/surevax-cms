import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'
import { apiErrorMessage } from '@/lib/apiErrors'
import { toast } from '@/components/ui/toast'

/**
 * Shared DPA print/export audit trail: `POST /api/audit/print-event` and
 * `POST /api/audit/export-event`. Records who produced a printable or
 * exportable document containing PHI, so a compliance review can answer
 * "who printed / exported this record".
 *
 * `entityType` is the audited table name (snake_case, e.g. `'transactions'`,
 * `'patients'`, `'day_summary'`). `entityId` is that row's display id. Never
 * pass clinical detail here beyond identifiers: the point is who touched
 * which record, not what it said.
 *
 * ## When to call it
 *
 * `window.print()` returns no signal for "the user actually printed" vs.
 * "cancelled the OS print dialog": there is nothing to await. So for a
 * `window.print()`-driven surface, call `recordPrint` at the moment the
 * print action is invoked, gated on the document having already loaded
 * successfully (the same gate that already disables the Print button on a
 * loading/error state). The log means "print was initiated against a
 * produced document," which is the strongest signal a browser gives us,
 * accepting that a cancelled OS dialog still logs a row is the correct
 * trade-off against never logging real usage while waiting for a
 * confirmation that will never arrive.
 *
 * Where a real completion signal exists (e.g. the ESC/POS Bluetooth/USB
 * transports, which resolve or reject a promise), call `recordPrint` /
 * `recordExport` from the success path instead, that is strictly more
 * accurate than a raw click.
 *
 * ## Failure handling
 *
 * Both mutations are fire-and-forget and non-blocking by design: a failed
 * audit write must never stop a receipt, statement, or day-summary report
 * from actually printing or exporting. The document is often needed right
 * now for a patient standing at the counter; punishing them for a logging
 * infrastructure hiccup is worse than the alternative. The failure is not
 * silently swallowed, though: a toast tells the operator the trail wasn't
 * recorded, so a real outage is visible instead of invisibly losing
 * compliance history.
 */
export type AuditEventInput = {
  entityType: string
  entityId: string
  documentType: string
}

type AuditEventKind = 'print' | 'export'

function postAuditEvent(kind: AuditEventKind, input: AuditEventInput) {
  return apiFetch<{ ok: boolean }>(`/api/audit/${kind}-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function useAuditEvent() {
  const printMutation = useMutation<{ ok: boolean }, unknown, AuditEventInput>({
    mutationFn: (input) => postAuditEvent('print', input),
    onError: (err) => {
      toast.warning('Print not logged', {
        description: `The compliance audit trail was not recorded: ${apiErrorMessage(err)}`,
      })
    },
  })

  const exportMutation = useMutation<{ ok: boolean }, unknown, AuditEventInput>({
    mutationFn: (input) => postAuditEvent('export', input),
    onError: (err) => {
      toast.warning('Export not logged', {
        description: `The compliance audit trail was not recorded: ${apiErrorMessage(err)}`,
      })
    },
  })

  return {
    /** Fire-and-forget: never await, never blocks the actual print. */
    recordPrint: (input: AuditEventInput) => {
      printMutation.mutate(input)
    },
    /** Fire-and-forget: never await, never blocks the actual export. */
    recordExport: (input: AuditEventInput) => {
      exportMutation.mutate(input)
    },
  }
}
