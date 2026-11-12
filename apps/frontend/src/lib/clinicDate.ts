const CLINIC_TIME_ZONE = 'Asia/Manila'

/** Return the Asia/Manila clinic calendar date as YYYY-MM-DD. */
export function manilaCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

/** Compatibility name used by reporting and day-summary modules. */
export const clinicCalendarDateString = manilaCalendarDate
