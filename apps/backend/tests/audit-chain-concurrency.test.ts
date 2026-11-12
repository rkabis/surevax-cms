import { afterAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const databaseUrl = process.env['DATABASE_MIGRATOR_URL'] ?? process.env['DATABASE_URL']
if (!databaseUrl) throw new Error('DATABASE_URL is required for audit-chain concurrency tests')

const firstClient = postgres(databaseUrl, { max: 1 })
const secondClient = postgres(databaseUrl, { max: 1 })

function partitionName(date: Date): string {
  return `audit_logs_${date.getUTCFullYear()}_${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

describe('audit-chain concurrent append serialization', () => {
  afterAll(async () => {
    await Promise.all([firstClient.end(), secondClient.end()])
  })

  it('keeps one valid chain when an earlier append is uncommitted', async () => {
    const marker = `concurrency-${crypto.randomUUID()}`
    const partition = partitionName(new Date())
    // Other integration files deliberately delete their own audit fixtures.
    // Preserve that pre-existing mismatch set and prove this test adds none.
    const baselineMismatches = await firstClient<{ id: string }[]>`
      SELECT id::text AS id FROM verify_audit_chain(${partition})
       WHERE match = false
       ORDER BY id
    `

    // A BEFORE INSERT trigger runs even for a row later discarded by ON
    // CONFLICT. Exercise that path first: it must not advance the durable
    // chain head or create a phantom predecessor.
    const skipped = await firstClient<{ id: string }[]>`
      INSERT INTO audit_logs (id, tenant_id, action, entity_type, entity_id, "timestamp")
      SELECT id, tenant_id, action, entity_type, entity_id, "timestamp"
        FROM audit_logs
       ORDER BY chain_sequence DESC
       LIMIT 1
      ON CONFLICT DO NOTHING
      RETURNING id::text AS id
    `
    expect(skipped).toEqual([])

    let releaseFirstInsert!: () => void
    const firstInserted = new Promise<void>((resolve) => {
      releaseFirstInsert = resolve
    })

    const first = firstClient.begin(async (tx) => {
      await tx`
        INSERT INTO audit_logs (tenant_id, action, entity_type, entity_id, metadata)
        VALUES ('SVX', 'CONFIG_CHANGE', 'audit_chain_probe', ${`${marker}-first`},
                ${tx.json({ probe: marker, order: 1 })})
      `
      releaseFirstInsert()
      await tx`SELECT pg_sleep(0.15)`
    })

    await firstInserted
    const second = secondClient.begin(async (tx) => {
      await tx`
        INSERT INTO audit_logs (tenant_id, action, entity_type, entity_id, metadata)
        VALUES ('SVX', 'CONFIG_CHANGE', 'audit_chain_probe', ${`${marker}-second`},
                ${tx.json({ probe: marker, order: 2 })})
      `
    })

    await Promise.all([first, second])

    const mismatches = await firstClient<{ id: string }[]>`
      SELECT id::text AS id FROM verify_audit_chain(${partition})
       WHERE match = false
       ORDER BY id
    `
    expect(mismatches).toEqual(baselineMismatches)

    const appended = await firstClient<{ chain_sequence: string }[]>`
      SELECT chain_sequence::text AS chain_sequence
        FROM audit_logs
       WHERE entity_type = 'audit_chain_probe'
         AND metadata ->> 'probe' = ${marker}
       ORDER BY chain_sequence
    `
    expect(appended).toHaveLength(2)
    expect(Number(appended[1]!.chain_sequence)).toBe(Number(appended[0]!.chain_sequence) + 1)
  })
})
