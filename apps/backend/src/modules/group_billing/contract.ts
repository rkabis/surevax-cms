/** Corporate group-billing API contract. Side-effect-free for code generation. */
import { z } from 'zod'
import { groupBillCreateSchema, groupBillPaymentSchema } from '@surevax/shared'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { defineContract } from '../../contracts/defineContract.js'

export { groupBillCreateSchema, groupBillPaymentSchema }

export const groupBillDisplayId = prefixedDisplayIdSchema('GBL')
export const groupBillListQuery = z.object({ status: z.enum(['open', 'all']).optional() })

const attestationFields = {
  attestedById: prefixedDisplayIdSchema('USR').optional(),
  attestationPin: z
    .string()
    .regex(/^\d{4}$/, 'PIN must be 4 digits')
    .optional(),
}

export const groupBillPaymentBodySchema = groupBillPaymentSchema.extend(attestationFields)
export const groupBillVoidBodySchema = z.object({
  reason: z.string().min(5, 'Reason must be at least 5 characters').max(500),
})

const groupBillRowSchema = z.object({
  id: groupBillDisplayId,
  transactionId: prefixedDisplayIdSchema('TXN'),
  payer: z.object({ id: prefixedDisplayIdSchema('PYR'), name: z.string() }),
  patientCount: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  netAmount: z.string(),
  amountPaid: z.string(),
  amountOutstanding: z.string(),
  status: z.enum(['Draft', 'Pending', 'Paid', 'Voided', 'Refunded']),
  createdAt: z.string(),
  referenceNumber: z.string().nullable(),
})

const listResponseSchema = z.object({
  data: z.array(groupBillRowSchema),
  summary: z.object({
    count: z.number().int().nonnegative(),
    netAmount: z.string(),
    amountPaid: z.string(),
    amountOutstanding: z.string(),
  }),
})

const detailResponseSchema = groupBillRowSchema.extend({
  patients: z.array(
    z.object({
      patient: z.object({
        id: prefixedDisplayIdSchema('PAT'),
        firstName: z.string(),
        lastName: z.string(),
      }),
      encounterId: prefixedDisplayIdSchema('ENC').nullable(),
      discount: z
        .object({ idType: z.enum(['OSCA', 'PWD', 'Other']), idNumber: z.string().nullable() })
        .nullable(),
      items: z.array(
        z.object({
          id: prefixedDisplayIdSchema('TXI'),
          serviceId: z.string(),
          clinicalOrderId: prefixedDisplayIdSchema('ORD').nullable(),
          quantity: z.string(),
          unitPrice: z.string(),
          discountAmount: z.string(),
          vatAmount: z.string(),
          subtotal: z.string(),
        }),
      ),
    }),
  ),
  payments: z.array(
    z.object({
      id: prefixedDisplayIdSchema('PMT'),
      method: z.string(),
      amount: z.string(),
      referenceNumber: z.string().nullable(),
      receivedAt: z.string(),
      voidedAt: z.string().nullable(),
    }),
  ),
})

const createResponseSchema = z.object({
  id: groupBillDisplayId,
  transactionId: prefixedDisplayIdSchema('TXN').optional(),
  status: z.enum(['Draft', 'Pending', 'Paid']).optional(),
  idempotentReplay: z.boolean().optional(),
})

const paymentResponseSchema = z.object({
  id: prefixedDisplayIdSchema('PMT'),
  status: z.enum(['Draft', 'Pending', 'Paid']),
  receiptNo: z.string().nullable(),
})

const voidResponseSchema = z.object({
  id: groupBillDisplayId,
  transactionId: prefixedDisplayIdSchema('TXN'),
  status: z.literal('Voided'),
})

export const groupBillingContract = defineContract('group-billing', {
  list: {
    method: 'GET',
    path: '/api/group-bills',
    query: groupBillListQuery,
    response: listResponseSchema,
  },
  create: {
    method: 'POST',
    path: '/api/group-bills',
    body: groupBillCreateSchema,
    response: createResponseSchema,
  },
  detail: {
    method: 'GET',
    path: '/api/group-bills/:id',
    params: { id: groupBillDisplayId },
    response: detailResponseSchema,
  },
  addPayment: {
    method: 'POST',
    path: '/api/group-bills/:id/payments',
    params: { id: groupBillDisplayId },
    body: groupBillPaymentBodySchema,
    response: paymentResponseSchema,
  },
  void: {
    method: 'POST',
    path: '/api/group-bills/:id/void',
    params: { id: groupBillDisplayId },
    body: groupBillVoidBodySchema,
    response: voidResponseSchema,
  },
})

export type GroupBillListResponse = z.infer<typeof listResponseSchema>
export type GroupBillDetailResponse = z.infer<typeof detailResponseSchema>
export type GroupBillCreateResponse = z.infer<typeof createResponseSchema>
export type GroupBillPaymentResponse = z.infer<typeof paymentResponseSchema>
export type GroupBillVoidResponse = z.infer<typeof voidResponseSchema>
export type GroupBillCreateInput = z.infer<typeof groupBillCreateSchema>
export type GroupBillPaymentInput = z.infer<typeof groupBillPaymentSchema>
