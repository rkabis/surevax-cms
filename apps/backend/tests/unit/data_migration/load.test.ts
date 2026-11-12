import { describe, it, expect } from 'vitest'
import { load } from '../../../src/modules/data_migration/load.js'
import { createMemoryAdapter } from '../../../src/modules/data_migration/adapter.js'
import { type LoadPlan, emptyLoadPlan } from '../../../src/modules/data_migration/targets.js'
import type { MigrationContext } from '../../../src/modules/data_migration/types.js'
import type { MigrationRunStatus } from '../../../src/modules/data_migration/migrationLedger.js'

function ctx(overrides: Partial<MigrationContext> = {}): MigrationContext {
  return {
    tenantId: 'SVX',
    platformUserId: 1,
    cutoverAt: new Date('2026-08-17T00:00:00.000Z'),
    dryRun: false,
    batchSize: 100,
    log: () => {},
    ...overrides,
  }
}

function mkPlan(): LoadPlan {
  const plan = emptyLoadPlan()
  plan.branches = [
    {
      displayId: 'SVX.HST',
      tenantId: 'SVX',
      code: 'HST',
      name: 'Holy Spirit',
      address: null,
      email: null,
      isActive: true,
      legacyAppsheetId: 'HolySpirit',
    },
  ]
  plan.users = [
    {
      displayId: 'USR_MIGRATION',
      tenantId: 'SVX',
      email: 'migration-bot@surevax.internal',
      passwordHash: 'h',
      firstName: 'Migration',
      lastName: 'Bot',
      primaryBranchDisplayId: null,
      canLogin: false,
      status: 'Active',
      legacyAppsheetId: 'AppSheetAdmin',
      roles: ['Branch'],
    },
    {
      displayId: 'USR_X',
      tenantId: 'SVX',
      email: 'a@b.com',
      passwordHash: 'h',
      firstName: 'A',
      lastName: 'B',
      primaryBranchDisplayId: 'HolySpirit',
      canLogin: true,
      status: 'Active',
      legacyAppsheetId: 'NurseA',
      roles: ['Nurse'],
    },
  ]
  plan.products = [
    {
      displayId: 'PRD_X',
      tenantId: 'SVX',
      name: 'Abhayrab',
      manufacturer: 'Abhayrab',
      defaultRoute: 'ID',
      vialVolumeMl: null,
      isActive: true,
      legacyAppsheetId: 'Abhayrab',
    },
  ]
  plan.services = [
    {
      id: 'ARVPEP_ID',
      tenantId: 'SVX',
      code: 'ARVPEP_ID',
      name: 'ARV PEP (ID)',
      serviceType: 'Vaccine',
      defaultRoute: 'ID',
      defaultDoseVolumeMl: '0.20',
      isVatExempt: false,
      requiresStock: true,
      isActive: true,
      legacyAppsheetId: 'ARVPEP_AbhayrabID',
    },
  ]
  plan.patients = [
    {
      displayId: 'PAT_X',
      tenantId: 'SVX',
      mrnSeq: 1,
      homeBranchDisplayId: 'HolySpirit',
      firstName: 'Cataleya',
      lastName: 'Hulguin',
      middleName: null,
      dateOfBirth: '2015-01-02',
      sex: 'Female',
      contactNumber: null,
      email: null,
      address: null,
      onboardingData: {},
      isActive: true,
      createdAt: new Date('2024-07-29'),
      legacyAppsheetId: 'PAT-CATA',
    },
  ]
  return plan
}

describe('load (memory adapter)', () => {
  it('inserts branches, users, products, services, patients in dependency order', async () => {
    const adapter = createMemoryAdapter()
    await load(mkPlan(), adapter, ctx())
    const order = adapter.recorded.map((r) => r.table)
    expect(order.indexOf('branches')).toBeLessThan(order.indexOf('users'))
    expect(order.indexOf('branches')).toBeLessThan(order.indexOf('patients'))
    expect(order.indexOf('products')).toBeLessThan(order.indexOf('service_catalog'))
    expect(adapter.byTable.patients).toHaveLength(1)
  })

  it('is idempotent — re-running with the same adapter inserts 0 net rows', async () => {
    const adapter = createMemoryAdapter()
    const r1 = await load(mkPlan(), adapter, ctx())
    const r2 = await load(mkPlan(), adapter, ctx())
    expect(r1.inserted.patients).toBe(1)
    expect(r2.inserted.patients).toBe(0)
    expect(r2.skipped.patients).toBe(1)
  })

  it('creates the approved migration-only consent after its patient', async () => {
    const adapter = createMemoryAdapter()
    await load(mkPlan(), adapter, ctx())
    const patientStage = adapter.recorded.findIndex((entry) => entry.table === 'patients')
    const consentStage = adapter.recorded.findIndex((entry) => entry.table === 'consents')
    expect(consentStage).toBeGreaterThan(patientStage)
    expect(adapter.byTable.consents).toHaveLength(1)
  })

  it('dry-run skips the adapter but still assigns ids for resolution', async () => {
    const adapter = createMemoryAdapter()
    const r = await load(mkPlan(), adapter, ctx({ dryRun: true }))
    expect(adapter.recorded).toHaveLength(0)
    expect(r.inserted.patients).toBe(1)
  })

  it('respects batchSize — splits big inputs into multiple insertBatch calls', async () => {
    const plan = emptyLoadPlan()
    plan.branches = Array.from({ length: 25 }, (_, i) => ({
      displayId: `SVX.B${String(i).padStart(2, '0')}`,
      tenantId: 'SVX',
      code: `B${String(i).padStart(2, '0').slice(0, 2)}` as string,
      name: `Branch ${i}`,
      address: null,
      email: null,
      isActive: true,
      legacyAppsheetId: `branch_${i}`,
    }))
    const adapter = createMemoryAdapter()
    await load(plan, adapter, ctx({ batchSize: 10 }))
    const branchCalls = adapter.recorded.filter((r) => r.table === 'branches')
    expect(branchCalls).toHaveLength(3) // 10 + 10 + 5
    expect(adapter.byTable.branches).toHaveLength(25)
  })

  it('records the controlled migration lifecycle around a ledger-backed load', async () => {
    const adapter = createMemoryAdapter()
    const statuses: MigrationRunStatus[] = []
    adapter.startMigrationRun = async (run) => ({ ...run, id: 'MRUN_TEST', resumed: false })
    adapter.recordMigrationStatus = async (status) => {
      statuses.push(status)
    }

    await load(mkPlan(), adapter, ctx(), {
      run: {
        tenantId: 'SVX',
        mode: 'Baseline',
        sourcePackHash: 'a'.repeat(64),
        cutoffAt: new Date('2026-08-17T15:59:59.999Z'),
        importerVersion: 'test-v1',
      },
    })

    expect(statuses).toEqual(['Validated', 'Applying', 'Completed'])
  })
})
