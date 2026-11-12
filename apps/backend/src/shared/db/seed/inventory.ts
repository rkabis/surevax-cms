/**
 * Seed section: inventory lots.
 *
 * Two-tier IDs (W3.b.1):
 *   - inventory_lots.id is bigserial; display_id = `LOT_<8 base32>`
 *     (deterministic in seed so downstream movements can FK by bigint).
 *   - branchId / createdById are bigints.
 *   - products map is optional: if absent (catalog seed not yet wired),
 *     this function logs a soft-skip notice and returns an empty map.
 *     Once W3.b.4 lands the catalog seed, the orchestrator passes the
 *     product map and the lots seed runs.
 *
 * Returns `{ byDisplayId: Map<displayId, bigint> }` so downstream seeds
 * (movements, recalls, transfers) can resolve lot FKs without re-querying.
 */

import { and, eq } from 'drizzle-orm'
import * as s from '../schema.js'
import { db } from './db.js'
import { dateStr, daysAgo, daysFromNow, seqSuffix } from './helpers.js'
import { displayId } from '../../utils/displayId.js'

type LotSeed = {
  displayId: string
  manufacturer: string // key into products map (`Abhayrab`, `Equirab`, etc.)
  batchNumber: string
  expiryDate: string // YYYY-MM-DD
  quantityOnHand: string
  quantityReceived: string
  supplierName: string
  receivedAt: Date
  isQuarantined?: boolean
  quarantineReason?: string
}

// Expiry horizon for stock that must survive a multi-week pilot without a
// nurse ever hitting a stock-out or a silently-expired lot: 540-730 days out,
// computed relative to seed run time (never a hardcoded absolute date; see
// the historical lot-1 bug this replaces). Negative-fixture lots use
// `daysAgo(...)` instead, so they stay deliberately expired no matter when the
// seed runs.
const LOT_ROWS: LotSeed[] = [
  // Abhayrab: anti-rabies house brand (ARVPEP/PREP/BOOSTER pool, shared with
  // Speeda below). Lot 1 is deliberately small: demonstrates a low-but-in-date
  // lot alongside the bulk lot 2, which now carries hundreds of units so the
  // whole pool cannot be exhausted during a pilot.
  {
    displayId: `LOT_${seqSuffix(1, 8).toUpperCase()}`,
    manufacturer: 'Abhayrab',
    batchNumber: 'VRB-2026-001',
    expiryDate: dateStr(daysFromNow(545)),
    quantityOnHand: '5',
    quantityReceived: '50',
    supplierName: 'Sanofi Pasteur',
    receivedAt: new Date('2026-01-15'),
  },
  {
    displayId: `LOT_${seqSuffix(2, 8).toUpperCase()}`,
    manufacturer: 'Abhayrab',
    batchNumber: 'VRB-2026-003',
    expiryDate: dateStr(daysFromNow(650)),
    quantityOnHand: '400',
    quantityReceived: '400',
    supplierName: 'Sanofi Pasteur',
    receivedAt: new Date('2026-03-20'),
  },
  {
    displayId: `LOT_${seqSuffix(3, 8).toUpperCase()}`,
    manufacturer: 'Equirab',
    batchNumber: 'ERI-2026-004',
    expiryDate: dateStr(daysFromNow(560)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'Chengdu Institute',
    receivedAt: new Date('2026-02-10'),
  },
  {
    displayId: `LOT_${seqSuffix(4, 8).toUpperCase()}`,
    manufacturer: 'Berirab',
    batchNumber: 'HRI-2026-002',
    expiryDate: dateStr(daysFromNow(620)),
    quantityOnHand: '300',
    quantityReceived: '300',
    supplierName: 'Grifols',
    receivedAt: new Date('2026-01-25'),
  },
  // Intentional negative fixture #1: expired plus quarantined. `daysAgo(...)`
  // keeps it deliberately expired forever, instead of an absolute date that
  // happened to already be in the past at authoring time.
  {
    displayId: `LOT_${seqSuffix(5, 8).toUpperCase()}`,
    manufacturer: 'Vaxigrip Tetra',
    batchNumber: 'FLU-2026-010',
    expiryDate: dateStr(daysAgo(60)),
    quantityOnHand: '0',
    quantityReceived: '30',
    supplierName: 'Abbott',
    receivedAt: new Date('2025-10-05'),
    isQuarantined: true,
    quarantineReason: 'Expired: awaiting disposal authorization',
  },
  // Intentional negative fixture #2: matched by an active product recall
  // (recalls.ts batch pattern `FLU-2026-`) but deliberately NOT quarantined.
  {
    displayId: `LOT_${seqSuffix(6, 8).toUpperCase()}`,
    manufacturer: 'Vaxigrip Tetra',
    batchNumber: 'FLU-2026-012',
    expiryDate: dateStr(daysFromNow(580)),
    quantityOnHand: '22',
    quantityReceived: '30',
    supplierName: 'Abbott',
    receivedAt: new Date('2026-04-10'),
  },
  {
    displayId: `LOT_${seqSuffix(7, 8).toUpperCase()}`,
    manufacturer: 'AbhayTox',
    batchNumber: 'TT-2026-007',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '300',
    quantityReceived: '300',
    supplierName: 'Bio Farma',
    receivedAt: new Date('2026-04-01'),
  },
  // Intentional negative fixture #3: near-expiry plus quarantined. Same
  // relative-past treatment as fixture #1.
  {
    displayId: `LOT_${seqSuffix(8, 8).toUpperCase()}`,
    manufacturer: 'Abhayrab',
    batchNumber: 'VRB-2025-099',
    expiryDate: dateStr(daysAgo(30)),
    quantityOnHand: '1',
    quantityReceived: '50',
    supplierName: 'Sanofi Pasteur',
    receivedAt: new Date('2025-06-15'),
    isQuarantined: true,
    quarantineReason: 'Near expiry: review for disposal',
  },
  {
    displayId: `LOT_${seqSuffix(9, 8).toUpperCase()}`,
    manufacturer: 'Berirab',
    batchNumber: 'HRI-2027-001',
    expiryDate: dateStr(daysFromNow(700)),
    quantityOnHand: '5',
    quantityReceived: '5',
    supplierName: 'Grifols',
    receivedAt: new Date('2026-04-20'),
  },
  {
    displayId: `LOT_${seqSuffix(10, 8).toUpperCase()}`,
    manufacturer: 'Equirab',
    batchNumber: 'ERI-2026-009',
    expiryDate: dateStr(daysFromNow(660)),
    quantityOnHand: '250',
    quantityReceived: '250',
    supplierName: 'Chengdu Institute',
    receivedAt: new Date('2026-04-15'),
  },
  // Second anti-rabies BRAND, so the administer picker has a real choice for
  // ARV PEP (Abhayrab is the house brand, Speeda the alternative; see
  // ELIGIBLE_PAIRS in seed/catalog.ts). Deliberately expires BEFORE the
  // in-stock Abhayrab lot: the picker still lists the house brand first, which
  // is the ordering rule made visible.
  {
    displayId: `LOT_${seqSuffix(11, 8).toUpperCase()}`,
    manufacturer: 'Speeda',
    batchNumber: 'SPD-2026-021',
    expiryDate: dateStr(daysFromNow(560)),
    quantityOnHand: '300',
    quantityReceived: '300',
    supplierName: 'Liaoning Chengda',
    receivedAt: new Date('2026-05-02'),
  },
  // Premium flu brand alongside the Vaxigrip lots: exercises brand pricing on
  // a non-rabies service.
  {
    displayId: `LOT_${seqSuffix(12, 8).toUpperCase()}`,
    manufacturer: 'Fluarix Tetra',
    batchNumber: 'FLX-2026-004',
    expiryDate: dateStr(daysFromNow(590)),
    quantityOnHand: '12',
    quantityReceived: '15',
    supplierName: 'GSK',
    receivedAt: new Date('2026-05-18'),
  },
  // ATS + HTIG: WHO Category III bite-pathway adjuncts that previously had
  // ZERO eligible stock anywhere (no lot existed at all), so `/eligible-lots`
  // returned empty and the nurse could not administer them even in principle.
  {
    displayId: `LOT_${seqSuffix(13, 8).toUpperCase()}`,
    manufacturer: 'Antitet',
    batchNumber: 'ATS-2026-001',
    expiryDate: dateStr(daysFromNow(630)),
    quantityOnHand: '250',
    quantityReceived: '250',
    supplierName: 'Bio Farma',
    receivedAt: daysAgo(90),
  },
  {
    displayId: `LOT_${seqSuffix(14, 8).toUpperCase()}`,
    manufacturer: 'Sero-Tet',
    batchNumber: 'HTG-2026-001',
    expiryDate: dateStr(daysFromNow(630)),
    quantityOnHand: '250',
    quantityReceived: '250',
    supplierName: 'Green Cross',
    receivedAt: daysAgo(90),
  },
  // Token stock for the remaining non-rabies vaccines that had ZERO eligible
  // stock. Deliberately small (not the "few hundred" tier above). General
  // inventory stays deprioritized, this just stops a nurse from hitting a dead
  // end clicking any of these during the pilot. One lot per service's
  // default-ranked brand (ELIGIBLE_PAIRS in seed/catalog.ts); Varivax covers
  // both VARICELLA_SC and VARICELLA_IM, and GeneVac (seeded for HEPB_05) also
  // covers HEPB_10's fallback ranking.
  {
    displayId: `LOT_${seqSuffix(15, 8).toUpperCase()}`,
    manufacturer: 'Euvichol',
    batchNumber: 'TOK-2026-001',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'EuBiologics',
    receivedAt: daysAgo(45),
  },
  {
    displayId: `LOT_${seqSuffix(16, 8).toUpperCase()}`,
    manufacturer: 'Typbar',
    batchNumber: 'TOK-2026-002',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'Bharat Biotech',
    receivedAt: daysAgo(45),
  },
  {
    displayId: `LOT_${seqSuffix(17, 8).toUpperCase()}`,
    manufacturer: 'Mevac A',
    batchNumber: 'TOK-2026-003',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'LG Chem',
    receivedAt: daysAgo(45),
  },
  {
    displayId: `LOT_${seqSuffix(18, 8).toUpperCase()}`,
    manufacturer: 'GeneVac',
    batchNumber: 'TOK-2026-004',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'LG Chem',
    receivedAt: daysAgo(45),
  },
  {
    displayId: `LOT_${seqSuffix(19, 8).toUpperCase()}`,
    manufacturer: 'GenVac B Adult',
    batchNumber: 'TOK-2026-005',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'Green Cross',
    receivedAt: daysAgo(45),
  },
  {
    displayId: `LOT_${seqSuffix(20, 8).toUpperCase()}`,
    manufacturer: 'Gardasil 4',
    batchNumber: 'TOK-2026-006',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'MSD',
    receivedAt: daysAgo(45),
  },
  {
    displayId: `LOT_${seqSuffix(21, 8).toUpperCase()}`,
    manufacturer: 'Gardasil 9',
    batchNumber: 'TOK-2026-007',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'MSD',
    receivedAt: daysAgo(45),
  },
  {
    displayId: `LOT_${seqSuffix(22, 8).toUpperCase()}`,
    manufacturer: 'MMR 2',
    batchNumber: 'TOK-2026-008',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'MSD',
    receivedAt: daysAgo(45),
  },
  {
    displayId: `LOT_${seqSuffix(23, 8).toUpperCase()}`,
    manufacturer: 'Boostrix',
    batchNumber: 'TOK-2026-009',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'GSK',
    receivedAt: daysAgo(45),
  },
  {
    displayId: `LOT_${seqSuffix(24, 8).toUpperCase()}`,
    manufacturer: 'Shingrix',
    batchNumber: 'TOK-2026-010',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'GSK',
    receivedAt: daysAgo(45),
  },
  {
    displayId: `LOT_${seqSuffix(25, 8).toUpperCase()}`,
    manufacturer: 'Varivax',
    batchNumber: 'TOK-2026-011',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'MSD',
    receivedAt: daysAgo(45),
  },
  {
    displayId: `LOT_${seqSuffix(26, 8).toUpperCase()}`,
    manufacturer: 'Prevenar 13',
    batchNumber: 'TOK-2026-012',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'Pfizer',
    receivedAt: daysAgo(45),
  },
  {
    displayId: `LOT_${seqSuffix(27, 8).toUpperCase()}`,
    manufacturer: 'Prevenar 20',
    batchNumber: 'TOK-2026-013',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'Pfizer',
    receivedAt: daysAgo(45),
  },
  {
    displayId: `LOT_${seqSuffix(28, 8).toUpperCase()}`,
    manufacturer: 'Pneumovax 23',
    batchNumber: 'TOK-2026-014',
    expiryDate: dateStr(daysFromNow(600)),
    quantityOnHand: '20',
    quantityReceived: '20',
    supplierName: 'MSD',
    receivedAt: daysAgo(45),
  },
]

export async function seedInventory(opts: {
  tenantId: string
  branchId: number
  performedById: number
  /** displayId-keyed map from the catalog seed: manufacturer name → product bigint. */
  products?: Map<string, number>
}): Promise<{ byDisplayId: Map<string, number> }> {
  const byDisplayId = new Map<string, number>()

  if (!opts.products || opts.products.size === 0) {
    console.log('  ↷ inventory lots (skipped: products map not provided)')
    return { byDisplayId }
  }

  let inserted = 0
  let skipped = 0

  for (const lot of LOT_ROWS) {
    const productId = opts.products.get(lot.manufacturer)
    if (productId === undefined) {
      // Catalog row absent: soft-skip (keeps the seed resilient when the
      // catalog wave hasn't seeded every manufacturer).
      skipped++
      continue
    }

    const [row] = await db
      .insert(s.inventoryLots)
      .values({
        displayId: lot.displayId,
        tenantId: opts.tenantId,
        branchId: opts.branchId,
        productId,
        batchNumber: lot.batchNumber,
        manufacturer: lot.supplierName,
        expiryDate: lot.expiryDate,
        quantityOnHand: lot.quantityOnHand,
        quantityReceived: lot.quantityReceived,
        unitCost: '100.0000',
        isQuarantined: lot.isQuarantined ?? false,
        quarantineReason: lot.quarantineReason ?? null,
        supplierName: lot.supplierName,
        receivedAt: lot.receivedAt,
        createdById: opts.performedById,
      })
      .onConflictDoNothing()
      .returning({ id: s.inventoryLots.id, displayId: s.inventoryLots.displayId })

    if (row) {
      byDisplayId.set(row.displayId, row.id)
      inserted++
      // Seed an initial Receipt movement so the maintain_lot_balances trigger
      // populates inventory_lot_balances (INV-2 fix). Without this, the UI
      // reads balanceQuantityOnHand = '0' and the first administer produces a
      // -1 balance → CHECK 23514 → 409.
      await db
        .insert(s.inventoryMovements)
        .values({
          displayId: displayId('MVT'),
          tenantId: opts.tenantId,
          lotId: row.id,
          branchId: opts.branchId,
          movementType: 'In',
          quantityDelta: lot.quantityOnHand,
          unitCostSnapshot: '100.0000',
          notes: 'Initial stock receipt (seed)',
          performedById: opts.performedById,
          createdById: opts.performedById,
        })
        .onConflictDoNothing()
      continue
    }

    // onConflictDoNothing returned nothing: re-query so idempotent reruns
    // keep the map populated.
    const [existing] = await db
      .select({ id: s.inventoryLots.id, displayId: s.inventoryLots.displayId })
      .from(s.inventoryLots)
      .where(
        and(
          eq(s.inventoryLots.tenantId, opts.tenantId),
          eq(s.inventoryLots.displayId, lot.displayId),
        ),
      )
      .limit(1)
    if (existing) byDisplayId.set(existing.displayId, existing.id)
  }

  const skipSuffix = skipped > 0 ? `: ${skipped} skipped (missing product)` : ''
  console.log(`  ✓ inventory lots (${inserted}/${LOT_ROWS.length})${skipSuffix}`)
  return { byDisplayId }
}
