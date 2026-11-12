import { sql, type SQL } from 'drizzle-orm'

/**
 * Which products satisfy an abstract service — the one definition.
 *
 * A `service_catalog` row is an abstract orderable entity (`ARVPEP_IM`), not a
 * SKU. Two paths map it to physical products:
 *
 *   A. Legacy 1:1 — `service_catalog.product_id` references the only product
 *      that satisfies the service.
 *   B. Junction (0016) — `service_eligible_products` lists every product that
 *      clinically satisfies it (ARV PEP IM ← Abhayrab OR Speeda). Abstract
 *      services carry a NULL `service_catalog.product_id` and rely entirely on
 *      this table.
 *
 * The UNION of both is the eligibility set. This used to be copy-pasted in
 * three places and drifted: the arrivals Day-0 preview joined on `product_id`
 * alone, so every abstract service falsely read "No lots in stock". Anything
 * that resolves lots for a service MUST go through this helper.
 */
export function eligibleProductIdsSql(tenantId: string, serviceId: string): SQL {
  return sql`(
    SELECT sc.product_id
    FROM service_catalog sc
    WHERE sc.id = ${serviceId}
      AND sc.tenant_id = ${tenantId}
      AND sc.product_id IS NOT NULL
    UNION
    SELECT sep.product_id
    FROM service_eligible_products sep
    WHERE sep.service_id = ${serviceId}
      AND sep.tenant_id  = ${tenantId}
  )`
}
