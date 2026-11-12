/**
 * AppSheet `Row ID` ↔ SureVax bigint id map.
 *
 * The legacy export uses opaque strings as foreign keys across every sheet
 * (`i_PatientRef`, `t_PatientRef`, `i_TransactionRef`, …). The importer makes
 * one pass that creates the destination rows and registers the resulting
 * bigint id under the source key; downstream stages resolve FKs by lookup.
 *
 * Partitioned by entity kind because the same `Row ID` string can appear across
 * sheets (a Vaccine "Row ID" is the catalog code, NOT a random hash). Forcing a
 * kind on every read/write makes that collision-class impossible.
 */

export type EntityKind =
  | 'patient'
  | 'transaction'
  | 'immunization' // → clinical_orders.id
  | 'branch'
  | 'user' // nurse
  | 'product' // vaccine brand
  | 'service' // vaccine catalog code
  | 'encounter' // synthesised: (patient, branch, date) → encounters.id
  | 'pso' // synthesised patient_standing_orders
  | 'cash_drawer_session'
  | 'staff_time_log'

export class RowIdMap {
  private inner: Map<EntityKind, Map<string, number>> = new Map()

  /** Register a source → destination mapping. Idempotent; throws on conflicts. */
  put(kind: EntityKind, sourceKey: string, destId: number): void {
    if (!sourceKey) throw new Error(`RowIdMap.put: empty sourceKey for ${kind}`)
    if (!Number.isFinite(destId) || destId <= 0) {
      throw new Error(`RowIdMap.put: invalid destId ${destId} for ${kind}/${sourceKey}`)
    }
    let bucket = this.inner.get(kind)
    if (!bucket) {
      bucket = new Map()
      this.inner.set(kind, bucket)
    }
    const existing = bucket.get(sourceKey)
    if (existing !== undefined && existing !== destId) {
      throw new Error(`RowIdMap.put: conflict for ${kind}/${sourceKey}: ${existing} vs ${destId}`)
    }
    bucket.set(sourceKey, destId)
  }

  /** Lookup. Returns undefined if not present. */
  get(kind: EntityKind, sourceKey: string | null | undefined): number | undefined {
    if (!sourceKey) return undefined
    return this.inner.get(kind)?.get(sourceKey)
  }

  /** Lookup; throw if missing. Use when the FK is required. */
  require(kind: EntityKind, sourceKey: string | null | undefined): number {
    const v = this.get(kind, sourceKey)
    if (v === undefined) {
      throw new Error(`RowIdMap.require: missing ${kind}/${sourceKey ?? '<null>'}`)
    }
    return v
  }

  /** Number of entries for a kind — useful for sanity checks + tests. */
  size(kind: EntityKind): number {
    return this.inner.get(kind)?.size ?? 0
  }

  /** Iterate one kind. */
  *entries(kind: EntityKind): IterableIterator<[string, number]> {
    const bucket = this.inner.get(kind)
    if (!bucket) return
    for (const e of bucket.entries()) yield e
  }
}
