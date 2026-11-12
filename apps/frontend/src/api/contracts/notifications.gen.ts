// GENERATED FILE — do not edit.
// Source: apps/backend/src/modules — contract 'notifications'.
// Regenerate with `pnpm gen:contracts`; CI fails on drift.

export type NotificationsListQuery = {
  status?: 'Queued' | 'Sent' | 'Failed' | 'Cancelled'
  patientId?: number
  channel?: 'SMS' | 'Email' | 'Push'
  cursor?: string
  limit?: number
}

export type NotificationsListResponse = {
  id: string
  tenantId: string
  templateId: number | null
  templateDisplayId: string | null
  templateCode: string | null
  patientId: number | null
  patientName: string | null
  userId: number | null
  channel: string
  recipientAddress: string | null
  subject: string | null
  body: string
  status: string
  scheduledAt: string | null
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  externalMessageId: string | null
  retryCount: number
  failureReason: string | null
  consentVerifiedAt: string | null
  metadata: unknown
  rowVersion: number
  createdAt: string
  updatedAt: string
  createdById: number | null
  createdBy: { id: number; displayId: string; firstName: string; lastName: string } | null
}[]

export type NotificationsDetailIdParam = number

export type NotificationsDetailResponse = {
  id: string
  tenantId: string
  templateId: number | null
  templateDisplayId: string | null
  templateCode: string | null
  patientId: number | null
  patientName: string | null
  userId: number | null
  channel: string
  recipientAddress: string | null
  subject: string | null
  body: string
  status: string
  scheduledAt: string | null
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  externalMessageId: string | null
  retryCount: number
  failureReason: string | null
  consentVerifiedAt: string | null
  metadata: unknown
  rowVersion: number
  createdAt: string
  updatedAt: string
  createdById: number | null
  createdBy: { id: number; displayId: string; firstName: string; lastName: string } | null
}

export type NotificationsResendIdParam = number

export type NotificationsResendResponse = { id: string }

export type NotificationsDryRunBody = {
  patientId: number
  templateCode?: string | undefined | null
  channel: 'SMS' | 'Email' | 'Push'
  body?: string | undefined | null
}

export type NotificationsDryRunResponse = {
  id: string
  tenantId: string
  patientId: number
  templateId: number | null
  channel: string
  body: string
  status: string
  createdAt: string
}

export const notificationsEndpoints = {
  list: { method: 'GET', path: '/api/admin/notifications' },
  detail: { method: 'GET', path: '/api/admin/notifications/:id' },
  resend: { method: 'POST', path: '/api/admin/notifications/:id/resend' },
  dryRun: { method: 'POST', path: '/api/admin/notifications/dry-run' },
} as const
