import { describe, expect, it } from 'vitest'
import { authorityReportingStatus, isAuthorityReported } from './authorityReporting'

describe('AEFI authority reporting semantics', () => {
  it('does not treat a local or resolved case as externally reported without a timestamp', () => {
    const localOnly = {
      reportedToAuthorityAt: null,
      authorityReferenceNumber: null,
    }

    expect(isAuthorityReported(localOnly)).toBe(false)
    expect(authorityReportingStatus(localOnly)).toBe('No external report recorded')
  })

  it('requires the external reporting timestamp rather than a reference alone', () => {
    expect(
      isAuthorityReported({
        reportedToAuthorityAt: null,
        authorityReferenceNumber: 'FDA-AEFI-DRAFT-42',
      }),
    ).toBe(false)

    const externallyReported = {
      reportedToAuthorityAt: '2026-08-23T03:00:00.000Z',
      authorityReferenceNumber: 'FDA-AEFI-2026-0042',
    }
    expect(isAuthorityReported(externallyReported)).toBe(true)
    expect(authorityReportingStatus(externallyReported)).toBe('Reported externally')
  })
})
