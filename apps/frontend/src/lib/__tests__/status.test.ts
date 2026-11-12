import { describe, expect, it } from 'vitest'
import {
  CLASS_DISPLAY,
  TRANSACTION_STATUS_VARIANT,
  clinicalOrderStatusVariant,
  humanizeStatus,
  recallSeverityVariant,
  statusVariant,
} from '../status'

/**
 * Status humanizer + badge-variant maps. These render on every pill/badge, and
 * the variant lookup enforces a single fallback rule ('outline'). humanizeRole
 * is covered separately in humanizeRole.test.ts.
 */

describe('humanizeStatus', () => {
  it('sentence-cases snake_case', () => {
    expect(humanizeStatus('awaiting_payment')).toBe('Awaiting payment')
    expect(humanizeStatus('result_received')).toBe('Result received')
  })

  it('splits camelCase enums and sentence-cases them', () => {
    expect(humanizeStatus('ResultReceived')).toBe('Result received')
    expect(humanizeStatus('NotRecovered')).toBe('Not recovered')
  })

  it('honours the hyphenated clinical override', () => {
    expect(humanizeStatus('LifeThreatening')).toBe('Life-threatening')
  })

  it('leaves an already-humanized single word intact', () => {
    expect(humanizeStatus('Paid')).toBe('Paid')
  })

  it('returns empty string for empty input', () => {
    expect(humanizeStatus('')).toBe('')
  })
})

describe('statusVariant', () => {
  it('maps a known status to its variant', () => {
    expect(statusVariant(TRANSACTION_STATUS_VARIANT, 'Paid')).toBe('default')
    expect(statusVariant(TRANSACTION_STATUS_VARIANT, 'Voided')).toBe('overdue')
  })

  it('falls back to outline for an unknown status', () => {
    expect(statusVariant(TRANSACTION_STATUS_VARIANT, 'Zorp')).toBe('outline')
  })
})

describe('clinicalOrderStatusVariant', () => {
  it('maps clinical-order lifecycle states', () => {
    expect(clinicalOrderStatusVariant('Missed')).toBe('overdue')
    expect(clinicalOrderStatusVariant('Refused')).toBe('overdue')
    expect(clinicalOrderStatusVariant('Scheduled')).toBe('due')
    expect(clinicalOrderStatusVariant('Completed')).toBe('ok')
    expect(clinicalOrderStatusVariant('Cancelled')).toBe('outline')
  })

  it('defaults unknown states to info', () => {
    expect(clinicalOrderStatusVariant('Whatever')).toBe('info')
  })
})

describe('recall severity display', () => {
  it('maps FDA class to Roman-numeral label + variant', () => {
    expect(CLASS_DISPLAY['Class1']).toBe('Class I')
    expect(recallSeverityVariant('Class1')).toBe('destructive')
    expect(recallSeverityVariant('Class3')).toBe('due')
    expect(recallSeverityVariant('unknown')).toBe('outline')
  })
})
