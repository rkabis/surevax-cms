// Shared API error class.
//
// M3 from the 2026-05-23 360 codebase review: every route had its own
// `res.status(N).json({ error, code })` boilerplate, with the response
// shape drifting between modules (some use `error`, some `message`, some
// `details`, some nest under `data`). Centralise the shape here so the
// global error handler can format consistently and routes can `throw new
// ApiError(...)` instead of hand-rolling response code per route.
//
// The contract:
//   - `statusCode` is the HTTP status to return.
//   - `code` is a machine-readable string (e.g. `CONSENT_REVOKED`).
//   - `message` is human-readable, safe to surface to clients.
//   - `detail` is optional debug context — included in the response only
//     when EXPOSE_ERRORS=true (mirrors the existing error.ts behavior).

export class ApiError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly detail?: unknown

  constructor(
    message: string,
    options: { statusCode?: number; code?: string; detail?: unknown } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = options.statusCode ?? 500
    this.code = options.code ?? 'INTERNAL_ERROR'
    this.detail = options.detail
  }

  /** Convenience builder for 400-class errors. */
  static badRequest(message: string, code = 'BAD_REQUEST', detail?: unknown): ApiError {
    return new ApiError(message, { statusCode: 400, code, detail })
  }

  /** Convenience builder for 403-class errors. */
  static forbidden(message: string, code = 'FORBIDDEN', detail?: unknown): ApiError {
    return new ApiError(message, { statusCode: 403, code, detail })
  }

  /** Convenience builder for 404-class errors. */
  static notFound(message: string, code = 'NOT_FOUND', detail?: unknown): ApiError {
    return new ApiError(message, { statusCode: 404, code, detail })
  }

  /** Convenience builder for 409-class errors. */
  static conflict(message: string, code = 'CONFLICT', detail?: unknown): ApiError {
    return new ApiError(message, { statusCode: 409, code, detail })
  }
}

/** True if the error is an ApiError instance or duck-types like one. */
export function isApiError(err: unknown): err is ApiError {
  if (err instanceof ApiError) return true
  if (typeof err !== 'object' || err === null) return false
  const e = err as { statusCode?: unknown; code?: unknown }
  return typeof e.statusCode === 'number' && typeof e.code === 'string'
}
