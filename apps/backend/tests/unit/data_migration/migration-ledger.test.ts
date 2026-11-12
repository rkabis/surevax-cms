import { describe, expect, it } from 'vitest'
import {
  __testing__,
  canonicalEventVersionHash,
  deterministicMigrationRunId,
  targetLinkIdempotencyKey,
} from '../../../src/modules/data_migration/migrationLedger.js'

const SOURCE_PACK_HASH = 'a'.repeat(64)

describe('migration ledger identities', () => {
  it('gives the exact frozen source pack one stable resumable run identity', () => {
    const base = {
      tenantId: 'SVX',
      mode: 'Baseline' as const,
      sourcePackHash: SOURCE_PACK_HASH,
      cutoffAt: new Date('2026-08-17T15:59:59.999Z'),
      importerVersion: 'appsheet-v1',
    }
    expect(deterministicMigrationRunId(base)).toBe(deterministicMigrationRunId({ ...base }))
    expect(deterministicMigrationRunId(base)).not.toBe(
      deterministicMigrationRunId({
        ...base,
        sourcePackHash: 'b'.repeat(64),
      }),
    )
  })

  it('hashes a canonical fact independently of object-key order or retry target', () => {
    const common = {
      canonicalEventKey: 'dose:PAT-1:ARV:1',
      eventType: 'local_administration',
      disposition: 'SafeWrite' as const,
      ruleVersion: 'reconciliation-v1',
    }
    const left = canonicalEventVersionHash({
      ...common,
      facts: {
        source: { rowHash: 'c'.repeat(64), rowId: 'IMM-1' },
        administeredAt: '2026-01-01T08:00:00+08:00',
      },
    })
    const right = canonicalEventVersionHash({
      ...common,
      facts: {
        administeredAt: '2026-01-01T08:00:00+08:00',
        source: { rowId: 'IMM-1', rowHash: 'c'.repeat(64) },
      },
    })
    expect(left).toBe(right)
    expect(
      targetLinkIdempotencyKey(left, {
        targetTable: 'clinical_orders',
        targetDisplayId: 'CO_1',
        mutationKind: 'Insert',
      }),
    ).not.toBe(
      targetLinkIdempotencyKey(left, {
        targetTable: 'clinical_orders',
        targetDisplayId: 'CO_2',
        mutationKind: 'Insert',
      }),
    )
  })

  it('rejects a mutable/non-JSON fact instead of silently changing its identity', () => {
    expect(() => __testing__.stableJson({ amount: Number.NaN })).toThrow('non-finite')
    expect(() => __testing__.stableJson({ value: BigInt(1) })).toThrow('bigint')
    expect(() => __testing__.stableJson({ when: new Date() })).toThrow('plain JSON')
    expect(() => __testing__.stableJson({ sourceRow: undefined })).toThrow('undefined')
  })
})
