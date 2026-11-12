import { describe, expect, it } from 'vitest'
import { humanizeRole } from '../status'

describe('humanizeRole', () => {
  it('splits PascalCase role names with a space', () => {
    expect(humanizeRole('TenantAdmin')).toBe('Tenant Admin')
    expect(humanizeRole('BranchAdmin')).toBe('Branch Admin')
    expect(humanizeRole('SuperAdmin')).toBe('Super Admin')
  })

  it('returns single-word roles unchanged', () => {
    expect(humanizeRole('Physician')).toBe('Physician')
    expect(humanizeRole('Nurse')).toBe('Nurse')
    expect(humanizeRole('Cashier')).toBe('Cashier')
    expect(humanizeRole('Branch')).toBe('Branch')
  })

  it('returns em dash for null', () => {
    expect(humanizeRole(null)).toBe('—')
  })

  it('returns em dash for undefined', () => {
    expect(humanizeRole(undefined)).toBe('—')
  })

  it('returns em dash for empty string', () => {
    expect(humanizeRole('')).toBe('—')
  })
})
