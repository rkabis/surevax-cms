import type { Request, Response, NextFunction } from 'express'
import { env } from '../config/env.js'
import { isApiError } from '../lib/apiError.js'
import { logger } from '../utils/logger.js'

// Global error handler — must be registered last, after all routes.
// Never leaks stack traces or internal paths to clients by default. The
// underlying error string is included under `detail` only when the
// EXPOSE_ERRORS env flag is truthy (intended for short-lived debugging).
// Server-side logging of the full error always happens regardless.
//
// M3: routes that throw `new ApiError(...)` (or any error duck-typing the
// shape) are routed to their declared statusCode + code. Everything else
// still falls through to a generic 500 — Express 5 propagates async errors
// to this handler automatically.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error')

  if (res.headersSent) return

  if (isApiError(err)) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      ...(env.EXPOSE_ERRORS && err.detail !== undefined ? { detail: err.detail } : {}),
    })
    return
  }

  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    ...(env.EXPOSE_ERRORS ? { detail: String(err) } : {}),
  })
}
