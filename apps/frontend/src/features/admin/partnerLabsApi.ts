import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'

export type PartnerLab = {
  id: string
  name: string
  contactName: string | null
  contactNumber: string | null
  email: string | null
  isActive: boolean
  createdAt: string
}

export type PartnerLabDetail = PartnerLab & {
  tenantId: string
  address: string | null
  apiConfig: Record<string, unknown> | null
  updatedAt: string
  createdById: string | null
  createdBy: {
    id: number
    displayId: string
    firstName: string
    lastName: string
  } | null
}

// Copied verbatim from features/patients/api.ts.
// Will be extracted to src/lib/api.ts in a future refactor.
async function apiFetch(path: string, opts?: RequestInit) {
  const url = `${API_BASE_URL}${path}`
  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers: { ...STANDARD_API_HEADERS, ...(opts?.headers as Record<string, string>) },
  })
  if (res.status === 401) {
    // Attempt token refresh
    const refreshRes = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: STANDARD_API_HEADERS,
    })
    if (!refreshRes.ok) throw new Error('SESSION_EXPIRED')
    const retry = await fetch(url, {
      credentials: 'include',
      ...opts,
      headers: { ...STANDARD_API_HEADERS, ...(opts?.headers as Record<string, string>) },
    })
    if (!retry.ok) throw new Error(`API error: ${retry.status}`)
    return retry.json()
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export function usePartnerLabs() {
  return useQuery<PartnerLab[]>({
    queryKey: ['partner-labs'],
    queryFn: () => apiFetch('/api/partner-labs'),
    staleTime: 30_000,
  })
}

export function usePartnerLab(id: string | null) {
  return useQuery<PartnerLabDetail>({
    queryKey: ['partner-labs', id],
    queryFn: () => apiFetch(`/api/partner-labs/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}
