/**
 * Comprehensive seed script — populates the database with realistic test data
 * for all UI pages.
 *
 * Usage:
 *   DATABASE_URL="<url>" npx tsx src/shared/db/seed.ts
 *
 * Idempotent: each section uses `onConflictDoNothing()` throughout.
 * Does NOT truncate — safe to re-run; new rows are skipped if already present.
 *
 * Two-tier IDs (W2 + W3, 2026-05-19):
 *   - Internal PKs are `bigserial`; FKs are `bigint`.
 *   - Each sub-seed `.returning()` chain captures the bigint and passes it
 *     forward to dependent seeds.
 *   - Public display IDs (`PAT_K9MX3VQ2` style) live on `display_id` text
 *     columns. Patient MRNs use `nextval('mrn_seq_<slug>')` for per-tenant
 *     sequential allocation.
 *
 * Wiring order: tenant+branches → users → platform → payers → partner-labs →
 *   catalog (needs payers) → patients → standing-orders → encounters
 *   → inventory (needs catalog.products) → transactions (uses services/payers)
 *   → lab-orders (soft-skip if no clinical orders) → shifts → audit
 */

import 'dotenv/config'
import bcrypt from 'bcrypt'
import { TENANT_SLUG } from './seed/constants.js'
import { client, setSeedTenantContext, setSeedUserBranchContext } from './seed/db.js'
import { seedTenantAndBranches } from './seed/tenant.js'
import { seedUsers } from './seed/users.js'
import { seedPatients } from './seed/patients.js'
import { seedPlatformUsers } from './seed/platform.js'
import { seedPayers } from './seed/payers.js'
import { seedPartnerLabs } from './seed/partner-labs.js'
import { seedCatalog } from './seed/catalog.js'
import { seedStandingOrders } from './seed/standing-orders.js'
import { seedEncounters } from './seed/encounters.js'
import { seedLabOrders } from './seed/lab-orders.js'
import { seedInventory } from './seed/inventory.js'
import { seedBranchWorkflows } from './seed/branch-workflows.js'
import { seedTransactions } from './seed/transactions.js'
import { seedShifts } from './seed/shifts.js'
import { seedAudit } from './seed/audit.js'
import { seedApprovals } from './seed/approvals.js'
import { seedRecalls } from './seed/recalls.js'
import { seedNotificationTemplates } from './seed/notification-templates.js'
import { seedAppointments } from './seed/appointments.js'
import { seedBiteIncidents } from './seed/bite-incidents.js'
import { seedAdverseEvents } from './seed/adverse-events.js'
import { seedInventoryTransfers } from './seed/inventory-transfers.js'
import { seedNotifications } from './seed/notifications.js'
import { seedPatientEmergencyContacts } from './seed/patient-extras.js'
import * as s from './schema.js'
import { db as seedDb } from './seed/db.js'

export async function seed() {
  console.log('🌱 Seeding database...')

  const passwordHash = await bcrypt.hash('TestPass123!', 12)
  // Default kiosk PIN for every seeded user. Lets staff exercise the
  // clock-in/out kiosk flow on a fresh seed without each user needing PIN
  // set via the admin UI first.
  const pinHash = await bcrypt.hash('1234', 12)

  // GUC bootstrap: the audit trigger needs app.current_tenant_id set before
  // any write to an audited tenant-scoped table. The user/branch GUCs stay
  // empty until the first user+branch land (RLS treats empty as "no filter").
  await setSeedTenantContext(TENANT_SLUG)

  // Foundation: tenant + provision_tenant_counters + every branch in the
  // clinic's `Branch` sheet.
  const { tenantId, branches, branchIdByCode } = await seedTenantAndBranches()

  // Users seed needs a branch to FK against. Use HST (default branch). The
  // code→id map additionally drives the per-branch kiosk logins and the real
  // nursing roster's branch assignments.
  const users = await seedUsers(passwordHash, pinHash, branches.hst, branchIdByCode)

  // Once we have a real user + branch, switch the session GUCs so later
  // audited writes carry a usable user/branch (RLS cast-to-bigint succeeds).
  await setSeedUserBranchContext(users.admin, branches.hst)

  // Admin User belongs to every seeded branch — TenantAdmins act tenant-wide
  // and the Inventory Transfer ship dialog scopes its source/destination
  // dropdowns to `user_branches`, so without these rows the dialog only
  // ever shows HST (and #22 in the preview-coverage doc is unverifiable).
  for (const [code, branchId] of Object.entries(branches)) {
    if (code === 'hst') continue
    await seedDb
      .insert(s.userBranches)
      .values({ tenantId, userId: users.admin, branchId })
      .onConflictDoNothing()
  }

  // platform_users is NOT tenant-scoped — no GUC needed but harmless.
  await seedPlatformUsers(passwordHash)

  // Payers + partner labs (independent reference data — feed catalog + lab-orders).
  const seededPayers = await seedPayers({ tenantId, createdById: users.admin })
  const seededPartnerLabs = await seedPartnerLabs({ tenantId, createdById: users.admin })

  // Catalog: products, categories, services, bundles, eligible products,
  // partner-rate service_prices. Returns the productsByCode / servicesByCode
  // maps consumed downstream by inventory + transactions.
  const seededCatalog = await seedCatalog({
    tenantId,
    createdById: users.admin,
    payers: seededPayers.byDisplayId,
  })

  // Patients (and their normalized allergies/conditions/tags). MRN allocated
  // per row via nextval('mrn_seq_svx').
  const seededPatients = await seedPatients({
    homeBranchId: branches.hst,
    // One seeded patient (Rivera) is homed at TMG instead: the fixture the
    // Cross-Branch PHI RFC masking checks (R3) need. Every other seeded
    // patient stays at HST.
    secondaryBranchId: branches.tim,
    createdById: users.nurse,
  })

  // Standing-order templates + items (W3.a.4). Templates have text-PK catalog
  // codes; items have bigserial PKs with `STI_…` display ids. Depends on
  // service_catalog (just seeded above) for the items.serviceId FK.
  await seedStandingOrders({ tenantId, createdById: users.physician })

  // Encounters (W3.a.2) — depend on patient bigints + branch + provider.
  // Also seeds PSO + clinical_orders + informed-consent rows for each
  // encounter (Rabies/Flu/Vaccination specialties). Returns a
  // Map<clinical_order display_id, bigint> consumed by seedLabOrders below.
  const seededEncounters = await seedEncounters({
    patients: seededPatients.byDisplayId,
    branchId: branches.hst,
    providerId: users.physician,
    createdById: users.nurse,
  })

  // Inventory lots + movements — needs products map from catalog.
  const seededInventory = await seedInventory({
    tenantId,
    branchId: branches.hst,
    performedById: users.admin,
    products: seededCatalog.productsByCode,
  })
  void seededInventory // lots resolved by batch number in seedInventoryTransfers

  // Per-branch workflow top-up (nurse-testing-readiness R6/R9): every branch
  // besides HST got zero patients, zero due-today doses, and zero stock.
  // Gives each one a patient, a dose due today, the stock for it, and a paid
  // transaction, so a nurse at any branch's kiosk has something to test.
  await seedBranchWorkflows({
    tenantId,
    branchIdByCode,
    products: seededCatalog.productsByCode,
    providerId: users.physician,
    nurseId: users.nurse,
    cashierId: users.cashier,
  })

  // Transactions (W3.a.3): now wires services + payers from upstream seeds.
  await seedTransactions({
    tenantId,
    patients: seededPatients.byDisplayId,
    branchId: branches.hst,
    createdById: users.cashier,
    adminId: users.admin,
    physicianId: users.physician,
    services: seededCatalog.servicesByCode,
    payers: seededPayers.byDisplayId,
    // clinicalOrders intentionally omitted — encounters seed soft-skips
    // clinical_order rows pending the W3 PSO chain.
  })

  // Lab orders — consume the clinical_order map from seedEncounters.
  await seedLabOrders({
    tenantId,
    branchId: branches.hst,
    createdById: users.physician,
    partnerLabs: seededPartnerLabs.byCode,
    encounters: seededEncounters.clinicalOrdersByKey,
  })

  // Shifts (staff_time_logs + cash_drawer + day_summary samples).
  await seedShifts({
    tenantId,
    branchId: branches.hst,
    users: {
      admin: users.admin,
      physician: users.physician,
      nurse: users.nurse,
      cashier: users.cashier,
    },
  })

  // Approvals + recalls — admin-surface fixtures the preview walk needs.
  await seedApprovals({ tenantId, branchId: branches.hst, requestedById: users.cashier })
  await seedRecalls({ tenantId, createdById: users.admin })
  await seedNotificationTemplates({ tenantId, createdById: users.admin })

  // Patient emergency contacts — fill the patient-detail next-of-kin block.
  await seedPatientEmergencyContacts({
    tenantId,
    patients: seededPatients.byDisplayId,
    createdById: users.nurse,
  })

  // Appointments — the scheduling board (today + the coming week + history).
  await seedAppointments({
    tenantId,
    patients: seededPatients.byDisplayId,
    branchId: branches.hst,
    providerId: users.physician,
    createdById: users.cashier,
  })

  // Bite incidents + animal observation follow-ups (rabies intake + 14-day obs).
  await seedBiteIncidents({
    tenantId,
    patients: seededPatients.byDisplayId,
    recordedById: users.nurse,
  })

  // Adverse events (AEFI) — linked to administered clinical orders/encounters.
  await seedAdverseEvents({
    tenantId,
    patients: seededPatients.byDisplayId,
    encounters: seededEncounters.byKey,
    clinicalOrders: seededEncounters.clinicalOrdersByKey,
    reportedById: users.physician,
  })

  // Inter-branch inventory transfers (PendingReceipt / Received / Cancelled).
  await seedInventoryTransfers({
    tenantId,
    sourceBranchId: branches.hst,
    destinationBranches: {
      tim: branches.tim,
      tag: branches.tag,
      abf: branches.abf,
      psg: branches.psg,
    },
    shippedById: users.admin,
    receivedById: users.admin,
  })

  // Notification log + reminder queue (SMS/Email, Sent/Queued/Failed).
  await seedNotifications({
    tenantId,
    patients: seededPatients.byDisplayId,
    createdById: users.admin,
  })

  // Audit log samples.
  await seedAudit({
    tenantId,
    branchId: branches.hst,
    users: {
      admin: users.admin,
      physician: users.physician,
      nurse: users.nurse,
      cashier: users.cashier,
    },
    patients: seededPatients.byDisplayId,
  })

  console.log('\n✅ Seed complete — all sub-seeds wired (foundation + catalog + clinical chain).')

  // Close the seed's connection pool. When seed() is imported (e.g. tests),
  // leaving postgres-js handles open prevents the process from exiting.
  await client.end()
}

// Auto-run only when invoked directly via tsx / node, not when imported.
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1] ?? '')

if (invokedDirectly) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err)
      process.exit(1)
    })
}
