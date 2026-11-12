// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'review-center'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type ReviewCenterListQuery = { date?: string; q?: string }

export type ReviewCenterListResponse = {
  generatedAt: string
  asOfDate: string
  branchId: string
  counts: {
    missingGuardians: number
    yesterdayLooseEnds: number
    potentialDuplicates: number
    externalImmunizations: number
  }
  missingGuardians: {
    count: number
    rows: {
      patientId: string
      mrn: string
      patientName: string
      dateOfBirth: string
      age: number
      contactNumber: string | null
      guardianName: string | null
      guardianRelationship: string | null
      guardianContact: string | null
      rowVersion: number
    }[]
  }
  yesterdayLooseEnds: {
    count: number
    staleOpenEncounters: {
      count: number
      rows: {
        encounterId: string
        patientId: string
        patientName: string
        specialty: string
        status: 'Open' | 'InProgress'
        startedAt: string
      }[]
    }
    unsettledTransactions: {
      count: number
      totalOutstanding: string
      rows: {
        transactionId: string
        patientId: string
        patientName: string
        status: string
        outstandingAmount: string
        createdAt: string
      }[]
    }
    openPriorDrawers: {
      count: number
      rows: { sessionId: string; openedAt: string; userName: string | null; openingFloat: string }[]
    }
    undocumentedAdministrations: {
      count: number
      rows: {
        orderId: string
        encounterId: string | null
        patientId: string
        patientName: string
        serviceName: string
        completedAt: string
      }[]
    }
  }
  potentialDuplicates: {
    count: number
    rows: {
      patientId: string
      mrn: string
      patientName: string
      dateOfBirth: string | null
      contactNumber: string | null
      flaggedAt: string
    }[]
  }
  externalImmunizations: {
    count: number
    rows: {
      patientId: string
      mrn: string
      patientName: string
      vaccineName: string
      administeredDate: string | null
      administeredDatePrecision: 'Exact' | 'Estimated' | 'Unknown'
      administeredAtFacility: string | null
      source: string
      createdAt: string
    }[]
  }
}

export type ReviewCenterUpdateGuardianPatientIdParam = string

export type ReviewCenterUpdateGuardianBody = {
  guardianName: string
  guardianRelationship: string
  guardianContact: string
  expectedRowVersion: number
}

export type ReviewCenterUpdateGuardianResponse = {
  patientId: string
  patientName: string
  guardianName: string
  guardianRelationship: string
  guardianContact: string
  rowVersion: number
  reviewedById: string
  reviewedAt: string
}

export const reviewCenterEndpoints = {
  list: { method: 'GET', path: '/api/review-center' },
  updateGuardian: { method: 'PATCH', path: '/api/review-center/missing-guardians/:patientId' },
} as const
