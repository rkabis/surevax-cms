import { wire } from '../../contracts/wire.js'
import { Router, type Router as RouterType, type Request, type Response } from 'express'
import * as dbQ from './db.js'
import { resolveBranchId } from './db.js'
import * as svc from './service.js'
import { requireRole } from '../../shared/middleware/requireRole.js'
import { sendLifecycleError } from '../transactions/routes.js'
// Schemas live in the module contract (./contract.ts) so codegen and the
// runtime validators share one source — see docs/specs/api-contract-codegen.md.
import {
  shipBody,
  receiveBody,
  cancelBody,
  listQuery,
  transferIdParam,
  type InventoryTransfersListResponse,
  type InventoryTransfersDetailResponse,
  type InventoryTransfersCreateResponse,
  type InventoryTransfersReceiveResponse,
  type InventoryTransfersCancelResponse,
} from './contract.js'

export const inventoryTransfersRouter: RouterType = Router()

// ── GET /api/inventory-transfers ──────────────────────────────────────────────

inventoryTransfersRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const parsed = listQuery.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'INVALID_INPUT',
      details: parsed.error.flatten().fieldErrors,
    })
    return
  }

  // Resolve branch display_id → bigint for filter (if provided)
  let sourceBranchId: number | undefined
  let destinationBranchId: number | undefined

  if (parsed.data.sourceBranchId) {
    const resolved = await resolveBranchId(parsed.data.sourceBranchId, tenantId)
    if (!resolved) {
      res.json(wire([]) satisfies InventoryTransfersListResponse)
      return
    }
    sourceBranchId = resolved
  }
  if (parsed.data.destinationBranchId) {
    const resolved = await resolveBranchId(parsed.data.destinationBranchId, tenantId)
    if (!resolved) {
      res.json(wire([]) satisfies InventoryTransfersListResponse)
      return
    }
    destinationBranchId = resolved
  }

  const rows = await dbQ.listTransfers(tenantId, {
    status: parsed.data.status,
    sourceBranchId,
    destinationBranchId,
  })
  res.json(wire(rows) satisfies InventoryTransfersListResponse)
})

// ── GET /api/inventory-transfers/:id ─────────────────────────────────────────

inventoryTransfersRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.tenant.id
  const idParsed = transferIdParam.safeParse(req.params['id'])
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid transfer id', code: 'INVALID_ID' })
    return
  }
  const row = await dbQ.getTransfer(tenantId, idParsed.data)
  if (!row) {
    res.status(404).json({ error: 'Transfer not found', code: 'NOT_FOUND' })
    return
  }
  res.json(wire(row) satisfies InventoryTransfersDetailResponse)
})

// ── POST /api/inventory-transfers (ship) ──────────────────────────────────────

inventoryTransfersRouter.post(
  '/',
  requireRole('TenantAdmin', 'BranchAdmin', 'Nurse', 'Branch'),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }

    const parsed = shipBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'INVALID_INPUT',
        details: parsed.error.flatten().fieldErrors,
      })
      return
    }

    const { sourceBranchId, destinationBranchId, lotId, quantity, notes } = parsed.data

    if (sourceBranchId === destinationBranchId) {
      res.status(400).json({
        error: 'Source and destination branch must be different',
        code: 'SAME_BRANCH',
      })
      return
    }

    try {
      const row = await svc.shipTransfer(
        { tenantId, userId, branchId: req.tenant.branchId },
        {
          sourceBranchDisplayId: sourceBranchId,
          destinationBranchDisplayId: destinationBranchId,
          lotDisplayId: lotId,
          quantity,
          notes,
        },
      )
      res.status(201).json(wire(row) satisfies InventoryTransfersCreateResponse)
    } catch (err) {
      // LifecycleError carries `httpStatus`, never `statusCode`. Reading the
      // wrong field meant every structured 404 and 409 raised in this router
      // fell through to `throw err` and surfaced as an unhandled 500, so a
      // nurse hitting a wrong-state or out-of-stock transfer got no usable
      // message at all. `sendLifecycleError` is the canonical translator.
      if (sendLifecycleError(res, err)) return
      throw err
    }
  },
)

// ── POST /api/inventory-transfers/:id/receive ─────────────────────────────────

inventoryTransfersRouter.post(
  '/:id/receive',
  requireRole('TenantAdmin', 'BranchAdmin', 'Nurse', 'Branch'),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }

    const idParsed = transferIdParam.safeParse(req.params['id'])
    if (!idParsed.success) {
      res.status(400).json({ error: 'Invalid transfer id', code: 'INVALID_ID' })
      return
    }
    const parsed = receiveBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'INVALID_INPUT',
        details: parsed.error.flatten().fieldErrors,
      })
      return
    }

    try {
      const row = await svc.receiveTransfer(
        { tenantId, userId, branchId: req.tenant.branchId },
        idParsed.data,
        {
          destinationLotDisplayId: parsed.data.destinationLotId,
          notes: parsed.data.notes,
        },
      )
      res.json(wire(row) satisfies InventoryTransfersReceiveResponse)
    } catch (err) {
      // LifecycleError carries `httpStatus`, never `statusCode`. Reading the
      // wrong field meant every structured 404 and 409 raised in this router
      // fell through to `throw err` and surfaced as an unhandled 500, so a
      // nurse hitting a wrong-state or out-of-stock transfer got no usable
      // message at all. `sendLifecycleError` is the canonical translator.
      if (sendLifecycleError(res, err)) return
      throw err
    }
  },
)

// ── POST /api/inventory-transfers/:id/cancel ──────────────────────────────────

inventoryTransfersRouter.post(
  '/:id/cancel',
  requireRole('TenantAdmin', 'BranchAdmin', 'Nurse', 'Branch'),
  async (req: Request, res: Response) => {
    const tenantId = req.tenant.id
    const userId = req.tenant.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' })
      return
    }

    const idParsed = transferIdParam.safeParse(req.params['id'])
    if (!idParsed.success) {
      res.status(400).json({ error: 'Invalid transfer id', code: 'INVALID_ID' })
      return
    }
    const parsed = cancelBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation failed',
        code: 'INVALID_INPUT',
        details: parsed.error.flatten().fieldErrors,
      })
      return
    }

    try {
      const row = await svc.cancelTransfer(
        { tenantId, userId, branchId: req.tenant.branchId },
        idParsed.data,
        parsed.data,
      )
      res.json(wire(row) satisfies InventoryTransfersCancelResponse)
    } catch (err) {
      // LifecycleError carries `httpStatus`, never `statusCode`. Reading the
      // wrong field meant every structured 404 and 409 raised in this router
      // fell through to `throw err` and surfaced as an unhandled 500, so a
      // nurse hitting a wrong-state or out-of-stock transfer got no usable
      // message at all. `sendLifecycleError` is the canonical translator.
      if (sendLifecycleError(res, err)) return
      throw err
    }
  },
)
