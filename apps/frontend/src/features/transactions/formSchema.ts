import { transactionCreateSchema } from '@surevax/shared'
import { z } from 'zod'

// Flatten the shared discount object into the fields used by the cashier form.
// `isPrepayment` is intentionally absent: deposits use RecordDepositDialog.
export const transactionCreateFormSchema = transactionCreateSchema
  .omit({ isPrepayment: true, discount: true, payment: true, payments: true })
  .extend({
    discountIdType: z.enum(['OSCA', 'PWD', 'Other', 'NA']),
    discountIdNumber: z.string().max(64).optional(),
  })
  .superRefine((values, ctx) => {
    if (
      (values.discountIdType === 'OSCA' || values.discountIdType === 'PWD') &&
      !values.discountIdNumber?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountIdNumber'],
        message: 'Senior/PWD ID number is required',
      })
    }
  })

export type TransactionCreateFormFields = z.infer<typeof transactionCreateFormSchema>
