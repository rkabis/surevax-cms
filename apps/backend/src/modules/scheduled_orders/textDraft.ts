/**
 * Manual "text patient" draft composition, R2 in
 * docs/nurse-testing-readiness.md.
 *
 * Pure, side-effect-free string logic ONLY: no DB access, no HTTP, no
 * qrcode rendering. `db.ts` (getTextDraft) is the only caller today: it
 * fetches the data, calls the functions below, then renders the QR. Kept
 * separate on purpose: the owner has explicitly deferred the automated
 * reminder pipeline (no domain-event producer, no scheduled job, no SMS
 * provider), but when that pipeline lands it should reuse this exact
 * composition logic rather than reimplementing it against a job payload.
 *
 * Deliberately OMITTED from the composed message, even though it is
 * available on the underlying records: the WHO exposure category / bite
 * indication (`clinical_orders.indication`), any diagnosis, condition, or
 * allergy, and the administering clinician's name. An SMS is an insecure
 * channel (a family member or anyone else who can see the patient's phone
 * may read it), so the body carries only what is needed to show up for a
 * dose: first name, the service/course name, the dose number of the total,
 * the due date, and (when known) the branch. Nothing clinically sensitive
 * beyond the service name itself belongs here.
 */

export type TextDraftBlockedReason = 'no_contact_number' | 'sms_opt_in_false'

export type TextDraftMessageInput = {
  patientFirstName: string
  serviceName: string
  doseNumber: number
  totalDoses: number
  /** 'YYYY-MM-DD'. */
  scheduledDate: string
  /** Null when the branch cannot be reliably determined, omitted from the message rather than left as an empty gap. */
  branchName: string | null
}

function formatDueDate(scheduledDate: string): string {
  // Append a fixed time-of-day so the Date parses in local time rather than
  // UTC midnight, otherwise a UTC-behind timezone renders the day before.
  const d = new Date(`${scheduledDate}T00:00:00`)
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

/** Composes the plain-text SMS body a nurse reviews before scanning the QR. */
export function composeTextDraftBody(input: TextDraftMessageInput): string {
  const dueDate = formatDueDate(input.scheduledDate)
  const branchPart = input.branchName ? ` at ${input.branchName}` : ''
  return (
    `Hi ${input.patientFirstName}, this is SureVax Clinic. Your ${input.serviceName} ` +
    `dose ${input.doseNumber} of ${input.totalDoses} is due on ${dueDate}${branchPart}. ` +
    `Please visit us on time. Thank you.`
  )
}

/**
 * Mask all but the last 4 digits of a phone number, for on-screen display
 * only. The raw number is never rendered as visible text; it only reaches
 * the client inside `smsUri`, exposed via a machine-readable data attribute
 * for the nurse's phone (and this test suite) to read, not a human eye.
 */
export function maskPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length <= 4) return digits
  const last4 = digits.slice(-4)
  const maskedCount = Math.max(digits.length - 4, 3)
  return `${'•'.repeat(maskedCount)}${last4}`
}

/**
 * Builds the `sms:` URI a QR code encodes. Strips the raw number to digits
 * (keeping a leading '+'), the same normalization `PhoneLink.tsx` already
 * uses for its `tel:`/`sms:` hrefs, so the URI stays a plain
 * `sms:<digits>?body=...` regardless of how the number is formatted in the
 * database (with dashes, spaces, etc). `encodeURIComponent` percent-encodes
 * spaces, newlines, and any literal `&` in the body, so the query string
 * cannot be corrupted by the message text.
 */
export function buildSmsUri(rawNumber: string, body: string): string {
  const dialable = rawNumber.replace(/[^\d+]/g, '')
  return `sms:${dialable}?body=${encodeURIComponent(body)}`
}
