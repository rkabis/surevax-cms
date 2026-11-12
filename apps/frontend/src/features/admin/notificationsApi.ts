import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'
import { useRecentList, type RecentListResult } from '@/lib/useRecentList'
// Wire types are generated from the backend contract — run `pnpm gen:contracts`.
import type {
  NotificationsListResponse,
  NotificationsDetailResponse,
  NotificationsResendResponse,
  NotificationsDryRunBody,
  NotificationsDryRunResponse,
} from '@/api/contracts/notifications.gen'

// ── Wire-type aliases ─────────────────────────────────────────────────────────

/** Single notification row — aliased from the generated wire type. */
export type Notification = NotificationsListResponse[number]

/** Detail response — same shape as a list row; aliased for named usage. */
export type NotificationDetail = NotificationsDetailResponse

/** Resend response — `{ id: string }` */
export type NotificationResendResult = NotificationsResendResponse

/** Dry-run request body */
export type DryRunBody = NotificationsDryRunBody

/** Dry-run response from the backend */
export type DryRunResult = NotificationsDryRunResponse

// ── Frontend-only view types ──────────────────────────────────────────────────

/**
 * NotificationStatus is broader than the backend enum to support UI tabs
 * ('Sending', 'Delivered', 'Read') that may appear in older data or future
 * status values. The backend query param accepts the contract enum subset.
 */
export type NotificationStatus = 'Queued' | 'Sending' | 'Sent' | 'Delivered' | 'Read' | 'Failed'

export type NotificationChannel = 'SMS' | 'Email' | 'InApp'

export type NotificationsFilters = {
  status?: NotificationStatus
  channel?: NotificationChannel
  patientId?: string
  limit?: number
}

// ── Notification hooks ────────────────────────────────────────────────────────

export function useNotifications(
  filters: NotificationsFilters = {},
): RecentListResult<Notification> {
  return useRecentList<Notification>({
    endpoint: '/api/admin/notifications',
    query: {
      status: filters.status,
      channel: filters.channel,
      patientId: filters.patientId,
    },
    queryKey: [
      'notifications',
      filters.status ?? '',
      filters.channel ?? '',
      filters.patientId ?? '',
    ],
    pageSize: filters.limit ?? 50,
  })
}

export function useNotification(id: string | null) {
  return useQuery<NotificationDetail>({
    queryKey: ['notification', id],
    queryFn: () => apiFetch<NotificationDetail>(`/api/admin/notifications/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useResendNotification() {
  const qc = useQueryClient()
  return useMutation<NotificationResendResult, Error, { id: string }>({
    mutationFn: ({ id }) =>
      apiFetch<NotificationResendResult>(`/api/admin/notifications/${id}/resend`, {
        method: 'POST',
      }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['notification', vars.id] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useDryRunNotification() {
  return useMutation<DryRunResult, Error, DryRunBody>({
    mutationFn: (body) =>
      apiFetch<DryRunResult>('/api/admin/notifications/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    // no invalidation — returns a preview only
  })
}

// ── Notification Template types ───────────────────────────────────────────────

export type NotificationTemplateChannel = 'SMS' | 'Email' | 'Push'

// `name` is intentionally absent — notification_templates has no `name` column;
// `code` is the human-readable identifier.
export type NotificationTemplate = {
  id: string
  tenantId: string
  code: string
  channel: NotificationTemplateChannel
  language: string
  subject: string | null
  body: string
  isActive: boolean
  rowVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  createdById: string | null
}

export type CreateNotificationTemplateInput = {
  code: string
  channel: NotificationTemplateChannel
  language?: string
  subject?: string
  body: string
  isActive?: boolean
}

export type UpdateNotificationTemplateInput = {
  code?: string
  channel?: NotificationTemplateChannel
  language?: string
  subject?: string
  body?: string
  isActive?: boolean
}

export type NotificationTemplateFilters = {
  channel?: NotificationTemplateChannel
  code?: string
  isActive?: boolean
}

type TemplateListResponse = { data: NotificationTemplate[] }

// ── Notification Template hooks ───────────────────────────────────────────────

export function useNotificationTemplates(filters: NotificationTemplateFilters = {}) {
  return useQuery<TemplateListResponse>({
    queryKey: ['notification-templates', filters],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters.channel) params.set('channel', filters.channel)
      if (filters.code) params.set('code', filters.code)
      if (filters.isActive !== undefined) params.set('isActive', String(filters.isActive))
      const qs = params.toString()
      return apiFetch<TemplateListResponse>(
        `/api/admin/notification-templates${qs ? `?${qs}` : ''}`,
      )
    },
    staleTime: 30_000,
  })
}

export function useNotificationTemplate(id: string | null) {
  return useQuery<NotificationTemplate>({
    queryKey: ['notification-template', id],
    queryFn: () => apiFetch<NotificationTemplate>(`/api/admin/notification-templates/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useCreateNotificationTemplate() {
  const qc = useQueryClient()
  return useMutation<NotificationTemplate, Error, CreateNotificationTemplateInput>({
    mutationFn: (body) =>
      apiFetch<NotificationTemplate>('/api/admin/notification-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notification-templates'] })
    },
  })
}

export function useUpdateNotificationTemplate() {
  const qc = useQueryClient()
  return useMutation<
    NotificationTemplate,
    Error,
    { id: string; body: UpdateNotificationTemplateInput }
  >({
    mutationFn: ({ id, body }) =>
      apiFetch<NotificationTemplate>(`/api/admin/notification-templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['notification-template', vars.id] })
      void qc.invalidateQueries({ queryKey: ['notification-templates'] })
    },
  })
}

// Backend does not enforce optimistic concurrency on this endpoint yet — the
// caller doesn't pass rowVersion. (When the backend grows an If-Match-style
// guard, accept it here and forward it as a header.)
export function useDeleteNotificationTemplate() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) =>
      apiFetch<void>(`/api/admin/notification-templates/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notification-templates'] })
    },
  })
}
