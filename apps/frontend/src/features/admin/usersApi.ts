import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'

// TenantAdmin is canonical (Wave 2.2, 2026-05-18); SuperAdmin retained
// because the user_role enum still carries it for back-compat with rows
// seeded before the rename.
export type UserRole =
  | 'TenantAdmin'
  | 'SuperAdmin'
  | 'BranchAdmin'
  | 'Physician'
  | 'Nurse'
  | 'Cashier'
  | 'Branch'

export const ALL_ROLES: UserRole[] = [
  'TenantAdmin',
  'BranchAdmin',
  'Branch',
  'Physician',
  'Nurse',
  'Cashier',
]

export type StaffUser = {
  id: string
  firstName: string
  lastName: string
  email: string
  role: UserRole
  roles: UserRole[]
  branches: { id: string; name: string | null }[]
  isActive: boolean
  canLogin: boolean
  lastLoginAt: string | null
  licenseNumber: string | null
}

export type StaffUserDetail = StaffUser & {
  tenantId: string
  branchId: string | null
  hasPassword: boolean
  createdAt: string | null
  updatedAt: string | null
  createdById: string | null
  branch: { id: string; name: string | null; code: string | null } | null
  createdBy: {
    id: string
    email: string | null
    firstName: string | null
    lastName: string | null
  } | null
}

type ListResponse = {
  data: StaffUser[]
  activeCount: number
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

export type UsersRoleFilter = 'all' | 'Admin' | 'Physician' | 'Nurse' | 'Cashier' | 'Branch'

export type UpdateUserBody = {
  canLogin?: boolean
  isActive?: boolean
  password?: string
  role?: UserRole
  roles?: UserRole[]
  branchId?: string
  branches?: string[]
}

export type CreateUserBody = {
  email: string
  firstName: string
  lastName: string
  password: string
  role?: UserRole
  roles?: UserRole[]
  branchId?: string
  branches?: string[]
  licenseNumber?: string
  isActive?: boolean
  canLogin?: boolean
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation<{ ok: true }, Error, { id: string; body: UpdateUserBody }>({
    mutationFn: ({ id, body }) =>
      apiFetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] })
      void qc.invalidateQueries({ queryKey: ['admin-users', vars.id] })
    },
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation<StaffUserDetail, Error, CreateUserBody>({
    mutationFn: (body) =>
      apiFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] })
    },
  })
}

export function useUsers(opts: { q: string; role: UsersRoleFilter }) {
  return useQuery<ListResponse>({
    queryKey: ['admin-users', opts.q, opts.role],
    queryFn: () => {
      const params = new URLSearchParams()
      if (opts.q) params.set('q', opts.q)
      if (opts.role !== 'all') params.set('role', opts.role)
      const qs = params.toString()
      return apiFetch(`/api/admin/users${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })
}

export function useUser(id: string | null) {
  return useQuery<StaffUserDetail>({
    queryKey: ['admin-users', id],
    queryFn: () => apiFetch(`/api/admin/users/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export type AdminBranch = {
  id: string
  code: string
  name: string
  isActive: boolean
}

export function useResetPin() {
  const qc = useQueryClient()
  return useMutation<{ ok: true }, Error, { id: string; pin: string }>({
    mutationFn: ({ id, pin }) =>
      apiFetch(`/api/admin/users/${id}/reset-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['admin-users', vars.id] })
    },
  })
}

export function useClearPin() {
  const qc = useQueryClient()
  return useMutation<{ ok: true }, Error, { id: string }>({
    mutationFn: ({ id }) =>
      apiFetch(`/api/admin/users/${id}/pin`, {
        method: 'DELETE',
      }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['admin-users', vars.id] })
    },
  })
}

export function useAdminBranches() {
  return useQuery<AdminBranch[]>({
    queryKey: ['admin-branches'],
    queryFn: () => apiFetch('/api/admin/branches'),
    staleTime: 5 * 60_000,
  })
}
