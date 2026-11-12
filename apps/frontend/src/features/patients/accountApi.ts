import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'
import type {
  PatientAccountsBalanceResponse,
  PatientAccountsLedgerResponse,
} from '@/api/contracts/patient-accounts.gen'

// Back-compat: existing importers reach `usePatientCredit` off the
// transactions feature (it's served by the patients module but predates this
// file). Re-export so callers can migrate to `@/features/patients/accountApi`
// without a breaking rename.
export { usePatientCredit } from '@/features/transactions/api'

// ── Wire-type aliases over generated contract ────────────────────────────────

export type PatientBalance = PatientAccountsBalanceResponse
export type PatientLedger = PatientAccountsLedgerResponse

// ── Patient balance (accounts-receivable position) ───────────────────────────

export function usePatientBalance(
  patientId: string | null | undefined,
  opts?: { asOf?: string; enabled?: boolean },
) {
  return useQuery<PatientBalance>({
    queryKey: ['patient-account', patientId, opts?.asOf ?? ''],
    queryFn: () => {
      const params = new URLSearchParams()
      if (opts?.asOf) params.set('asOf', opts.asOf)
      const qs = params.toString()
      return apiFetch(`/api/patients/${patientId}/balance${qs ? `?${qs}` : ''}`)
    },
    enabled: !!patientId && (opts?.enabled ?? true),
    staleTime: 30_000,
  })
}

// ── Patient ledger (full statement) ──────────────────────────────────────────

export function usePatientLedger(
  patientId: string | null | undefined,
  opts?: { asOf?: string; includeSettled?: boolean },
) {
  return useQuery<PatientLedger>({
    queryKey: ['patient-ledger', patientId, opts?.asOf ?? '', opts?.includeSettled ?? false],
    queryFn: () => {
      const params = new URLSearchParams()
      if (opts?.asOf) params.set('asOf', opts.asOf)
      if (opts?.includeSettled) params.set('includeSettled', 'true')
      const qs = params.toString()
      return apiFetch(`/api/patients/${patientId}/ledger${qs ? `?${qs}` : ''}`)
    },
    enabled: !!patientId,
    staleTime: 30_000,
  })
}
