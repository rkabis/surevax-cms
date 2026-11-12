import { withTenantTx } from '../../shared/db/withTenantTx.js'
import {
  appendExternalDoseTx,
  createTemplateVersionTx,
  startStandingOrderTx,
  updateTemplateTx,
  type AppendExternalDoseInput,
  type CreateTemplateVersionInput,
  type CreatedStandingOrder,
  type StartStandingOrderInput,
  type UpdateTemplateInput,
} from './db.js'
import type { standingOrderTemplates } from '../../shared/db/schema.js'

/**
 * Service context — display_id flowing in from the request, bigint internal
 * ids resolved per call.
 *
 * `userId` / `branchId` are bigint per W2 (TenantCtx).
 */
type StandingOrdersCtx = {
  tenantId: string
  userId: number
  branchId: number | null
}

/**
 * Open a patient standing order from a template and generate one
 * clinical_orders row per template item. Wrapped in a single transaction
 * with SET LOCAL RLS context.
 */
export async function startStandingOrder(
  input: StartStandingOrderInput & { branchId: number | null },
): Promise<CreatedStandingOrder> {
  const { tenantId, createdById, branchId, ...rest } = input

  return withTenantTx({ tenantId, userId: createdById, branchId }, async (tx) => {
    return startStandingOrderTx(tx, { tenantId, createdById, branchId, ...rest })
  })
}

/**
 * Update a standing order template in-place (by raw code id).
 * Rejects with 'TEMPLATE_LOCKED' if the template has at least one PSO.
 */
export async function updateTemplate(
  ctx: StandingOrdersCtx,
  id: string,
  patch: UpdateTemplateInput,
): Promise<typeof standingOrderTemplates.$inferSelect> {
  return withTenantTx(ctx, async (tx) => {
    return updateTemplateTx(tx, ctx.tenantId, id, patch)
  })
}

/**
 * Append a single externally-administered dose to an existing PSO.
 * Inserts a clinical_orders row with status='Completed' from the start
 * to avoid the BEFORE-UPDATE immutability trigger.
 */
export async function appendExternalDose(
  ctx: StandingOrdersCtx,
  input: Omit<AppendExternalDoseInput, 'tenantId' | 'createdById'>,
): Promise<Awaited<ReturnType<typeof appendExternalDoseTx>>> {
  return withTenantTx(ctx, async (tx) => {
    return appendExternalDoseTx(tx, {
      ...input,
      tenantId: ctx.tenantId,
      createdById: ctx.userId,
    })
  })
}

/**
 * Copy-on-write: snapshot the template as a new version row.
 */
export async function createTemplateVersion(
  ctx: StandingOrdersCtx,
  oldId: string,
  patch: CreateTemplateVersionInput,
): Promise<typeof standingOrderTemplates.$inferSelect> {
  return withTenantTx(ctx, async (tx) => {
    return createTemplateVersionTx(tx, ctx.tenantId, oldId, ctx.userId, patch)
  })
}
