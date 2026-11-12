import { z } from 'zod'

export const developmentWriteAuthorizationSchema = z
  .object({
    targetClass: z.enum(['local_development', 'disposable_development']),
    databaseFingerprint: z.string().min(8).max(300),
    approvedBy: z.string().min(1).max(200),
    approvedAt: z.string().datetime({ offset: true }),
  })
  .strict()

export type DevelopmentWriteAuthorization = z.infer<typeof developmentWriteAuthorizationSchema>

/**
 * Production writes require a separate future approval and are intentionally
 * impossible through this development-only authorization type.
 */
export function assertDevelopmentWriteAuthorized(
  dryRun: boolean,
  rawAuthorization: unknown,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (dryRun) return
  if (nodeEnv === 'production') {
    throw new Error('production migration writes are not authorized')
  }
  developmentWriteAuthorizationSchema.parse(rawAuthorization)
}
