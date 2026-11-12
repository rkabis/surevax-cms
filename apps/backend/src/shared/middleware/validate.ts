import type { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'

type Target = 'body' | 'query' | 'params'

// Validates request data against a Zod schema from @surevax/shared.
// Returns 400 with structured field errors on failure.
export function validate(schema: ZodSchema, target: Target = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target])
    if (!result.success) {
      const details = (result.error as ZodError).flatten().fieldErrors
      res.status(400).json({ error: 'Validation failed', code: 'INVALID_INPUT', details })
      return
    }
    req[target] = result.data
    next()
  }
}
