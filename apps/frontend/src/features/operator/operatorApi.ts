import { apiFetch } from '@/lib/apiFetch'
import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'

export type OperatorLoginInput = {
  email: string
  password: string
  mfaToken?: string
}

export type OperatorLoginResponse = {
  user: {
    id: string
    email: string
    displayName: string
    mfaEnabled: boolean
  }
  accessToken: string
}

export type OperatorLoginError = {
  code: 'MFA_REQUIRED' | 'MFA_INVALID' | 'AUTH_FAILED' | 'VALIDATION_ERROR'
  message: string
}

export class OperatorLoginErr extends Error {
  constructor(public readonly code: OperatorLoginError['code']) {
    super(code)
  }
}

export type OperatorMfaEnrollResponse = {
  base32Secret: string
  qrCodeDataUrl: string
  otpauthUrl: string
}

export type OperatorTenant = {
  id: string
  name: string
  slug: string
  branchCount: number
  createdAt: string
}

export async function operatorLogin(input: OperatorLoginInput): Promise<OperatorLoginResponse> {
  const res = await fetch(`${API_BASE_URL}/api/operator/login`, {
    method: 'POST',
    headers: {
      ...STANDARD_API_HEADERS,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(input),
  })
  const data = await res.json()
  if (!res.ok) {
    const code = (data?.code as OperatorLoginError['code']) ?? 'AUTH_FAILED'
    throw new OperatorLoginErr(code)
  }
  return data as OperatorLoginResponse
}

export async function listOperatorTenants(): Promise<OperatorTenant[]> {
  return apiFetch<OperatorTenant[]>('/api/operator/tenants')
}

export async function operatorMfaEnroll(): Promise<OperatorMfaEnrollResponse> {
  return apiFetch<OperatorMfaEnrollResponse>('/api/operator/mfa/enroll', { method: 'POST' })
}

export async function operatorMfaVerify(token: string): Promise<{ mfaEnabled: boolean }> {
  return apiFetch<{ mfaEnabled: boolean }>('/api/operator/mfa/verify', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}
