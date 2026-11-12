import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/apiFetch'

export type Attachment = {
  id: string
  tenantId: string
  ownerType: string
  ownerId: string
  fileName: string
  contentType: string
  sizeBytes: number
  storageBackend: string
  storageKey: string
  contentHashSha256: string
  isEncrypted: boolean
  category: string | null
  metadata: Record<string, unknown> | null
  uploadedById: string | null
  uploadedAt: string
  deletedAt: string | null
  uploaderName: string | null
}

type ListResponse = { data: Attachment[]; total: number }

export function useAttachmentList(ownerType: string, ownerId: string) {
  return useQuery<ListResponse>({
    queryKey: ['attachments', ownerType, ownerId],
    queryFn: () =>
      apiFetch(
        `/api/attachments?ownerType=${encodeURIComponent(ownerType)}&ownerId=${encodeURIComponent(ownerId)}`,
      ),
    staleTime: 30_000,
  })
}

export function useDeleteAttachment() {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean }, Error, { id: string; ownerType: string; ownerId: string }>({
    mutationFn: ({ id }) => apiFetch(`/api/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: (_, variables) => {
      void qc.invalidateQueries({
        queryKey: ['attachments', variables.ownerType, variables.ownerId],
      })
    },
  })
}
