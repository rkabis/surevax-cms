/**
 * Philippine-specific field validation for patient-facing forms.
 *
 * Every rule here is calibrated against the clinic's real data, not a generic
 * regex library. Profiling all 15,143 patient rows in the AppSheet export
 * (`Patient` sheet) turned up four failure modes worth catching at the keyboard,
 * while the nurse still has the patient in front of them:
 *
 *  - 87.0% of contact numbers are a clean `09XXXXXXXXX`. Another 4.6% lost their
 *    leading zero to Sheets treating the cell as a number (`9950141138.0`), and
 *    0.1% arrive as `+639…`. All three are the SAME number, so they normalise
 *    rather than error.
 *  - 4.3% pack two numbers into one field (`0917… / 0922…`). That cannot be
 *    normalised: it needs the nurse to say which one is the patient's, so it
 *    gets its own message instead of a generic "invalid".
 *  - 4.0% are landlines or too short. A landline is not wrong to record, but it
 *    cannot receive the SMS dose reminder, so the message says that.
 *  - 62.3% of email addresses are the literal string "n/a", because AppSheet made
 *    the field required and nurses had to type something. Only 34.5% are real.
 *    So: email is genuinely optional here, and a placeholder is REJECTED with a
 *    nudge to leave it blank: otherwise v2 inherits 9,000 fake addresses.
 */

import { z } from 'zod'

/** Placeholders nurses type when a field refuses to be empty. */
const PLACEHOLDERS = new Set([
  'n/a',
  'na',
  'n.a.',
  'none',
  'nil',
  'no email',
  'noemail',
  'wala',
  '-',
  '--',
  '.',
  'x',
  'xx',
  'xxx',
  'tbd',
  'unknown',
])

export function isPlaceholder(raw: string): boolean {
  return PLACEHOLDERS.has(raw.trim().toLowerCase())
}

/**
 * Normalise a PH mobile number to canonical `09XXXXXXXXX`, or return null when
 * it is not recoverable. Handles the three equivalent spellings in the export
 * plus the spreadsheet float artefact, and tolerates spaces, dashes, and
 * parentheses.
 */
export function normalizePhMobile(raw: string): string | null {
  let s = raw.trim()
  if (s === '') return null

  // Sheets stored some numbers as floats: "9950141138.0".
  s = s.replace(/\.0+$/, '')
  // Punctuation humans add: "0917-123-4567", "(0917) 123 4567".
  s = s.replace(/[\s()\-.]/g, '')

  if (s.startsWith('+63')) s = '0' + s.slice(3)
  else if (s.startsWith('63') && s.length === 12) s = '0' + s.slice(2)
  // Leading zero lost to numeric coercion: "9171234567".
  else if (/^9\d{9}$/.test(s)) s = '0' + s

  return /^09\d{9}$/.test(s) ? s : null
}

/** True when the field holds more than one number (slash, comma, "or", "/"). */
function looksLikeMultipleNumbers(raw: string): boolean {
  return /[/,;]|\bor\b|\band\b/i.test(raw) && (raw.match(/\d/g) ?? []).length > 10
}

const MOBILE_INVALID = 'Enter an 11-digit mobile number starting 09, e.g. 09171234567.'
const MOBILE_MULTIPLE =
  'Enter one number only. Put the second number in the emergency contact instead.'
const MOBILE_NOT_MOBILE =
  'This is not a mobile number, so the patient cannot get SMS dose reminders. Enter an 09 number, or leave blank.'

/**
 * Optional PH mobile. Empty passes; a placeholder or an unrecoverable value
 * fails with a message that names the actual problem.
 *
 * Does NOT transform: `.transform()` in a form schema fights react-hook-form's
 * controlled inputs (the field would rewrite itself mid-typing). Normalise on
 * blur in the component with `normalizePhMobile` instead.
 */
export const phMobileOptional = z
  .string()
  .max(30)
  .optional()
  .superRefine((val, ctx) => {
    if (val === undefined || val.trim() === '') return
    if (isPlaceholder(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Leave this blank instead of typing a placeholder.',
      })
      return
    }
    if (looksLikeMultipleNumbers(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: MOBILE_MULTIPLE })
      return
    }
    if (normalizePhMobile(val) !== null) return

    const digits = (val.match(/\d/g) ?? []).length
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      // 7-9 digits is a Metro Manila landline, which is a real number the nurse
      // may legitimately have; 11 wrong digits is a typo.
      message: digits >= 7 && digits <= 9 ? MOBILE_NOT_MOBILE : MOBILE_INVALID,
    })
  })

/**
 * Optional email. Rejects placeholders explicitly: the single most valuable rule
 * here, since two thirds of the legacy column is the word "n/a".
 */
export const emailOptional = z
  .string()
  .max(255)
  .optional()
  .superRefine((val, ctx) => {
    if (val === undefined || val.trim() === '') return
    const trimmed = val.trim()
    if (isPlaceholder(trimmed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Leave this blank if there is no email. Do not type "n/a".',
      })
      return
    }
    if (!z.string().email().safeParse(trimmed).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid email, e.g. maria@example.com, or leave blank.',
      })
    }
  })

/**
 * Optional date of birth. Rejects the future and implausible ages: both are
 * typos (a mistyped year is the common one), and a wrong birth date silently
 * changes weight-based dosing eligibility and the senior-citizen discount.
 */
export const dateOfBirthOptional = z
  .string()
  .optional()
  .superRefine((val, ctx) => {
    if (val === undefined || val.trim() === '') return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use the date picker (YYYY-MM-DD).' })
      return
    }
    const dob = new Date(`${val}T00:00:00`)
    if (Number.isNaN(dob.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That is not a real date.' })
      return
    }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (dob > today) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Birth date cannot be in the future: check the year.',
      })
      return
    }
    const years = (today.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    if (years > 120) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'That would make the patient over 120: check the year.',
      })
    }
  })

/**
 * Digits in a name field are almost always a number that belongs somewhere else
 * (a contact number pasted into the surname, an MRN in the first name): both
 * appear in the legacy data.
 *
 * Split into a required and an optional variant rather than taking a boolean,
 * so each keeps its own inferred type: a single helper returning
 * `string | undefined` would make every required name field optional to
 * TypeScript, which is exactly the check worth keeping.
 */
const NO_DIGITS = 'Names should not contain numbers.'

export function personNameRequired(max: number) {
  return z
    .string()
    .min(1, 'Required')
    .max(max)
    .refine((v) => !/\d/.test(v), NO_DIGITS)
}

export function personNameOptional(max: number) {
  return z
    .string()
    .max(max)
    .optional()
    .refine((v) => v === undefined || !/\d/.test(v), NO_DIGITS)
}
