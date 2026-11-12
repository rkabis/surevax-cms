/**
 * Local-only AppSheet cutover rehearsal.
 *
 * This module is deliberately a reader. It opens the frozen local exports,
 * produces an evidence ledger and a PHI-safe human queue, then exercises the
 * existing LoadPlan in dry-run mode. It never writes a database and it never
 * alters a source workbook.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { createMemoryAdapter } from './adapter.js'
import {
  emptyEventLedger,
  type CanonicalDoseEvent,
  type CanonicalEventLedger,
} from './eventLedger.js'
import { extractFromDriveSnapshot, extractFromFile } from './extract.js'
import { load } from './load.js'
import { bool, dateOnly, num, str, ts } from './normalize.js'
import {
  classifyPendingAnimalFollowup,
  decideExternalDoseOne,
  trackerRemarkNegatesAdministration,
} from './remarkSemantics.js'
import type { SourceEnvelope } from './sourceEnvelope.js'
import { runTransforms } from './transform/index.js'
import type { LoadPlan } from './targets.js'
import type {
  MigrationContext,
  SourceBundle,
  SrcImmunization,
  SrcPatient,
  SrcTransaction,
} from './types.js'

export type QueuePriority = 'P0' | 'P1' | 'P2' | 'P3'
export type QueueDisposition =
  | 'CUTOVER_BLOCKER'
  | 'RECORD_BLOCKER'
  | 'REVIEW_CONFIRMATION'
  | 'FOLLOW_UP'

/** No patient names, phone numbers, addresses, raw remarks, or raw source IDs. */
export type SafeQueueItem = {
  priority: QueuePriority
  disposition: QueueDisposition
  code: string
  summary: string
  sourceRefs: string[]
}

export type SafeRehearsalReport = {
  schemaVersion: 1
  mode: 'local_read_only_dry_run'
  cutoffDate: string
  sourcePack: {
    hash: string
    snapshots: number
    usableSnapshots: number
    missingSnapshots: number
    hashMismatches: number
    sourceDriftRecorded: boolean
  }
  counts: {
    source: Record<string, number>
    trackerRowsRead: number
    trackerRowsSelected: number
    canonicalEvents: number
    localAdministrations: number
    externalAdministrations: number
    scheduledDoses: number
    dryRunLoadPlan: Record<keyof LoadPlan, number>
  }
  automaticInferences: Array<{ code: string; count: number }>
  queue: SafeQueueItem[]
  queueCounts: Record<QueuePriority, number>
  readyForDatabaseWrite: false
}

type ManifestTracker = {
  branch: string
  driveFileId?: string
  driveModifiedAtUtc?: string
  candidateSheets?: string[]
  localPath?: string | null
  localSha256?: string
}

type SourceManifest = {
  observedDate?: string
  appsheetDatabase: {
    title?: string
    driveFileId?: string
    driveModifiedAtUtc?: string
    sourceDriftObservedDuringAnalysis?: boolean
    localExport?: { path?: string; sha256?: string }
  }
  clinicTrackers?: ManifestTracker[]
}

export type Snapshot = {
  key: string
  source: 'appsheet' | 'tracker'
  title: string
  fileId?: string
  expectedSha256?: string
  actualSha256?: string
  present: boolean
  hashMatchesExpected: boolean | null
}

export type TrackerRow = {
  envelope: SourceEnvelope
  branchLegacyId: string | null
  date: string | null
  name: string | null
  vaccine: string | null
  route: string | null
  amount: number | null
  payment: string | null
  notes: string | null
}

export type RehearsalInput = {
  source: SourceBundle
  trackers: TrackerRow[]
  snapshots: Snapshot[]
  cutoffDate: string
  tenantId: string
  sourceDriftRecorded: boolean
}

export type RehearsalResult = {
  report: SafeRehearsalReport
  ledger: CanonicalEventLedger
  plan: LoadPlan
  /** In-memory frozen source for downstream canonical projectors; never serialize it into PHI-safe reports. */
  source: SourceBundle
}

export type LocalRehearsalOptions = {
  manifestPath: string
  appsheetPath?: string
  appsheetSnapshotDirectory?: string
  appsheetSnapshotSha256?: string
  tenantId?: string
  cutoffDate?: string
}

/**
 * End-to-end entry point for a local rehearsal. This is safe to execute on a
 * developer machine: source files are read, and LoadPlan is simulated only.
 */
export async function runLocalMigrationRehearsal(
  options: LocalRehearsalOptions,
): Promise<RehearsalResult> {
  const manifest = parseManifest(await readFile(options.manifestPath, 'utf8'))
  const appsheetPath = options.appsheetPath ?? manifest.appsheetDatabase.localExport?.path
  if (!appsheetPath && !options.appsheetSnapshotDirectory) {
    throw new Error('provide an AppSheet workbook or Drive snapshot directory')
  }

  const snapshots: Snapshot[] = []
  snapshots.push(
    await inspectSnapshot({
      key: 'appsheet',
      source: 'appsheet',
      title: manifest.appsheetDatabase.title ?? 'surevax_gsheet_db',
      fileId: manifest.appsheetDatabase.driveFileId,
      filePath: options.appsheetSnapshotDirectory ?? appsheetPath,
      expectedSha256: options.appsheetSnapshotDirectory
        ? options.appsheetSnapshotSha256
        : manifest.appsheetDatabase.localExport?.sha256,
    }),
  )

  const trackerSpecs = manifest.clinicTrackers ?? []
  for (const tracker of trackerSpecs) {
    snapshots.push(
      await inspectSnapshot({
        key: `tracker:${tracker.branch}`,
        source: 'tracker',
        title: `Manual Sales Tracker - ${tracker.branch}`,
        fileId: tracker.driveFileId,
        filePath: tracker.localPath ?? undefined,
        expectedSha256: tracker.localSha256,
      }),
    )
  }

  const source = options.appsheetSnapshotDirectory
    ? await extractFromDriveSnapshot(options.appsheetSnapshotDirectory)
    : await extractFromFile(appsheetPath as string)
  const branchMap = buildBranchMap(source)
  const trackers: TrackerRow[] = []
  for (const tracker of trackerSpecs) {
    if (!tracker.localPath || !candidateSheetsAreExplicit(tracker.candidateSheets)) continue
    trackers.push(
      ...(await extractTrackerRows({
        filePath: tracker.localPath,
        title: `Manual Sales Tracker - ${tracker.branch}`,
        fileId: tracker.driveFileId,
        expectedBranch: resolveBranch(branchMap, tracker.branch),
        candidateSheets: tracker.candidateSheets ?? [],
      })),
    )
  }

  return reconcileRehearsal({
    source,
    trackers,
    snapshots,
    cutoffDate:
      options.cutoffDate ?? manifest.observedDate ?? new Date().toISOString().slice(0, 10),
    tenantId: options.tenantId ?? 'SVX',
    sourceDriftRecorded: options.appsheetSnapshotDirectory
      ? false
      : manifest.appsheetDatabase.sourceDriftObservedDuringAnalysis === true,
  })
}

/** Pure reconciliation boundary used by unit tests and a future DB-backed runner. */
export async function reconcileRehearsal(input: RehearsalInput): Promise<RehearsalResult> {
  const queue: SafeQueueItem[] = []
  const automatic = new Counter()
  const sourcePackHash = hashStable(
    input.snapshots
      .map((snapshot) => ({
        key: snapshot.key,
        actualSha256: snapshot.actualSha256 ?? null,
        present: snapshot.present,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  )

  const transform = runTransforms(
    input.source,
    input.tenantId,
    new Date(`${input.cutoffDate}T23:59:59.999+08:00`),
  )
  const plan = transform.plan
  for (const warning of transform.warnings) {
    if (warning.source !== 'Transactions' || !warning.rowId) continue
    if (
      warning.code === 'PAYMENT_LEGS_MATCH_FINAL_BILL' ||
      warning.code === 'EXPLICIT_ONE_CENT_SHORTFALL'
    ) {
      automatic.add(`TRANSACTION_${warning.code}`)
      continue
    }
    const classification = transactionWarning(warning.code)
    queue.push(
      q('P1', 'RECORD_BLOCKER', classification.code, classification.summary, [
        safeAppSheetRef('transaction', warning.rowId),
      ]),
    )
  }
  const ctx: MigrationContext = {
    tenantId: input.tenantId,
    platformUserId: 0,
    dryRun: true,
    batchSize: 1000,
    cutoverAt: new Date(`${input.cutoffDate}T00:00:00.000Z`),
    log: () => {},
  }
  // `load` has no I/O when dryRun=true. It remains useful because it catches
  // dependency/order regressions in the plan that a row-count-only report misses.
  // A structural-plan failure is a P0 finding, not a reason to discard the
  // evidence/queue report we can still produce from the frozen source pack.
  try {
    await load(plan, createMemoryAdapter(), ctx)
  } catch {
    queue.push(
      q(
        'P0',
        'CUTOVER_BLOCKER',
        'LOAD_PLAN_REFERENTIAL_FAILURE',
        'The current transformed LoadPlan contains an unresolved internal reference. No database write may proceed until the ledger-backed plan resolves it.',
        ['code:dry-run-load'],
      ),
    )
  }

  const missingSnapshots = input.snapshots.filter((snapshot) => !snapshot.present)
  const hashMismatches = input.snapshots.filter(
    (snapshot) => snapshot.hashMatchesExpected === false,
  )
  if (input.sourceDriftRecorded) {
    queue.push(
      q(
        'P0',
        'CUTOVER_BLOCKER',
        'SOURCE_DRIFT_RECORDED',
        'The manifest records a live AppSheet change after analysis; this pack is rehearsal-only until a new coordinated freeze is materialized and hashed.',
        ['manifest:appsheet'],
      ),
    )
  }
  for (const snapshot of missingSnapshots) {
    queue.push(
      q(
        'P0',
        'CUTOVER_BLOCKER',
        'SOURCE_EXPORT_MISSING',
        'A required source export is absent from the local pack.',
        [safeSnapshotRef(snapshot)],
      ),
    )
  }
  for (const snapshot of hashMismatches) {
    queue.push(
      q(
        'P0',
        'CUTOVER_BLOCKER',
        'SOURCE_HASH_MISMATCH',
        'A local source file does not match the hash recorded in the manifest.',
        [safeSnapshotRef(snapshot)],
      ),
    )
  }

  // The supplied manifest intentionally names Salcedo's month tabs generically;
  // selecting a tab by heuristic would violate copied-sheet quarantine policy.
  for (const snapshot of input.snapshots.filter((s) => s.source === 'tracker')) {
    const branch = snapshot.key.replace(/^tracker:/, '')
    if (branch === 'Salcedo') {
      queue.push(
        q(
          'P0',
          'CUTOVER_BLOCKER',
          'TRACKER_TAB_OWNERSHIP_UNRESOLVED',
          'The source pack does not identify a single owner-approved Salcedo ledger tab.',
          [safeSnapshotRef(snapshot)],
        ),
      )
    }
  }

  let ledger = buildAppSheetLedger(input.source, transform.serviceCodeByLegacyRef, queue, automatic)
  ledger = reconcileTrackerAdministrations({
    source: input.source,
    trackers: input.trackers,
    ledger,
    queue,
    automatic,
  })
  queue.push(
    ...pendingAnimalQueue(input.source.Patient, input.source.Immunization, input.cutoffDate),
  )

  // The existing transformer still contains legacy scheduled-dose behaviour;
  // keep its plan as a structural dry-run only, never as clinical cutover truth.
  queue.push(
    q(
      'P0',
      'CUTOVER_BLOCKER',
      'LOAD_PLAN_SCHEDULES_NOT_RECONCILED',
      'The dry-run plan is structurally valid, but regimen dose sequencing and past-due schedule states still require ledger-driven reconstruction before any database write.',
      ['code:transformClinicalOrders'],
    ),
  )

  const counts = countEvents(ledger.events)
  const report: SafeRehearsalReport = {
    schemaVersion: 1,
    mode: 'local_read_only_dry_run',
    cutoffDate: input.cutoffDate,
    sourcePack: {
      hash: sourcePackHash,
      snapshots: input.snapshots.length,
      usableSnapshots: input.snapshots.filter((snapshot) => snapshot.present).length,
      missingSnapshots: missingSnapshots.length,
      hashMismatches: hashMismatches.length,
      sourceDriftRecorded: input.sourceDriftRecorded,
    },
    counts: {
      source: sourceCounts(input.source),
      trackerRowsRead: input.trackers.length,
      trackerRowsSelected: input.trackers.length,
      canonicalEvents: ledger.events.length,
      localAdministrations: counts.local,
      externalAdministrations: counts.external,
      scheduledDoses: counts.scheduled,
      dryRunLoadPlan: loadPlanCounts(plan),
    },
    automaticInferences: automatic.entries(),
    queue: sortQueue(queue),
    queueCounts: queueCounts(queue),
    readyForDatabaseWrite: false,
  }
  return { report, ledger, plan, source: input.source }
}

function transactionWarning(code: string | undefined): { code: string; summary: string } {
  switch (code) {
    case 'TRANSACTION_PAYMENT_UNRESOLVED':
      return {
        code,
        summary:
          'Tender legs disagree with the recorded paid header and final bill; the financial graph is withheld.',
      }
    case 'TRANSACTION_FINAL_BILL_FORMULA_UNRESOLVED':
      return {
        code,
        summary:
          'The materialised final bill disagrees with transaction value plus signed adjustment; the financial graph is withheld.',
      }
    case 'TRANSACTION_FULLY_PAID_DISCOUNT_UNRESOLVED':
      return {
        code,
        summary:
          'The FullyPaid label does not carry its approved negative 200 adjustment; the financial graph is withheld.',
      }
    case 'TRANSACTION_REFUND_LINK_UNRESOLVED':
      return {
        code,
        summary:
          'A negative source transaction is a refund but does not yet resolve to its original target payment; the refund graph is withheld.',
      }
    case 'TRANSACTION_NEGATIVE_PAYMENT_LEG_UNRESOLVED':
      return {
        code,
        summary:
          'A source sale combines a positive tender with a negative refund leg; it is withheld until payment and refund can be represented separately.',
      }
    case 'TRANSACTION_PATIENT_UNRESOLVED':
    default:
      return {
        code: 'TRANSACTION_PATIENT_UNRESOLVED',
        summary:
          'A financial group does not resolve to one imported patient and is withheld from the load plan.',
      }
  }
}

function buildAppSheetLedger(
  source: SourceBundle,
  serviceCodeByLegacyRef: ReadonlyMap<string, string>,
  queue: SafeQueueItem[],
  automatic: Counter,
): CanonicalEventLedger {
  const ledger = emptyEventLedger()
  const transactionById = new Map(source.Transactions.map((row) => [str(row['Row ID']), row]))
  const remarksByPatient = groupRemarks(source)
  const pepByPatient = new Map<string, SrcImmunization[]>()

  for (const row of source.Immunization) {
    const rowId = str(row['Row ID'])
    const patientId = str(row.i_PatientRef)
    const branchId = str(row.i_BranchRef)
    const administeredAt = ts(row.i_Timestamp_Actual)
    const vaccineRef = str(row.i_VaccineRef)
    const vaccine = vaccineRef
      ? source.Vaccine.find((candidate) => str(candidate['Row ID']) === vaccineRef)
      : undefined
    const type = str(vaccine?.v_Type) ?? str(row.i_VaccineType)
    if (
      !rowId ||
      !patientId ||
      !branchId ||
      !administeredAt ||
      bool(row['i_IsAdministered?']) !== true
    )
      continue

    const evidence: SourceEnvelope[] = [appsheetEnvelope('appsheet_immunization', rowId)]
    const transactionId = str(row.i_TransactionRef)
    if (transactionId && transactionById.has(transactionId)) {
      evidence.push(appsheetEnvelope('appsheet_transaction', transactionId))
    }
    const serviceId =
      (vaccineRef ? serviceCodeByLegacyRef.get(vaccineRef) : undefined) ??
      serviceFromAppSheet(type, str(row.i_VaccineRoute))
    if (!serviceId) {
      if (type === 'Service' || type === 'Diagnostics') {
        automatic.add('NON_DOSE_SOURCE_OBSERVATION')
        continue
      }
      queue.push(
        q(
          'P2',
          'REVIEW_CONFIRMATION',
          'IMMUNIZATION_SERVICE_NEEDS_CATALOG_CONFIRMATION',
          'An administered AppSheet row has no target catalog mapping; retain its source evidence and confirm the service mapping before loading this record.',
          evidence.map(safeEnvelopeRef),
        ),
      )
      continue
    }
    const doseNumber = extractDoseNumber(row)
    const event: CanonicalDoseEvent = {
      eventId: `IMM::${rowId}`,
      kind: 'local_administration',
      patientLegacyId: patientId,
      branchLegacyId: branchId,
      serviceId,
      doseNumber,
      confidence: 'deterministic',
      evidence,
      administeredAt: administeredAt.toISOString(),
      route: routeOf(row.i_VaccineRoute),
      site: str(row.i_SiteAdministered) ?? undefined,
      brandSnapshot: str(row.i_VaccineBrand) ?? undefined,
      linkedTransactionLegacyId: transactionId ?? undefined,
    }
    ledger.events.push(event)
    if (type === 'Anti Rabies - PEP') {
      const values = pepByPatient.get(patientId) ?? []
      values.push(row)
      pepByPatient.set(patientId, values)
    }
  }

  // E33: only a first local PEP row which is actually D2+ is eligible. The
  // exact source evidence remains attached to the inferred external fact.
  for (const [patientId, doses] of pepByPatient) {
    const sorted = [...doses].sort(
      (a, b) =>
        (ts(a.i_Timestamp_Actual)?.getTime() ?? 0) - (ts(b.i_Timestamp_Actual)?.getTime() ?? 0),
    )
    const first = sorted[0]
    if (!first) continue
    const firstDose = extractDoseNumber(first)
    const patientRemarks = remarksByPatient.get(patientId) ?? []
    const result = decideExternalDoseOne(
      firstDose,
      patientRemarks.map((remark) => remark.text),
    )
    if (result.action === 'none') continue
    const firstId = str(first['Row ID'])!
    const evidence = [
      appsheetEnvelope('appsheet_immunization', firstId),
      ...patientRemarks.map((remark) => remark.envelope),
    ]
    if (result.action === 'manual_review') {
      queue.push(
        q(
          'P1',
          'RECORD_BLOCKER',
          'EXTERNAL_DOSE_1_CONTRADICTED',
          'A contradictory attributable remark prevents an inferred external ARV dose 1.',
          evidence.map(safeEnvelopeRef),
        ),
      )
      continue
    }
    ledger.events.push({
      eventId: `E33::${patientId}::${firstId}`,
      kind: 'external_administration',
      patientLegacyId: patientId,
      branchLegacyId: null,
      serviceId: serviceFromAppSheet('Anti Rabies - PEP', str(first.i_VaccineRoute)) ?? 'ARVPEP',
      doseNumber: 1,
      confidence: result.basis === 'explicit_remark' ? 'deterministic' : 'owner_approved',
      evidence,
      administeredAt: null,
      datePrecision: 'unknown',
      dateBasis: 'unknown_owner_assumption',
    })
    automatic.add(
      result.basis === 'explicit_remark'
        ? 'EXTERNAL_D1_EXPLICIT_REMARK'
        : 'ASSUMED_EXTERNAL_MISSING_DOSE_1',
    )
  }
  return ledger
}

function reconcileTrackerAdministrations(args: {
  source: SourceBundle
  trackers: TrackerRow[]
  ledger: CanonicalEventLedger
  queue: SafeQueueItem[]
  automatic: Counter
}): CanonicalEventLedger {
  const ledger: CanonicalEventLedger = {
    events: [...args.ledger.events],
    exceptions: [...args.ledger.exceptions],
  }
  const patientsByName = new Map<string, string[]>()
  const patientIdsByToken = new Map<string, Set<string>>()
  const patientTokensById = new Map<string, Set<string>>()
  for (const patient of args.source.Patient) {
    const id = str(patient['Row ID'])
    const name = normalizeName(str(patient.p_FullName))
    if (!id || !name) continue
    patientsByName.set(name, [...(patientsByName.get(name) ?? []), id])
    const tokens = new Set(name.split(' '))
    patientTokensById.set(id, tokens)
    for (const token of tokens) {
      if (token.length < 3) continue
      const indexed = patientIdsByToken.get(token) ?? new Set<string>()
      indexed.add(id)
      patientIdsByToken.set(token, indexed)
    }
  }
  const txns = args.source.Transactions
  const existing = new Map<string, CanonicalDoseEvent>()
  for (const event of ledger.events) {
    if (event.kind !== 'local_administration') continue
    existing.set(
      eventKey(
        event.patientLegacyId,
        event.serviceId,
        event.administeredAt.slice(0, 10),
        event.doseNumber,
      ),
      event,
    )
  }

  for (const row of args.trackers) {
    if (!row.name || !row.vaccine || !row.date || !row.branchLegacyId) continue
    if (row.notes && trackerRemarkNegatesAdministration(row.notes)) {
      args.automatic.add('TRACKER_REMARK_NEGATES_ADMINISTRATION')
      continue
    }
    const exactCandidates = patientsByName.get(normalizeName(row.name) ?? '') ?? []
    const serviceId = serviceFromTracker(row.vaccine, row.route)
    if (!serviceId) {
      args.queue.push(
        q(
          'P2',
          'REVIEW_CONFIRMATION',
          'TRACKER_SERVICE_NEEDS_CONFIRMATION',
          'The tracker row identifies a visit but does not identify one target service and route with enough precision.',
          [safeEnvelopeRef(row.envelope)],
        ),
      )
      continue
    }
    const candidates =
      exactCandidates.length === 1
        ? exactCandidates
        : resolveUniqueMultiFieldPatient({
            name: row.name,
            date: row.date,
            branchLegacyId: row.branchLegacyId,
            serviceId,
            amount: row.amount,
            payment: row.payment,
            transactions: txns,
            immunizations: args.source.Immunization,
            patientIdsByToken,
            patientTokensById,
          })
    if (candidates.length !== 1) {
      args.queue.push(
        q(
          'P1',
          'RECORD_BLOCKER',
          candidates.length === 0 ? 'TRACKER_PATIENT_UNRESOLVED' : 'TRACKER_PATIENT_AMBIGUOUS',
          'A tracker administration cannot be linked to exactly one AppSheet patient using name, workbook branch, date, service, amount and tender.',
          [safeEnvelopeRef(row.envelope)],
        ),
      )
      continue
    }
    if (exactCandidates.length !== 1) args.automatic.add('TRACKER_MULTIFIELD_PATIENT_MATCH')
    const patientId = candidates[0]!
    const doseNumber = extractTrackerDose(row.vaccine)
    const key = eventKey(patientId, serviceId, row.date, doseNumber)
    const prior = existing.get(key)
    const matchingTransactions = txns.filter((txn) => transactionMatches(txn, patientId, row.date!))
    const tx = matchingTransactions.length === 1 ? matchingTransactions[0] : undefined
    const txBranch = tx ? str(tx.t_BranchRef) : null
    if (matchingTransactions.length > 1) {
      args.queue.push(
        q(
          'P1',
          'RECORD_BLOCKER',
          'TRACKER_TRANSACTION_AMBIGUOUS',
          'More than one same-patient same-day transaction could carry the tracker financial facts.',
          [
            safeEnvelopeRef(row.envelope),
            ...matchingTransactions.map((candidate) =>
              safeAppSheetRef('transaction', str(candidate['Row ID']) ?? 'unknown'),
            ),
          ],
        ),
      )
    }
    if (!tx) {
      args.queue.push(
        q(
          'P1',
          'RECORD_BLOCKER',
          'TRACKER_TRANSACTION_MISSING',
          'The tracker supports administration, but no unique AppSheet transaction is available for the financial record.',
          [safeEnvelopeRef(row.envelope)],
        ),
      )
    } else if (txBranch && txBranch !== row.branchLegacyId) {
      args.queue.push(
        q(
          'P1',
          'RECORD_BLOCKER',
          'TRACKER_TRANSACTION_BRANCH_CONFLICT',
          'The workbook-title branch is retained for the encounter; the conflicting transaction branch requires record-level resolution.',
          [
            safeEnvelopeRef(row.envelope),
            safeAppSheetRef('transaction', str(tx['Row ID']) ?? 'unknown'),
          ],
        ),
      )
    }

    if (prior && prior.kind === 'local_administration') {
      prior.evidence.push(row.envelope)
      args.automatic.add('TRACKER_CORROBORATES_APPSHEET_ADMINISTRATION')
      continue
    }
    const event: CanonicalDoseEvent = {
      eventId: `TRK::${hashStable([row.envelope.workbookTitle, row.envelope.sheet, row.envelope.rowNumber])}`,
      kind: 'local_administration',
      patientLegacyId: patientId,
      branchLegacyId: row.branchLegacyId,
      serviceId,
      doseNumber,
      confidence: 'deterministic',
      evidence: [
        row.envelope,
        ...(tx ? [appsheetEnvelope('appsheet_transaction', str(tx['Row ID'])!)] : []),
      ],
      administeredAt: `${row.date}T00:00:00.000Z`,
      route: routeOf(row.route),
      linkedTransactionLegacyId: tx ? (str(tx['Row ID']) ?? undefined) : undefined,
    }
    ledger.events.push(event)
    existing.set(key, event)
    args.automatic.add('TRACKER_LOCAL_ADMINISTRATION')
  }
  return ledger
}

function pendingAnimalQueue(
  patients: SrcPatient[],
  immunizations: SrcImmunization[],
  cutoffDate: string,
): SafeQueueItem[] {
  const out: SafeQueueItem[] = []
  for (const patient of patients) {
    if (str(patient.p_PetStatus)?.toLowerCase() !== 'pending') continue
    const patientId = str(patient['Row ID'])
    if (!patientId) continue
    const pepRows = immunizations.filter(
      (row) =>
        row.i_PatientRef === patientId &&
        bool(row['i_IsAdministered?']) === true &&
        /anti\s*rabies\s*-?\s*pep/i.test(str(row.i_VaccineType) ?? ''),
    )
    const anchors = pepCourseAnchors(pepRows)
    const decision = classifyPendingAnimalFollowup({
      humanFirstArvDate: dateOnly(patient.p_PetFirstARVDate),
      cutoffDate,
      incidentAnchor: anchors === 1 ? 'unique' : anchors === 0 ? 'none' : 'ambiguous',
    })
    if (!decision.queuePriority) continue
    out.push(
      q(
        decision.queuePriority,
        decision.queuePriority === 'P1' ? 'RECORD_BLOCKER' : 'FOLLOW_UP',
        decision.reason.toUpperCase(),
        decision.reason === 'unique_incident_overdue'
          ? 'The animal Day-14 outcome is overdue; preserve Pending and continue PEP while outreach is completed.'
          : 'The animal Day-14 outcome cannot be linked safely to one bite episode; preserve Pending and continue PEP.',
        [safeAppSheetRef('patient', patientId)],
      ),
    )
  }
  return out
}

async function extractTrackerRows(input: {
  filePath: string
  title: string
  fileId?: string
  expectedBranch: string | null
  candidateSheets: string[]
}): Promise<TrackerRow[]> {
  if (path.extname(input.filePath).toLowerCase() === '.json') {
    return extractDriveSnapshotRows(input)
  }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(input.filePath)
  const out: TrackerRow[] = []
  for (const candidate of input.candidateSheets) {
    const sheet = workbook.getWorksheet(candidate)
    if (!sheet) continue
    const header = findTrackerHeader(sheet)
    if (!header) continue
    for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber)
      const values = readTrackerRow(row, header)
      if (!values.name && !values.vaccine && !values.date) continue
      out.push({
        envelope: {
          source: 'manual_sales_tracker',
          fileId: input.fileId,
          workbookTitle: input.title,
          workbookBranchLegacyId: input.expectedBranch ?? 'UNRESOLVED',
          sheet: sheet.name,
          rowNumber,
          rowHash: hashStable(values),
        },
        branchLegacyId: input.expectedBranch,
        ...values,
      })
    }
  }
  return out
}

async function extractDriveSnapshotRows(input: {
  filePath: string
  title: string
  fileId?: string
  expectedBranch: string | null
  candidateSheets: string[]
}): Promise<TrackerRow[]> {
  const snapshot = JSON.parse(await readFile(input.filePath, 'utf8')) as {
    sheet?: string
    values?: unknown[][]
  }
  if (!snapshot.sheet || !input.candidateSheets.includes(snapshot.sheet)) return []
  const out: TrackerRow[] = []
  for (const [index, values] of (snapshot.values ?? []).entries()) {
    if (index === 0 || !Array.isArray(values)) continue
    const date = driveCellDate(values[0])
    const name = str(values[1])
    const vaccine = str(values[2])
    if (!date && !name && !vaccine) continue
    // Date-only stubs and repeated footer/header rows are evidence of sheet
    // structure, not administrations.
    if (!name && !vaccine) continue
    const normalized = {
      date,
      name,
      vaccine,
      route: str(values[3]),
      amount: num(values[6]),
      payment: str(values[7]),
      notes: str(values[8]),
    }
    out.push({
      envelope: {
        source: 'manual_sales_tracker',
        fileId: input.fileId,
        workbookTitle: input.title,
        workbookBranchLegacyId: input.expectedBranch ?? 'UNRESOLVED',
        sheet: snapshot.sheet,
        rowNumber: index + 1,
        rowHash: hashStable(normalized),
      },
      branchLegacyId: input.expectedBranch,
      ...normalized,
    })
  }
  return out
}

function driveCellDate(value: unknown): string | null {
  if (typeof value !== 'number') return dateOnly(value)
  const excelEpoch = Date.UTC(1899, 11, 30)
  return new Date(excelEpoch + value * 86_400_000).toISOString().slice(0, 10)
}

function findTrackerHeader(
  sheet: ExcelJS.Worksheet,
): { rowNumber: number; columns: Map<string, number> } | null {
  for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 12); rowNumber++) {
    const columns = new Map<string, number>()
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell, column) => {
      const key = normalizeHeader(cell.text)
      if (key) columns.set(key, column)
    })
    if (
      columns.has('date') &&
      columns.has('name') &&
      (columns.has('vaccine') || columns.has('medicalservice'))
    )
      return { rowNumber, columns }
  }
  return null
}

function readTrackerRow(
  row: ExcelJS.Row,
  header: { columns: Map<string, number> },
): Omit<TrackerRow, 'envelope' | 'branchLegacyId'> {
  const cell = (...aliases: string[]): unknown => {
    for (const alias of aliases) {
      const col = header.columns.get(alias)
      if (col) return row.getCell(col).value
    }
    return null
  }
  return {
    date: dateOnly(cell('date')),
    name: str(cell('name')),
    vaccine: str(cell('vaccine', 'medicalservice')),
    route: str(cell('route')),
    amount: num(cell('amount')),
    payment: str(cell('payment')),
    notes: str(cell('notes', 'note')),
  }
}

function buildBranchMap(source: SourceBundle): Map<string, string> {
  const map = new Map<string, string>()
  for (const branch of source.Branch) {
    const id = str(branch['Row ID'])
    if (!id) continue
    for (const value of [id, str(branch.b_Name)]) {
      const key = normalizeHeader(value ?? '')
      if (key) map.set(key, id)
    }
  }
  return map
}

function resolveBranch(map: ReadonlyMap<string, string>, value: string): string | null {
  return map.get(normalizeHeader(value)) ?? null
}

function candidateSheetsAreExplicit(candidateSheets: string[] | undefined): boolean {
  return (
    !!candidateSheets?.length && candidateSheets.every((sheet) => !/monthly|sheets$/i.test(sheet))
  )
}

async function inspectSnapshot(input: {
  key: string
  source: Snapshot['source']
  title: string
  fileId?: string
  filePath?: string
  expectedSha256?: string
}): Promise<Snapshot> {
  if (!input.filePath) return { ...input, present: false, hashMatchesExpected: null }
  try {
    await stat(input.filePath)
    const info = await stat(input.filePath)
    const actualSha256 = info.isDirectory()
      ? await sha256Directory(input.filePath)
      : await sha256File(input.filePath)
    return {
      key: input.key,
      source: input.source,
      title: input.title,
      fileId: input.fileId,
      expectedSha256: input.expectedSha256,
      actualSha256,
      present: true,
      hashMatchesExpected: input.expectedSha256 ? actualSha256 === input.expectedSha256 : null,
    }
  } catch {
    return { ...input, present: false, hashMatchesExpected: null }
  }
}

async function sha256Directory(directory: string): Promise<string> {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()
  const entries: string[] = []
  for (const name of names) entries.push(`${await sha256File(path.join(directory, name))}  ${name}`)
  return createHash('sha256')
    .update(`${entries.join('\n')}\n`)
    .digest('hex')
}

function parseManifest(raw: string): SourceManifest {
  const parsed = JSON.parse(raw) as Partial<SourceManifest>
  if (!parsed.appsheetDatabase)
    throw new Error('invalid source manifest: appsheetDatabase is required')
  return parsed as SourceManifest
}

function sourceCounts(source: SourceBundle): Record<string, number> {
  return Object.fromEntries(Object.entries(source).map(([key, rows]) => [key, rows.length]))
}

function loadPlanCounts(plan: LoadPlan): Record<keyof LoadPlan, number> {
  return Object.fromEntries(
    Object.entries(plan).map(([key, rows]) => [key, rows.length]),
  ) as Record<keyof LoadPlan, number>
}

function countEvents(events: CanonicalDoseEvent[]): {
  local: number
  external: number
  scheduled: number
} {
  return events.reduce(
    (counts, event) => {
      if (event.kind === 'local_administration') counts.local += 1
      if (event.kind === 'external_administration') counts.external += 1
      if (event.kind === 'scheduled_dose') counts.scheduled += 1
      return counts
    },
    { local: 0, external: 0, scheduled: 0 },
  )
}

function groupRemarks(
  source: SourceBundle,
): Map<string, Array<{ text: string; envelope: SourceEnvelope }>> {
  const result = new Map<string, Array<{ text: string; envelope: SourceEnvelope }>>()
  for (const row of source.Remarks) {
    const patientId = str(row.r_PatientRef)
    const text = str(row.r_Remarks)
    const rowId = str(row['Row ID'])
    if (!patientId || !text || !rowId) continue
    result.set(patientId, [
      ...(result.get(patientId) ?? []),
      { text, envelope: appsheetEnvelope('appsheet_remark', rowId) },
    ])
  }
  return result
}

function appsheetEnvelope(
  source: Extract<SourceEnvelope['source'], `appsheet_${string}`>,
  rowId: string,
): SourceEnvelope {
  return { source, rowId, rowHash: hashStable([source, rowId]) }
}

function serviceFromAppSheet(type: string | null, route: string | null): string | null {
  const base: Record<string, string> = {
    'Anti Rabies - PEP': 'ARVPEP',
    'Anti Rabies - PrEP': 'ARVPREP',
    'Anti Rabies - Booster': 'ARVBOOSTER',
    ERIG: 'ERIG',
    HRIG: 'HRIG',
    HTIG: 'HTIG',
    ATS: 'ATS',
    'Tetanus Toxoid': 'TT',
    TDAP: 'TDAP',
    Flu: 'FLU',
  }
  const code = type ? base[type] : undefined
  if (!code) return null
  const normalizedRoute = routeOf(route)
  return normalizedRoute && ['ARVPEP', 'ARVPREP', 'ARVBOOSTER'].includes(code)
    ? `${code}_${normalizedRoute}`
    : code
}

function serviceFromTracker(vaccine: string, route: string | null): string | null {
  const text = vaccine.toLowerCase()
  const normalizedRoute = routeOf(route)
  const matches: string[] = []
  if (/\berig\b/.test(text)) matches.push('ERIG')
  if (/\bhrig\b/.test(text)) matches.push('HRIG')
  if (/\bats\b/.test(text)) matches.push('ATS')
  if (/\b(?:tt|tetanus)\b/.test(text)) matches.push('TT')
  if (/\b(?:arv|anti[ -]?rabies)\b/.test(text)) {
    const base = /booster/i.test(text) ? 'ARVBOOSTER' : /prep/i.test(text) ? 'ARVPREP' : 'ARVPEP'
    if (!normalizedRoute) return null
    matches.push(`${base}_${normalizedRoute}`)
  }
  return matches.length === 1 ? matches[0]! : null
}

function routeOf(
  value: unknown,
): 'IM' | 'ID' | 'SC' | 'IV' | 'PO' | 'IN' | 'Topical' | 'INF' | undefined {
  const raw = str(value)?.toUpperCase()
  if (!raw) return undefined
  const found = raw.match(/\b(IM|ID|SC|IV|PO|IN|INF)\b/)?.[1]
  if (found && ['IM', 'ID', 'SC', 'IV', 'PO', 'IN', 'INF'].includes(found))
    return found as ReturnType<typeof routeOf>
  if (raw.includes('TOPICAL')) return 'Topical'
  return undefined
}

function extractDoseNumber(row: SrcImmunization): number | null {
  const label = str(row.i_Label)
  const inLabel = label?.match(/\b(\d+)(?:st|nd|rd|th)?\s+dose\b/i)?.[1]
  const fallback = num(row.i_DosageCount)
  return inLabel ? Number(inLabel) : fallback && Number.isInteger(fallback) ? fallback : null
}

function extractTrackerDose(vaccine: string): number | null {
  const match = vaccine.match(/\b(?:dose\s*)?(\d+)(?:st|nd|rd|th)?\b/i)
  return match ? Number(match[1]) : null
}

function transactionMatches(txn: SrcTransaction, patientId: string, date: string): boolean {
  return str(txn.t_PatientRef) === patientId && dateOnly(txn.t_Timestamp) === date
}

/**
 * E31's narrow non-exact match. A familiar name alone never qualifies: at
 * least two name tokens, workbook branch, date, a compatible administered
 * service, amount, and stated tender must agree with one patient visit.
 */
function resolveUniqueMultiFieldPatient(input: {
  name: string
  date: string
  branchLegacyId: string
  serviceId: string
  amount: number | null
  payment: string | null
  transactions: SrcTransaction[]
  immunizations: SrcImmunization[]
  patientIdsByToken: ReadonlyMap<string, ReadonlySet<string>>
  patientTokensById: ReadonlyMap<string, ReadonlySet<string>>
}): string[] {
  if (input.amount === null || !input.payment) return []
  const name = normalizeName(input.name)
  if (!name) return []
  const nameTokens = new Set(name.split(' ').filter((token) => token.length >= 3))
  const candidateIds = new Set<string>()
  for (const token of nameTokens)
    for (const id of input.patientIdsByToken.get(token) ?? []) candidateIds.add(id)
  const matching = [...candidateIds].filter((patientId) => {
    const tokens = input.patientTokensById.get(patientId) ?? new Set<string>()
    const sharedTokens = [...nameTokens].filter((token) => tokens.has(token)).length
    if (sharedTokens < 2) return false
    const compatibleAdministration = input.immunizations.some(
      (row) =>
        str(row.i_PatientRef) === patientId &&
        bool(row['i_IsAdministered?']) === true &&
        dateOnly(row.i_Timestamp_Actual) === input.date &&
        serviceFromAppSheet(str(row.i_VaccineType), str(row.i_VaccineRoute)) === input.serviceId,
    )
    if (!compatibleAdministration) return false
    return input.transactions.some(
      (txn) =>
        transactionMatches(txn, patientId, input.date) &&
        str(txn.t_BranchRef) === input.branchLegacyId &&
        transactionAmountMatches(txn, input.amount!) &&
        transactionTenderMatches(txn, input.payment!),
    )
  })
  return matching.length === 1 ? matching : []
}

function transactionAmountMatches(txn: SrcTransaction, amount: number): boolean {
  return [txn.t_TotalAmountPaid, txn.t_TotalAmount, txn.t_TransactionValue]
    .map(num)
    .some((candidate) => candidate !== null && Math.abs(candidate - amount) < 0.01)
}

function transactionTenderMatches(txn: SrcTransaction, payment: string): boolean {
  const normalized = payment.toLowerCase()
  const checks: Array<[RegExp, unknown]> = [
    [/cash/, txn.t_AmountPaid_Cash],
    [/(gcash|g-cash)/, txn.t_AmountPaid_GCash],
    [/bank/, txn.t_AmountPaid_BankTransfer],
    [/paymongo/, txn.t_AmountPaid_PayMongo],
  ]
  return checks.some(([pattern, amount]) => pattern.test(normalized) && (num(amount) ?? 0) > 0)
}

function pepCourseAnchors(rows: SrcImmunization[]): number {
  const sorted = rows
    .map((row) => ts(row.i_Timestamp_Actual))
    .filter((value): value is Date => !!value)
    .sort((a, b) => a.getTime() - b.getTime())
  if (sorted.length === 0) return 0
  let anchors = 1
  for (let index = 1; index < sorted.length; index++)
    if (sorted[index]!.getTime() - sorted[index - 1]!.getTime() > 60 * 86_400_000) anchors += 1
  return anchors
}

function eventKey(
  patientId: string,
  serviceId: string,
  date: string,
  doseNumber: number | null,
): string {
  return `${patientId}|${serviceId}|${date}|${doseNumber ?? 'unknown'}`
}

function normalizeName(value: string | null): string | null {
  if (!value) return null
  const parts = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return null
  return parts.sort().join(' ')
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function q(
  priority: QueuePriority,
  disposition: QueueDisposition,
  code: string,
  summary: string,
  sourceRefs: string[],
): SafeQueueItem {
  return { priority, disposition, code, summary, sourceRefs: [...new Set(sourceRefs)].sort() }
}

function sortQueue(queue: SafeQueueItem[]): SafeQueueItem[] {
  const priority = { P0: 0, P1: 1, P2: 2, P3: 3 }
  return [...queue].sort(
    (a, b) =>
      priority[a.priority] - priority[b.priority] ||
      a.code.localeCompare(b.code) ||
      a.sourceRefs.join(',').localeCompare(b.sourceRefs.join(',')),
  )
}

function queueCounts(queue: SafeQueueItem[]): Record<QueuePriority, number> {
  return queue.reduce(
    (counts, item) => ({ ...counts, [item.priority]: counts[item.priority] + 1 }),
    { P0: 0, P1: 0, P2: 0, P3: 0 } as Record<QueuePriority, number>,
  )
}

function safeEnvelopeRef(envelope: SourceEnvelope): string {
  return `${envelope.source}:${envelope.workbookTitle ? normalizeHeader(envelope.workbookTitle) : 'appsheet'}:${envelope.sheet ? normalizeHeader(envelope.sheet) : 'row'}:${envelope.rowNumber ?? safeToken(envelope.rowId ?? envelope.rowHash ?? 'unknown')}`
}

function safeAppSheetRef(kind: string, rowId: string): string {
  return `appsheet:${kind}:${safeToken(rowId)}`
}

function safeSnapshotRef(snapshot: Snapshot): string {
  return `source:${snapshot.source}:${normalizeHeader(snapshot.title)}:${safeToken(snapshot.fileId ?? snapshot.key)}`
}

function safeToken(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function hashStable(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path.resolve(filePath)))
    .digest('hex')
}

class Counter {
  private readonly values = new Map<string, number>()
  add(code: string): void {
    this.values.set(code, (this.values.get(code) ?? 0) + 1)
  }
  entries(): Array<{ code: string; count: number }> {
    return [...this.values.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => a.code.localeCompare(b.code))
  }
}
