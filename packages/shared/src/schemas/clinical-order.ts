/**
 * Clinical order schemas — shared frontend API surface.
 * Backend keeps inline Zod (tsx v4 gotcha).
 */
import { z } from 'zod'
import {
  clinicalOrderStatusSchema,
  clinicalOrderTypeSchema,
  administrationRouteSchema,
} from './enums'

// ── Request schemas ───────────────────────────────────────────────────────────

export const clinicalOrderCreateSchema = z.object({
  encounterId: z.string().min(1, 'Must be a valid ID').optional(),
  standingOrderId: z.string().min(1, 'Must be a valid ID').optional(),
  serviceId: z.string().min(1, 'Service is required'),
  orderType: clinicalOrderTypeSchema,
  administrationRoute: administrationRouteSchema.optional(),
  scheduledAt: z.string().optional(),
  notes: z.string().max(2000, 'Maximum 2000 characters').optional(),
  quantity: z.number().int('Must be a whole number').positive('Must be at least 1').default(1),
})
export type ClinicalOrderCreateInput = z.infer<typeof clinicalOrderCreateSchema>

export const clinicalOrderUpdateSchema = z.object({
  status: clinicalOrderStatusSchema.optional(),
  administrationRoute: administrationRouteSchema.optional(),
  scheduledAt: z.string().optional(),
  notes: z.string().max(2000, 'Maximum 2000 characters').optional(),
})
export type ClinicalOrderUpdateInput = z.infer<typeof clinicalOrderUpdateSchema>

/** Body for the administer (dose-record) endpoint. */
export const clinicalOrderAdministerSchema = z.object({
  administeredById: z.string().min(1, 'Must be a valid ID').optional(),
  administeredAt: z.string().optional(),
  administrationRoute: administrationRouteSchema.optional(),
  lotNumber: z.string().max(100, 'Maximum 100 characters').optional(),
  expiryDate: z.string().optional(),
  notes: z.string().max(2000, 'Maximum 2000 characters').optional(),
})
export type ClinicalOrderAdministerInput = z.infer<typeof clinicalOrderAdministerSchema>

// ── Response shape ────────────────────────────────────────────────────────────

export const clinicalOrderResponseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  encounterId: z.string().nullable(),
  standingOrderId: z.string().nullable(),
  serviceId: z.string(),
  orderType: z.string(),
  status: z.string(),
  administrationRoute: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  administeredAt: z.string().nullable(),
  administeredById: z.string().nullable(),
  documentedById: z.string().nullable(),
  lotNumber: z.string().nullable(),
  expiryDate: z.string().nullable(),
  notes: z.string().nullable(),
  quantity: z.number().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ClinicalOrderResponse = z.infer<typeof clinicalOrderResponseSchema>
