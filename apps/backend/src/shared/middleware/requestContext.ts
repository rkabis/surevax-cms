import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export type RequestContext = {
  correlationId: string
  ipAddress: string | null
  userAgent: string | null
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>()

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const reqWithId = req as Request & { id?: string | number }
  const rawRequestId = reqWithId.id
  const correlationId =
    typeof rawRequestId === 'string' || typeof rawRequestId === 'number'
      ? String(rawRequestId)
      : randomUUID()

  requestContextStorage.run(
    {
      correlationId,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    },
    next,
  )
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore()
}
