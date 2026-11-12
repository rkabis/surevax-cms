import { z } from 'zod'
import { catalogCodeSchema, prefixedDisplayIdSchema } from '../utils/displayId'
import { paymentSchema, transactionDiscountSchema, transactionItemSchema } from './transaction'

/**
 * A corporate bill deliberately has a transaction header underneath it. The
 * patient groups below are flattened to that header's transaction_items and
 * transaction_patients rows by the backend; this contract keeps that engine
 * reusable while making payer AR explicit at the API boundary.
 */
export const groupBillItemSchema = transactionItemSchema
  .omit({
    patientId: true,
    isPrepaid: true,
    prepaidTransactionId: true,
  })
  .extend({
    serviceId: catalogCodeSchema,
    clinicalOrderId: prefixedDisplayIdSchema('ORD').optional(),
  })

export const groupBillPatientSchema = z.object({
  patientId: prefixedDisplayIdSchema('PAT'),
  encounterId: prefixedDisplayIdSchema('ENC').optional(),
  discount: transactionDiscountSchema.nullish(),
  items: z.array(groupBillItemSchema).min(1, 'Add at least one item for each patient'),
})

/** One tender leg only; payer identity is taken from the group bill, never the client. */
export const groupBillPaymentSchema = paymentSchema.omit({ payerId: true })

export const groupBillCreateSchema = z
  .object({
    payerId: prefixedDisplayIdSchema('PYR'),
    referenceNumber: z.string().max(120).optional(),
    patients: z.array(groupBillPatientSchema).min(2).max(20),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    value.patients.forEach((patient, index) => {
      if (seen.has(patient.patientId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['patients', index, 'patientId'],
          message: 'Each patient may appear only once on a group bill',
        })
      }
      seen.add(patient.patientId)
    })
    const itemCount = value.patients.reduce((total, patient) => total + patient.items.length, 0)
    if (itemCount > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['patients'],
        message: 'A group bill cannot contain more than 100 items',
      })
    }
  })

export type GroupBillCreateInput = z.infer<typeof groupBillCreateSchema>
export type GroupBillPaymentInput = z.infer<typeof groupBillPaymentSchema>
