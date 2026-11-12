/**
 * Contract registry — every module contract the generator emits.
 *
 * Adding a module: create `src/modules/<module>/contract.ts` (schemas +
 * defineContract manifest), import it here, append to the array. Keep the
 * array alphabetized by feature name.
 */
import type { ContractDef } from './defineContract.js'
import { adverseEventsContract } from '../modules/adverse_events/contract.js'
import { appointmentsContract } from '../modules/appointments/contract.js'
import { arrivalsContract } from '../modules/arrivals/contract.js'
import { biteIncidentsContract } from '../modules/bite_incidents/contract.js'
import { dashboardContract } from '../modules/dashboard/contract.js'
import { daySummaryContract } from '../modules/day_summary/contract.js'
import { encountersContract } from '../modules/encounters/contract.js'
import { groupBillingContract } from '../modules/group_billing/contract.js'
import { inventoryContract } from '../modules/inventory/contract.js'
import { inventoryTransfersContract } from '../modules/inventory_transfers/contract.js'
import { labOrdersContract } from '../modules/lab_orders/contract.js'
import { notificationsContract } from '../modules/notifications/contract.js'
import { patientAccountsContract } from '../modules/patient_accounts/contract.js'
import { patientsContract } from '../modules/patients/contract.js'
import { reviewCenterContract } from '../modules/review_center/contract.js'
import { reportsContract } from '../modules/reports/contract.js'
import { scheduledOrdersContract } from '../modules/scheduled_orders/contract.js'
import { standingOrdersContract } from '../modules/standing_orders/contract.js'
import { transactionsContract } from '../modules/transactions/contract.js'

export const contracts: ContractDef[] = [
  adverseEventsContract,
  appointmentsContract,
  arrivalsContract,
  biteIncidentsContract,
  dashboardContract,
  daySummaryContract,
  encountersContract,
  groupBillingContract,
  inventoryContract,
  inventoryTransfersContract,
  labOrdersContract,
  notificationsContract,
  patientAccountsContract,
  patientsContract,
  reviewCenterContract,
  reportsContract,
  scheduledOrdersContract,
  standingOrdersContract,
  transactionsContract,
]
