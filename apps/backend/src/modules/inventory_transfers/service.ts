import { withTenantTx, type TenantCtx } from '../../shared/db/withTenantTx.js'
import * as db from './db.js'
import type { TransferPublic } from './db.js'

export { TransferPublic }

export async function shipTransfer(
  ctx: TenantCtx,
  args: {
    sourceBranchDisplayId: string
    destinationBranchDisplayId: string
    lotDisplayId: string
    quantity: number
    notes?: string | null
  },
): Promise<TransferPublic> {
  return withTenantTx(ctx, (tx) =>
    db.createTransfer(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      branchId: ctx.branchId,
      ...args,
    }),
  )
}

export async function receiveTransfer(
  ctx: TenantCtx,
  transferDisplayId: string,
  args: {
    destinationLotDisplayId?: string | null
    notes?: string | null
  },
): Promise<TransferPublic> {
  return withTenantTx(ctx, (tx) =>
    db.receiveTransfer(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      branchId: ctx.branchId,
      transferDisplayId,
      ...args,
    }),
  )
}

export async function cancelTransfer(
  ctx: TenantCtx,
  transferDisplayId: string,
  args: {
    reason?: string | null
  },
): Promise<TransferPublic> {
  return withTenantTx(ctx, (tx) =>
    db.cancelTransfer(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      branchId: ctx.branchId,
      transferDisplayId,
      ...args,
    }),
  )
}
