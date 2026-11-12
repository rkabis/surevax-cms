/**
 * Read-only target database readiness probe for the AppSheet migration.
 *
 * It deliberately uses DATABASE_URL (the RLS-constrained app role), never
 * DATABASE_MIGRATOR_URL, and prints no connection strings or row-level data.
 * Usage: MIGRATION_PREFLIGHT_TENANT_ID=SVX pnpm --filter @surevax/backend migration:preflight
 */
import { createHash } from 'node:crypto'
import 'dotenv/config'
import postgres from 'postgres'

const databaseUrl = process.env['DATABASE_URL']
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const tenantId =
  process.env['MIGRATION_PREFLIGHT_TENANT_ID'] ?? process.env['PHASE_1_TENANT_ID'] ?? null

const requiredRelations = [
  'public.audit_logs',
  'public.cash_deposits',
  'public.clinical_orders',
  'public.consents',
  'public.patients',
  'public.transactions',
  'migration.runs',
  'migration.source_snapshots',
  'migration.observations',
  'migration.canonical_events',
  'migration.target_links',
  'migration.exceptions',
  'migration.sync_checkpoints',
] as const

const client = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: () => {},
})

try {
  const report = await client.begin(async (tx) => {
    await tx.unsafe('SET TRANSACTION READ ONLY')

    const [identity] = await tx<
      {
        database_name: string
        database_user: string
        server_address: string | null
        server_port: number | null
        server_version: string
        transaction_read_only: string
      }[]
    >`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        inet_server_addr()::text AS server_address,
        inet_server_port() AS server_port,
        current_setting('server_version') AS server_version,
        current_setting('transaction_read_only') AS transaction_read_only
    `
    if (!identity) throw new Error('database identity query returned no row')

    const [role] = await tx<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      SELECT rolbypassrls, rolsuper
      FROM pg_roles
      WHERE rolname = current_user
    `

    const relationRows = await tx<{ relation_name: string; present: boolean }[]>`
      SELECT requested.relation_name,
             to_regclass(requested.relation_name) IS NOT NULL AS present
      FROM unnest(${requiredRelations as unknown as string[]}::text[]) AS requested(relation_name)
      ORDER BY requested.relation_name
    `
    const relations = Object.fromEntries(
      relationRows.map((row) => [row.relation_name, row.present]),
    )

    const [journal] = await tx<{ present: boolean }[]>`
      SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present
    `

    const animalOutcomeRows = await tx<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'animal_outcome'
      ORDER BY e.enumsortorder
    `
    const animalOutcomes = animalOutcomeRows.map((row) => row.enumlabel)

    let tenantCounts: Record<string, number> | null = null
    if (tenantId) {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`
      await tx`SELECT set_config('app.current_user_id', '0', true)`
      await tx`SELECT set_config('app.cross_branch_read', 'true', true)`
      const [counts] = await tx<
        {
          patients: string
          transactions: string
          clinical_orders: string
          consents: string
        }[]
      >`
        SELECT
          (SELECT count(*)::text FROM patients WHERE tenant_id = ${tenantId}) AS patients,
          (SELECT count(*)::text FROM transactions WHERE tenant_id = ${tenantId}) AS transactions,
          (SELECT count(*)::text FROM clinical_orders WHERE tenant_id = ${tenantId}) AS clinical_orders,
          (SELECT count(*)::text FROM consents WHERE tenant_id = ${tenantId}) AS consents
      `
      if (counts) {
        tenantCounts = {
          patients: Number(counts.patients),
          transactions: Number(counts.transactions),
          clinicalOrders: Number(counts.clinical_orders),
          consents: Number(counts.consents),
        }
      }
    }

    const fingerprint = createHash('sha256')
      .update(
        [
          identity.database_name,
          identity.database_user,
          identity.server_address ?? 'local-socket',
          String(identity.server_port ?? 'unknown-port'),
        ].join('|'),
      )
      .digest('hex')

    const blockers: string[] = []
    if (identity.transaction_read_only !== 'on')
      blockers.push('preflight transaction is not read-only')
    if (role?.rolsuper) blockers.push('DATABASE_URL uses a superuser role')
    if (role?.rolbypassrls) blockers.push('DATABASE_URL role bypasses RLS')
    for (const relation of requiredRelations) {
      if (!relations[relation]) blockers.push(`required relation missing: ${relation}`)
    }
    if (!journal?.present) blockers.push('Drizzle migration journal is missing')
    if (!animalOutcomes.includes('DiedUnknownCause')) {
      blockers.push('animal_outcome cannot represent generic confirmed death')
    }
    if (!tenantId) blockers.push('tenant ID not supplied; tenant-scoped counts were not checked')

    return {
      checkedAt: new Date().toISOString(),
      mode: 'read_only',
      nodeEnv: process.env['NODE_ENV'] ?? null,
      target: {
        databaseName: identity.database_name,
        databaseUser: identity.database_user,
        serverVersion: identity.server_version,
        fingerprint,
        roleBypassesRls: role?.rolbypassrls ?? null,
        roleIsSuperuser: role?.rolsuper ?? null,
      },
      tenantId,
      tenantCounts,
      requiredRelations: relations,
      drizzleJournalPresent: journal?.present ?? false,
      animalOutcomes,
      blockers,
      readyForMigrationWrite: false,
      note: 'This probe never authorizes a write; it only identifies readiness blockers.',
    }
  })

  console.log(JSON.stringify(report, null, 2))
} finally {
  await client.end()
}
