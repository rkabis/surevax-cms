import { z } from 'zod'

export { idSchema, prefixedIdSchema } from '../utils/displayId'

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
})

export type Pagination = z.infer<typeof paginationSchema>
