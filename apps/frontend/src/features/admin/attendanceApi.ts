import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'
import { useRecentList, type RecentListResult } from '@/lib/useRecentList'

export type AttendanceLog = {
  id: string
  staffName: string
  role: string
  clockInAt: string
  clockOutAt: string | null
  totalHours: string | null
}

export type AttendanceLogDetail = {
  id: string
  clockInAt: string
  clockOutAt: string | null
  totalHours: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  createdById: string | null
  createdBy: {
    id: number
    displayId: string
    firstName: string
    lastName: string
  } | null
  user: {
    id: string
    firstName: string
    lastName: string
    role: string
    email: string
  }
  branch: {
    id: string
    name: string
    code: string
  }
}

type DetailResponse = {
  data: AttendanceLogDetail
}

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

// ── Attendance list ───────────────────────────────────────────────────────────
// Note: backend response envelope previously included `activeNow` alongside
// `data`. With cursor pagination via useRecentList that field is dropped — the
// page now derives "active shifts" from rows where `clockOutAt === null`.
export function useAttendance(q: string): RecentListResult<AttendanceLog> {
  return useRecentList<AttendanceLog>({
    endpoint: '/api/admin/attendance',
    query: { q: q || undefined },
    queryKey: ['admin', 'attendance', q],
    pageSize: 50,
  })
}

// ── Attendance detail ─────────────────────────────────────────────────────────
export function useAttendanceLog(id: string | null) {
  return useQuery<DetailResponse>({
    queryKey: ['admin', 'attendance', id],
    queryFn: () => apiFetch(`/api/admin/attendance/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}
