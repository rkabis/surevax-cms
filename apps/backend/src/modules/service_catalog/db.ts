import { and, asc, eq, ilike, isNull, isNotNull, lte, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { withTenantTx } from '../../shared/db/withTenantTx.js'
import {
  products,
  serviceCatalog,
  serviceCategories,
  servicePrices,
  users,
} from '../../shared/db/schema.js'
import { resolveServicePrice } from '../../shared/lib/pricing.js'
import { catalogCode, displayId } from '../../shared/utils/displayId.js'

type Tx = Parameters<Parameters<typeof withTenantTx>[1]>[0]

/**
 * Resolve a flat category name to a service_categories row (auto-create at
 * the root level if absent). Backward-compat shim: the API still accepts
 * `category` text, but the data model stores `category_id`. Hierarchy
 * (parent_id) is set via a dedicated categories UI in a follow-up.
 *
 * Returns the internal bigint PK of the resolved/created category row.
 */
async function upsertCategoryByName(
  tx: Tx,
  tenantId: string,
  userId: number | null,
  name: string,
): Promise<number> {
  const [existing] = await tx
    .select({ id: serviceCategories.id })
    .from(serviceCategories)
    .where(
      and(
        eq(serviceCategories.tenantId, tenantId),
        eq(serviceCategories.name, name),
        isNull(serviceCategories.parentId),
        isNull(serviceCategories.deletedAt),
      ),
    )
    .limit(1)
  if (existing) return existing.id

  const [inserted] = await tx
    .insert(serviceCategories)
    .values({
      displayId: displayId('CAT'),
      tenantId,
      parentId: null,
      name,
      createdById: userId,
    })
    .returning({ id: serviceCategories.id })
  return inserted!.id
}

type RlsCtx = {
  /** Tenant slug (text PK). */
  tenantId: string
  /** users.id bigint, or null when unauthenticated path. */
  userId: number | null
  /** branches.id bigint, or null for cross-branch. */
  branchId: number | null
}

function txCtx(ctx: RlsCtx) {
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId ?? 0,
    branchId: ctx.branchId,
  }
}

export async function listServices(ctx: RlsCtx, q: string | undefined) {
  // Exclude inactive rows (hidden panel constituents — bundle fan-out still
  // resolves them server-side, but they should NOT appear in the orderable-
  // services picker).
  const conditions = [
    eq(serviceCatalog.tenantId, ctx.tenantId),
    isNull(serviceCatalog.deletedAt),
    eq(serviceCatalog.isActive, true),
  ]

  if (q) {
    conditions.push(or(ilike(serviceCatalog.name, `%${q}%`), ilike(serviceCatalog.code, `%${q}%`))!)
  }

  return withTenantTx(txCtx(ctx), async (tx) => {
    const rows = await tx
      .select({
        // service_catalog.id is the raw catalog code (text PK) — surface as-is.
        id: serviceCatalog.id,
        code: serviceCatalog.code,
        sku: serviceCatalog.sku,
        name: serviceCatalog.name,
        serviceType: serviceCatalog.serviceType,
        // category is now derived from category_id → service_categories.name.
        // Kept on the wire for backward compat with the existing UI.
        category: serviceCategories.name,
        isVatExempt: serviceCatalog.isVatExempt,
        requiresStock: serviceCatalog.requiresStock,
        requiresRx: serviceCatalog.requiresRx,
        isActive: serviceCatalog.isActive,
        // Phase 2: effective price from service_prices (catch-all row)
        effectivePrice: servicePrices.unitPrice,
        // Phase 2: clinical-coding columns
        cvxCode: serviceCatalog.cvxCode,
        ndcCode: serviceCatalog.ndcCode,
        cptCode: serviceCatalog.cptCode,
        loincCode: serviceCatalog.loincCode,
        defaultRoute: serviceCatalog.defaultRoute,
        defaultDoseVolumeMl: serviceCatalog.defaultDoseVolumeMl,
        defaultManufacturer: serviceCatalog.defaultManufacturer,
        requiresConsent: serviceCatalog.requiresConsent,
        requiresVis: serviceCatalog.requiresVis,
      })
      .from(serviceCatalog)
      .leftJoin(serviceCategories, eq(serviceCatalog.categoryId, serviceCategories.id))
      // LEFT JOIN catch-all service_prices row (branch=null, payer=null,
      // product=null, effectiveFrom<=today). The product=null predicate is
      // load-bearing: without it a brand-specific row joins too and the
      // service fans out into one list row per priced brand.
      .leftJoin(
        servicePrices,
        and(
          eq(servicePrices.serviceId, serviceCatalog.id),
          eq(servicePrices.tenantId, serviceCatalog.tenantId),
          isNull(servicePrices.branchId),
          isNull(servicePrices.payerId),
          isNull(servicePrices.productId),
          isNull(servicePrices.deletedAt),
          lte(servicePrices.effectiveFrom, sql`CURRENT_DATE`),
          or(isNull(servicePrices.effectiveTo), sql`${servicePrices.effectiveTo} >= CURRENT_DATE`)!,
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(serviceCatalog.name))
      .limit(200)

    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      sku: r.sku,
      name: r.name,
      serviceType: r.serviceType,
      category: r.category,
      // basePrice column dropped Phase 4. effectivePrice is the only price field.
      basePrice: r.effectivePrice ?? '0.00', // legacy alias for API consumers
      effectivePrice: r.effectivePrice ?? '0.00',
      isVatExempt: r.isVatExempt,
      requiresStock: r.requiresStock,
      requiresRx: r.requiresRx,
      isActive: r.isActive,
      // Phase 2: clinical-coding columns
      cvxCode: r.cvxCode,
      ndcCode: r.ndcCode,
      cptCode: r.cptCode,
      loincCode: r.loincCode,
      defaultRoute: r.defaultRoute,
      defaultDoseVolumeMl: r.defaultDoseVolumeMl, // numeric → string
      defaultManufacturer: r.defaultManufacturer,
      requiresConsent: r.requiresConsent,
      requiresVis: r.requiresVis,
    }))
  })
}

export type CreateServiceInput = {
  code: string
  sku?: string | null
  name: string
  serviceType?: string
  category?: string | null
  basePrice: string // numeric serialises as string
  isVatExempt?: boolean
  requiresStock?: boolean
  requiresRx?: boolean
  requiresConsent?: boolean
  requiresVis?: boolean
}

export async function createService(ctx: RlsCtx, input: CreateServiceInput) {
  return withTenantTx(txCtx(ctx), async (tx) => {
    // service_catalog.id is the raw catalog code (text PK, no displayId() wrap).
    const normalizedCode = input.code.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
    const serviceId = catalogCode(normalizedCode)

    const categoryId = input.category
      ? await upsertCategoryByName(tx, ctx.tenantId, ctx.userId ?? null, input.category)
      : null

    // 1. Insert service_catalog row (Phase 4: base_price column dropped — price lives only in service_prices).
    await tx.insert(serviceCatalog).values({
      id: serviceId,
      tenantId: ctx.tenantId,
      code: input.code,
      sku: input.sku ?? null,
      name: input.name,
      serviceType: (input.serviceType ?? 'Vaccine') as
        | 'Vaccine'
        | 'Consultation'
        | 'Lab'
        | 'Procedure'
        | 'Product',
      categoryId,
      isVatExempt: input.isVatExempt ?? false,
      requiresStock: input.requiresStock ?? false,
      requiresRx: input.requiresRx ?? false,
      requiresConsent: input.requiresConsent ?? false,
      requiresVis: input.requiresVis ?? false,
      createdById: ctx.userId ?? null,
    })

    // 2. Insert catch-all service_prices row (tenant-wide, no branch/payer/brand override).
    await tx.insert(servicePrices).values({
      displayId: displayId('SVP'),
      tenantId: ctx.tenantId,
      serviceId,
      branchId: null,
      payerId: null,
      productId: null,
      patientSegment: null,
      unitPrice: input.basePrice,
      currency: 'PHP',
      effectiveFrom: '-infinity',
      effectiveTo: null,
      createdById: ctx.userId ?? null,
    })

    return { id: serviceId }
  })
}

export type UpdateServiceInput = {
  name?: string
  sku?: string | null
  serviceType?: 'Vaccine' | 'Consultation' | 'Lab' | 'Procedure' | 'Product'
  category?: string | null
  isVatExempt?: boolean
  requiresStock?: boolean
  requiresRx?: boolean
  requiresConsent?: boolean
  requiresVis?: boolean
  isActive?: boolean
  basePrice?: string // when present, triggers dual-write to service_prices
}

export async function updateService(ctx: RlsCtx, id: string, input: UpdateServiceInput) {
  return withTenantTx(txCtx(ctx), async (tx) => {
    // Verify service belongs to this tenant
    const [existing] = await tx
      .select({ id: serviceCatalog.id })
      .from(serviceCatalog)
      .where(
        and(
          eq(serviceCatalog.id, id),
          eq(serviceCatalog.tenantId, ctx.tenantId),
          isNull(serviceCatalog.deletedAt),
        ),
      )
      .limit(1)

    if (!existing) return null

    // Build catalog update object — only include fields that were provided
    const catalogUpdates: Partial<typeof serviceCatalog.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (input.name !== undefined) catalogUpdates.name = input.name
    if (input.sku !== undefined) catalogUpdates.sku = input.sku
    if (input.serviceType !== undefined) catalogUpdates.serviceType = input.serviceType
    if (input.category !== undefined) {
      catalogUpdates.categoryId = input.category
        ? await upsertCategoryByName(tx, ctx.tenantId, ctx.userId ?? null, input.category)
        : null
    }
    if (input.isVatExempt !== undefined) catalogUpdates.isVatExempt = input.isVatExempt
    if (input.requiresStock !== undefined) catalogUpdates.requiresStock = input.requiresStock
    if (input.requiresRx !== undefined) catalogUpdates.requiresRx = input.requiresRx
    if (input.requiresConsent !== undefined) catalogUpdates.requiresConsent = input.requiresConsent
    if (input.requiresVis !== undefined) catalogUpdates.requiresVis = input.requiresVis
    if (input.isActive !== undefined) catalogUpdates.isActive = input.isActive

    if (input.basePrice !== undefined) {
      // Price change: rotate the active service_prices row (Phase 4 — base_price dropped).
      const now = new Date().toISOString()

      // b) Supersede the active tenant-wide catch-all row by setting effective_to = now
      await tx
        .update(servicePrices)
        .set({ effectiveTo: now, updatedAt: new Date() })
        .where(
          and(
            eq(servicePrices.serviceId, id),
            eq(servicePrices.tenantId, ctx.tenantId),
            isNull(servicePrices.branchId),
            isNull(servicePrices.payerId),
            // Only the brand-agnostic row rotates. Without this a base-price
            // edit would also close every brand-specific row for the service.
            isNull(servicePrices.productId),
            isNull(servicePrices.deletedAt),
            isNotNull(servicePrices.effectiveFrom), // safety guard
            isNull(servicePrices.effectiveTo), // only the currently-open row
          ),
        )

      // c) Insert new active tenant-wide catch-all row with effective_from = now
      await tx.insert(servicePrices).values({
        displayId: displayId('SVP'),
        tenantId: ctx.tenantId,
        serviceId: id,
        branchId: null,
        payerId: null,
        productId: null,
        patientSegment: null,
        unitPrice: input.basePrice,
        currency: 'PHP',
        effectiveFrom: now,
        effectiveTo: null,
        createdById: ctx.userId ?? null,
      })
    }

    await tx
      .update(serviceCatalog)
      .set(catalogUpdates)
      .where(and(eq(serviceCatalog.id, id), eq(serviceCatalog.tenantId, ctx.tenantId)))

    return { id }
  })
}

export async function getServicePrices(ctx: RlsCtx, serviceId: string) {
  return withTenantTx(txCtx(ctx), async (tx) => {
    const rows = await tx
      .select({
        // Surface display_id as the public `id`; never leak bigint.
        id: servicePrices.displayId,
        serviceId: servicePrices.serviceId,
        branchId: servicePrices.branchId,
        payerId: servicePrices.payerId,
        // Brand scope: null on base / any-brand rows. LEFT JOIN → nullable.
        productId: products.displayId,
        productName: products.name,
        patientSegment: servicePrices.patientSegment,
        unitPrice: servicePrices.unitPrice,
        currency: servicePrices.currency,
        effectiveFrom: servicePrices.effectiveFrom,
        effectiveTo: servicePrices.effectiveTo,
        notes: servicePrices.notes,
        createdAt: servicePrices.createdAt,
        updatedAt: servicePrices.updatedAt,
        createdById: servicePrices.createdById,
      })
      .from(servicePrices)
      .leftJoin(products, eq(servicePrices.productId, products.id))
      .where(
        and(
          eq(servicePrices.tenantId, ctx.tenantId),
          eq(servicePrices.serviceId, serviceId),
          isNull(servicePrices.deletedAt),
        ),
      )
      .orderBy(sql`${servicePrices.effectiveFrom} DESC`)
    return rows
  })
}

export async function getService(ctx: RlsCtx, id: string) {
  const createdByUser = alias(users, 'created_by_user')
  return withTenantTx(txCtx(ctx), async (tx) => {
    const [row] = await tx
      .select({
        service: serviceCatalog,
        categoryName: serviceCategories.name,
        createdByUserId: createdByUser.id,
        createdByDisplayId: createdByUser.displayId,
        createdByFirstName: createdByUser.firstName,
        createdByLastName: createdByUser.lastName,
      })
      .from(serviceCatalog)
      .leftJoin(serviceCategories, eq(serviceCatalog.categoryId, serviceCategories.id))
      .leftJoin(createdByUser, eq(createdByUser.id, serviceCatalog.createdById))
      .where(and(eq(serviceCatalog.id, id), eq(serviceCatalog.tenantId, ctx.tenantId)))
      .limit(1)
    if (!row) return null
    const effectivePrice = await resolveServicePrice(tx, {
      tenantId: ctx.tenantId,
      serviceId: id,
      branchId: ctx.branchId,
    })
    return {
      ...row.service,
      // Backward-compat: `category` is the category name resolved via
      // category_id → service_categories. New consumers should read categoryId.
      category: row.categoryName,
      // basePrice column dropped Phase 4 — alias effectivePrice for API consumers.
      basePrice: effectivePrice,
      effectivePrice,
      createdBy: row.createdByUserId
        ? {
            id: row.createdByUserId,
            displayId: row.createdByDisplayId!,
            firstName: row.createdByFirstName!,
            lastName: row.createdByLastName!,
          }
        : null,
    }
  })
}
