import {
  reviewCenterGuardianUpdateResponseSchema,
  reviewCenterGuardianUpdateSchema,
  reviewCenterQuerySchema,
  reviewCenterResponseSchema,
} from '@surevax/shared'
import { prefixedDisplayIdSchema } from '../../shared/utils/displayId.js'
import { defineContract } from '../../contracts/defineContract.js'

export const reviewCenterContract = defineContract('review-center', {
  list: {
    method: 'GET',
    path: '/api/review-center',
    query: reviewCenterQuerySchema,
    response: reviewCenterResponseSchema,
  },
  updateGuardian: {
    method: 'PATCH',
    path: '/api/review-center/missing-guardians/:patientId',
    params: { patientId: prefixedDisplayIdSchema('PAT') },
    body: reviewCenterGuardianUpdateSchema,
    response: reviewCenterGuardianUpdateResponseSchema,
  },
})

export type ReviewCenterListResponse = typeof reviewCenterResponseSchema._output
export type ReviewCenterUpdateGuardianResponse =
  typeof reviewCenterGuardianUpdateResponseSchema._output
