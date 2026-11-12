import { describe, expect, it } from 'vitest'
import { MANUAL_REMINDER_HANDOFF_COPY } from './reminderHandoff'

describe('arrival reminder handoff copy', () => {
  it('states the required manual send and makes no automation promise', () => {
    expect(MANUAL_REMINDER_HANDOFF_COPY).toContain('scan and send from a phone')
    expect(MANUAL_REMINDER_HANDOFF_COPY).toContain('nothing is sent automatically')
    expect(MANUAL_REMINDER_HANDOFF_COPY).not.toContain('will fire')
  })
})
