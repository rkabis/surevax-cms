export type AuthorityReportingFields = {
  reportedToAuthorityAt: string | null
  authorityReferenceNumber: string | null
}

/**
 * A local AEFI record is not proof of external submission. Treat it as
 * authority-reported only when the operator recorded an external reporting
 * timestamp; a reference number alone is supporting detail, not submission.
 */
export function isAuthorityReported(event: AuthorityReportingFields): boolean {
  return Boolean(event.reportedToAuthorityAt)
}

export function authorityReportingStatus(event: AuthorityReportingFields): string {
  return isAuthorityReported(event) ? 'Reported externally' : 'No external report recorded'
}
