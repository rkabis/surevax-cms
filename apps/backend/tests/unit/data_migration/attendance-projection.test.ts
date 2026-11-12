import { describe, expect, it } from 'vitest'

import { projectAttendance } from '../../../src/modules/data_migration/attendanceProjection.js'
import { emptyLoadPlan } from '../../../src/modules/data_migration/targets.js'
import type { SourceBundle } from '../../../src/modules/data_migration/types.js'

describe('projectAttendance', () => {
  it('pairs TimeLog rows and collapses a matching NurseShift record', () => {
    const plan = emptyLoadPlan()
    plan.users = [
      {
        displayId: 'USR_1',
        tenantId: 'SVX',
        email: 'nurse@example.invalid',
        passwordHash: 'x',
        firstName: 'Test',
        lastName: 'Nurse',
        primaryBranchDisplayId: 'Cubao',
        canLogin: false,
        status: 'Active',
        legacyAppsheetId: 'TestNurse',
        roles: ['Nurse'],
      },
    ]
    const source: SourceBundle = {
      Patient: [],
      Immunization: [],
      Transactions: [],
      Remarks: [],
      Vaccine: [],
      Branch: [],
      Nurse: [],
      BranchReport: [],
      ImmunizationBundle: [],
      InventoryLog: [],
      CashBalanceLog: [],
      AdminEmails: [],
      Discount: [],
      ChargeAccounts: [],
      TimeLog: [
        {
          'Row ID': 'IN',
          tl_NurseRef: 'TestNurse',
          tl_BranchEmail: 'surevax.cubao@example.com',
          tl_Option: 'Time In',
          tl_Date: '2026-01-01',
          tl_Time: '08:00:00',
        },
        {
          'Row ID': 'OUT',
          tl_NurseRef: 'TestNurse',
          tl_BranchEmail: 'surevax.cubao@example.com',
          tl_Option: 'Time Out',
          tl_Date: '2026-01-01',
          tl_Time: '17:00:00',
        },
      ],
      NurseShift: [
        {
          'Row ID': 'NS',
          ns_NurseRef: 'Test Nurse',
          ns_BranchEmail: 'surevax.cubao@example.com',
          ns_Date: '2026-01-01',
          ns_TimeIn: '08:00:00',
          ns_TimeOut: '17:00:00',
        },
      ],
    }
    const result = projectAttendance({
      source,
      plan,
      tenantId: 'SVX',
      cutoffAt: new Date('2026-01-02T23:59:59+08:00'),
    })
    expect(result.staffTimeLogs).toHaveLength(1)
    expect(result.staffTimeLogs[0]).toMatchObject({
      userLegacyId: 'TestNurse',
      branchDisplayId: 'Cubao',
      totalHours: '9.00',
    })
    expect(result.counts.crossSourceDuplicatesCollapsed).toBe(1)
  })
})
