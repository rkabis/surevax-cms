import { z } from 'zod'
import { idSchema } from '../utils/displayId'

export const clockInSchema = z.object({
  branchId: idSchema,
})

export const clockOutSchema = z.object({
  notes: z.string().max(500).optional(),
})

export const staffTimeLogSchema = z.object({
  id: idSchema,
  userId: idSchema,
  branchId: idSchema,
  clockInAt: z.string().datetime(),
  clockOutAt: z.string().datetime().nullable(),
  totalHours: z.string().nullable(), // NUMERIC(6,2) comes back as string from pg
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
})

export type ClockInInput = z.infer<typeof clockInSchema>
export type ClockOutInput = z.infer<typeof clockOutSchema>
export type StaffTimeLog = z.infer<typeof staffTimeLogSchema>
