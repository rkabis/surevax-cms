import type { Request, Response, NextFunction } from 'express'

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Custom-header CSRF defense. Cross-site cookies (SameSite=None) are vulnerable
// to "simple" form POSTs that the browser attaches cookies to. Requiring a
// custom header forces a CORS preflight, which the strict CORS origin
// allow-list rejects from any non-allowed origin.
export function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!STATE_CHANGING.has(req.method)) return next()
  const header = req.get('x-requested-with')
  if (header !== 'fetch') {
    res.status(403).json({ error: 'Missing CSRF header', code: 'CSRF_REQUIRED' })
    return
  }
  next()
}
