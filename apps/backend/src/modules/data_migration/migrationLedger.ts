/**
 * Durable, restart-safe migration run and target-link writer.
 *
 * This is deliberately a narrow control-plane adapter. It does not decide
 * clinical or financial facts, and it does not persist any legacy row ID onto
 * a v2 domain row. Callers supply already-reconciled canonical facts and the
 * target display ID they intend to write. The ledger then atomically records
 * the canonical event and its source-to-target link with that target write.
 * A deterministic staff/patient crosswalk may instead attach an existing
 * target using `mutationKind: 'EvidenceOnly'`; the identity resolver, not an
 * email collision, is responsible for deciding that this is safe.
 */

import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { withPlatformTx, type Tx } from '../../shared/db/withTenantTx.js'
import {
  migrationCanonicalEvents,
  migrationRunEvents,
  migrationRuns,
  migrationTargetLinks,
} from '../../shared/db/schema.js'

const SHA256 = /^[a-f0-9]{64}$/
const RUN_MODES = ['Rehearsal', 'Baseline', 'CatchUp', 'DeltaAudit'] as const
const EVENT_DISPOSITIONS = ['SafeWrite', 'Withhold', 'ManualReview', 'EvidenceOnly'] as const
const MUTATION_KINDS = ['Insert', 'EvidenceOnly', 'Correction', 'VoidReplacement'] as const

export type MigrationRunMode = (typeof RUN_MODES)[number]
export type CanonicalEventDisposition = (typeof EVENT_DISPOSITIONS)[number]
export type MigrationMutationKind = (typeof MUTATION_KINDS)[number]
export type MigrationRunStatus =
  | 'Started'
  | 'Validated'
  | 'Applying'
  | 'Completed'
  | 'Failed'
  | 'Abandoned'

export type FrozenMigrationRunInput = {
  tenantId: string
  mode: MigrationRunMode
  /** SHA-256 of the frozen manifest and all admitted source exports. */
  sourcePackHash: string
  cutoffAt: Date
  importerVersion: string
  metadata?: Record<string, unknown>
}

export type MigrationRun = FrozenMigrationRunInput & {
  id: string
  resumed: boolean
}

export type CanonicalTargetEvent = {
  /** Stable semantic identity, never a legacy database column. */
  canonicalEventKey: string
  eventType: string
  disposition: CanonicalEventDisposition
  /** Reconciled fact plus immutable source envelopes/hashes used to derive it. */
  facts: Record<string, unknown>
  ruleVersion: string
  targetTable: string
  targetDisplayId: string
  mutationKind: MigrationMutationKind
}

export type TargetEventApplyResult<T> = {
  outcome: 'applied' | 'already_linked'
  canonicalEventId: number
  canonicalEventVersionHash: string
  targetLinkId: number
  value: T | undefined
}

export type MigrationLedger = {
  startOrResume(input: FrozenMigrationRunInput): Promise<MigrationRun>
  recordStatus(
    run: MigrationRun,
    status: MigrationRunStatus,
    detail?: Record<string, unknown>,
  ): Promise<void>
  applyTargetEvent<T>(
    run: MigrationRun,
    event: CanonicalTargetEvent,
    writeTarget: (tx: Tx) => Promise<T>,
  ): Promise<TargetEventApplyResult<T>>
  applyTargetEvents<T>(
    run: MigrationRun,
    events: readonly CanonicalTargetEvent[],
    writeTarget: (tx: Tx, event: CanonicalTargetEvent, index: number) => Promise<T>,
    resolveLinkedTarget: (tx: Tx, event: CanonicalTargetEvent, index: number) => Promise<T>,
  ): Promise<Array<TargetEventApplyResult<T>>>
}

/**
 * Creates the production-shaped adapter used by local migration trials. It
 * always uses a tenant-scoped platform transaction: migration tables have RLS
 * enabled and are intentionally not bypassed by raw SQL connections.
 */
export function drizzleMigrationLedger(platformUserId: number): MigrationLedger {
  const applyTargetEvents = async <T>(
    run: MigrationRun,
    events: readonly CanonicalTargetEvent[],
    writeTarget: (tx: Tx, event: CanonicalTargetEvent, index: number) => Promise<T>,
    resolveLinkedTarget: (tx: Tx, event: CanonicalTargetEvent, index: number) => Promise<T>,
  ): Promise<Array<TargetEventApplyResult<T>>> => {
    const normalizedRun = normalizeExistingRun(run)
    const normalizedEvents = events.map(normalizeEvent)
    return withPlatformTx(
      { platformUserId, targetTenantId: normalizedRun.tenantId },
      async (tx) => {
        await setMigrationImportContext(tx)
        const results: Array<TargetEventApplyResult<T>> = []
        for (let index = 0; index < normalizedEvents.length; index++) {
          const event = normalizedEvents[index]!
          results.push(
            await applyTargetEventInTx(
              tx,
              normalizedRun,
              event,
              () => writeTarget(tx, event, index),
              () => resolveLinkedTarget(tx, event, index),
            ),
          )
        }
        return results
      },
    )
  }

  return {
    async startOrResume(input) {
      const normalized = normalizeRun(input)
      return withPlatformTx({ platformUserId, targetTenantId: normalized.tenantId }, async (tx) => {
        const [existing] = await tx
          .select({ id: migrationRuns.id })
          .from(migrationRuns)
          .where(
            and(
              eq(migrationRuns.tenantId, normalized.tenantId),
              eq(migrationRuns.id, normalized.id),
            ),
          )
          .limit(1)
        if (existing) {
          await appendRunEvent(tx, normalized, 'Applying', { resumed: true })
          return { ...normalized, resumed: true }
        }

        const inserted = await tx
          .insert(migrationRuns)
          .values({
            id: normalized.id,
            tenantId: normalized.tenantId,
            mode: normalized.mode,
            sourcePackHash: normalized.sourcePackHash,
            cutoffAt: normalized.cutoffAt,
            importerVersion: normalized.importerVersion,
            metadata: normalized.metadata ? jsonb(normalized.metadata) : null,
            // The control-plane actor is recorded by the audit trigger from
            // withPlatformTx. This column references tenant users, not
            // platform_users, and a migration bot may not exist yet because
            // the run must start before the user stage.
            createdById: null,
          })
          .onConflictDoNothing()
          .returning({ id: migrationRuns.id })

        if (inserted.length === 0) {
          // A concurrent process inserted the same frozen-run identity. It
          // is safe to resume because later target mutations are protected
          // by a transaction-scoped advisory lock plus the durable link.
          await appendRunEvent(tx, normalized, 'Applying', { resumed: true, concurrentStart: true })
          return { ...normalized, resumed: true }
        }
        await appendRunEvent(tx, normalized, 'Started', { resumed: false })
        return { ...normalized, resumed: false }
      })
    },

    async recordStatus(run, status, detail = {}) {
      const normalized = normalizeExistingRun(run)
      await withPlatformTx({ platformUserId, targetTenantId: normalized.tenantId }, async (tx) =>
        appendRunEvent(tx, normalized, status, detail),
      )
    },

    async applyTargetEvent(run, event, writeTarget) {
      const normalizedRun = normalizeExistingRun(run)
      const normalizedEvent = normalizeEvent(event)

      return withPlatformTx(
        { platformUserId, targetTenantId: normalizedRun.tenantId },
        async (tx) => {
          await setMigrationImportContext(tx)
          return applyTargetEventInTx(tx, normalizedRun, normalizedEvent, writeTarget)
        },
      )
    },

    applyTargetEvents,
  }
}

async function setMigrationImportContext(tx: Tx): Promise<void> {
  await tx.execute(sql`select set_config('app.migration_import', 'true', true)`)
}

async function applyTargetEventInTx<T>(
  tx: Tx,
  run: Omit<MigrationRun, 'resumed'>,
  event: CanonicalTargetEvent,
  writeTarget: (tx: Tx) => Promise<T>,
  resolveLinkedTarget?: (tx: Tx) => Promise<T>,
): Promise<TargetEventApplyResult<T>> {
  const versionHash = canonicalEventVersionHash(event)
  const idempotencyKey = targetLinkIdempotencyKey(versionHash, event)

  // The durable link is created in the same transaction as the target
  // mutation. This lock prevents simultaneous retry workers from both
  // observing no link and writing the same target fact twice.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${idempotencyKey}))`)
  const [priorLink] = await tx
    .select({ id: migrationTargetLinks.id, eventId: migrationTargetLinks.eventId })
    .from(migrationTargetLinks)
    .where(
      and(
        eq(migrationTargetLinks.tenantId, run.tenantId),
        eq(migrationTargetLinks.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1)
  if (priorLink) {
    return {
      outcome: 'already_linked',
      canonicalEventId: priorLink.eventId,
      canonicalEventVersionHash: versionHash,
      targetLinkId: priorLink.id,
      value: resolveLinkedTarget ? await resolveLinkedTarget(tx) : undefined,
    }
  }

  const eventId = await insertOrResolveCanonicalEvent(tx, run, event, versionHash)
  const value = await writeTarget(tx)
  const [link] = await tx
    .insert(migrationTargetLinks)
    .values({
      tenantId: run.tenantId,
      eventId,
      targetTable: event.targetTable,
      targetDisplayId: event.targetDisplayId,
      mutationKind: event.mutationKind,
      idempotencyKey,
    })
    .returning({ id: migrationTargetLinks.id })
  if (!link) throw new Error('migration target link insert returned no id')
  return {
    outcome: 'applied',
    canonicalEventId: eventId,
    canonicalEventVersionHash: versionHash,
    targetLinkId: link.id,
    value,
  }
}

/** Stable run identity for a frozen pack; suitable for retries and resumes. */
export function deterministicMigrationRunId(input: FrozenMigrationRunInput): string {
  const normalized = normalizeRun(input)
  return normalized.id
}

/** Stable version identity for a canonical fact, independent of retry/run ID. */
export function canonicalEventVersionHash(
  event: Omit<CanonicalTargetEvent, 'targetTable' | 'targetDisplayId' | 'mutationKind'>,
): string {
  const normalized = normalizeEvent({
    ...event,
    targetTable: 'validation_only',
    targetDisplayId: 'validation_only',
    mutationKind: 'EvidenceOnly',
  })
  return hash({
    version: 1,
    canonicalEventKey: normalized.canonicalEventKey,
    eventType: normalized.eventType,
    disposition: normalized.disposition,
    facts: normalized.facts,
    ruleVersion: normalized.ruleVersion,
  })
}

export function targetLinkIdempotencyKey(
  canonicalVersionHash: string,
  event: Pick<CanonicalTargetEvent, 'targetTable' | 'targetDisplayId' | 'mutationKind'>,
): string {
  if (!SHA256.test(canonicalVersionHash))
    throw new Error('canonicalVersionHash must be a lowercase SHA-256 hash')
  const normalized = normalizeEvent({
    canonicalEventKey: 'validation_only',
    eventType: 'validation_only',
    disposition: 'EvidenceOnly',
    facts: {},
    ruleVersion: 'validation_only',
    ...event,
  })
  return hash({
    version: 1,
    canonicalVersionHash,
    target: {
      table: normalized.targetTable,
      displayId: normalized.targetDisplayId,
      mutationKind: normalized.mutationKind,
    },
  })
}

async function insertOrResolveCanonicalEvent(
  tx: Tx,
  run: Omit<MigrationRun, 'resumed'>,
  event: CanonicalTargetEvent,
  versionHash: string,
): Promise<number> {
  const inserted = await tx
    .insert(migrationCanonicalEvents)
    .values({
      tenantId: run.tenantId,
      runId: run.id,
      canonicalEventKey: event.canonicalEventKey,
      versionHash,
      eventType: event.eventType,
      disposition: event.disposition,
      facts: jsonb(event.facts),
      ruleVersion: event.ruleVersion,
    })
    .onConflictDoNothing()
    .returning({ id: migrationCanonicalEvents.id })
  if (inserted[0]) return inserted[0].id

  const [existing] = await tx
    .select({ id: migrationCanonicalEvents.id })
    .from(migrationCanonicalEvents)
    .where(
      and(
        eq(migrationCanonicalEvents.tenantId, run.tenantId),
        eq(migrationCanonicalEvents.versionHash, versionHash),
      ),
    )
    .limit(1)
  if (!existing) throw new Error('canonical event conflict could not be resolved')
  return existing.id
}

async function appendRunEvent(
  tx: Tx,
  run: Omit<MigrationRun, 'resumed'>,
  status: MigrationRunStatus,
  detail: Record<string, unknown>,
): Promise<void> {
  await tx.insert(migrationRunEvents).values({
    tenantId: run.tenantId,
    runId: run.id,
    status,
    detail: jsonb(detail),
  })
}

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`
}

function normalizeRun(input: FrozenMigrationRunInput): Omit<MigrationRun, 'resumed'> {
  const tenantId = requireText(input.tenantId, 'tenantId')
  if (!RUN_MODES.includes(input.mode))
    throw new Error(`unsupported migration run mode: ${input.mode}`)
  const sourcePackHash = input.sourcePackHash.toLowerCase()
  if (!SHA256.test(sourcePackHash))
    throw new Error('sourcePackHash must be a lowercase SHA-256 hash')
  if (!(input.cutoffAt instanceof Date) || Number.isNaN(input.cutoffAt.getTime()))
    throw new Error('cutoffAt must be a valid Date')
  const importerVersion = requireText(input.importerVersion, 'importerVersion')
  const base = {
    tenantId,
    mode: input.mode,
    sourcePackHash,
    cutoffAt: new Date(input.cutoffAt),
    importerVersion,
    metadata: input.metadata,
  }
  return { ...base, id: deterministicRunIdUnchecked(base) }
}

function normalizeExistingRun(run: MigrationRun): Omit<MigrationRun, 'resumed'> {
  const normalized = normalizeRun(run)
  if (run.id !== normalized.id)
    throw new Error('migration run ID does not match its frozen identity')
  return normalized
}

function deterministicRunIdUnchecked(input: Omit<MigrationRun, 'id' | 'resumed'>): string {
  return `MRUN_${hash({
    version: 1,
    tenantId: input.tenantId,
    mode: input.mode,
    sourcePackHash: input.sourcePackHash,
    cutoffAt: input.cutoffAt.toISOString(),
    importerVersion: input.importerVersion,
  })}`
}

function normalizeEvent(event: CanonicalTargetEvent): CanonicalTargetEvent {
  if (!EVENT_DISPOSITIONS.includes(event.disposition))
    throw new Error(`unsupported event disposition: ${event.disposition}`)
  if (!MUTATION_KINDS.includes(event.mutationKind))
    throw new Error(`unsupported mutation kind: ${event.mutationKind}`)
  stableJson(event.facts) // validates the immutable payload before any write
  return {
    ...event,
    canonicalEventKey: requireText(event.canonicalEventKey, 'canonicalEventKey'),
    eventType: requireText(event.eventType, 'eventType'),
    ruleVersion: requireText(event.ruleVersion, 'ruleVersion'),
    targetTable: requireText(event.targetTable, 'targetTable'),
    targetDisplayId: requireText(event.targetDisplayId, 'targetDisplayId'),
  }
}

function requireText(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

/** Canonical JSON avoids a retry changing hashes solely because key order changed. */
function stableJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('migration ledger payload cannot contain a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('migration ledger payload must contain only plain JSON objects')
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    )
    if (entries.some(([, item]) => item === undefined)) {
      throw new Error('migration ledger payload cannot contain undefined')
    }
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  throw new Error(`migration ledger payload cannot contain ${typeof value}`)
}

export const __testing__ = { stableJson }
