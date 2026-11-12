import { describe, it, expect } from 'vitest'
import {
  transformUsers,
  MIGRATION_BOT_EMAIL,
  MIGRATION_BOT_LEGACY_ID,
} from '../../../src/modules/data_migration/transform/users.js'

describe('transformUsers', () => {
  it('emits one user per nurse + a migration-bot user', () => {
    const out = transformUsers(
      [
        {
          'Row ID': 'RoberosePuri',
          n_FullName: 'Roberose Puri',
          n_FirstName: 'Roberose',
          n_LastName: 'Puri',
          n_BranchRef: 'HolySpirit',
        },
        {
          'Row ID': 'AppSheetAdmin',
          n_FullName: 'Appsheet Admin',
          n_FirstName: 'Appsheet',
          n_LastName: 'Admin',
          n_BranchRef: 'TestBranch',
        },
      ],
      [],
      'SVX',
    )
    expect(out).toHaveLength(2)
    const bot = out.find((u) => u.legacyAppsheetId === MIGRATION_BOT_LEGACY_ID)!
    expect(bot.email).toBe(MIGRATION_BOT_EMAIL)
    expect(bot.canLogin).toBe(false)
    expect(bot.roles).toEqual(['Branch'])
  })

  it('synthesises a migration-bot user when missing from the Nurse sheet', () => {
    const out = transformUsers(
      [{ 'Row ID': 'RoberosePuri', n_FullName: 'Roberose Puri' }],
      [],
      'SVX',
    )
    const bot = out.find((u) => u.legacyAppsheetId === MIGRATION_BOT_LEGACY_ID)
    expect(bot).toBeTruthy()
    expect(bot!.canLogin).toBe(false)
  })

  it('marks Dr. prefix as Physician', () => {
    const out = transformUsers(
      [
        {
          'Row ID': 'EyceeLacuarin',
          n_FullName: 'Dr. Eycee Lacuarin',
          n_FirstName: 'Eycee',
          n_LastName: 'Lacuarin',
        },
      ],
      [],
      'SVX',
    )
    const dr = out.find((u) => u.legacyAppsheetId === 'EyceeLacuarin')!
    expect(dr.roles).toContain('Physician')
    expect(dr.roles).not.toContain('Nurse')
  })

  it('grants TenantAdmin to AdminEmails entries', () => {
    const out = transformUsers([], [{ Email: 'surevax@gmail.com' }], 'SVX')
    const admin = out.find((u) => u.email === 'surevax@gmail.com')!
    expect(admin.roles).toContain('TenantAdmin')
  })
})
