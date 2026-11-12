import { useCallback, useRef, useState } from 'react'
import { FileUp, Paperclip, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type Attachment } from '@/hooks/useAttachments'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/toast'
import { formatBytes } from '@/lib/formatBytes'
import { API_BASE_URL, STANDARD_API_HEADERS } from '@/lib/api-base'

type Props = {
  ownerType: string
  ownerId: string
  category?: string
  onUploaded?: (attachment: Attachment) => void
}

function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest('SHA-256', buffer).then((hash) => {
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  })
}

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
])

function isAllowedType(file: File): boolean {
  if (ALLOWED_MIME_TYPES.has(file.type)) return true
  // Fallback: check extension for files where browser reports empty MIME
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return [
    'jpg',
    'jpeg',
    'png',
    'gif',
    'webp',
    'svg',
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'csv',
    'txt',
  ].includes(ext)
}

// ─── XHR helpers ──────────────────────────────────────────────────────────────

type MetadataPostInput = {
  ownerType: string
  ownerId: string
  fileName: string
  contentType: string
  sizeBytes: number
  storageBackend: string
  contentHashSha256: string
  isEncrypted: boolean
  category: string | null
  metadata: null
}

type MetadataPostResult = { data: Attachment }

/**
 * POST attachment metadata to /api/attachments via XHR.
 * CSRF header included. Credentials included.
 */
function xhrPost(
  url: string,
  body: MetadataPostInput,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<MetadataPostResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)
    xhr.withCredentials = true
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('X-Requested-With', 'fetch')

    xhr.upload.addEventListener('progress', (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        onProgress(Math.round((evt.loaded / evt.total) * 100))
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as MetadataPostResult)
        } catch {
          reject(new Error('Invalid JSON response from server'))
        }
      } else {
        reject(new Error(`Upload failed: HTTP ${xhr.status}`))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')))

    if (signal) {
      signal.addEventListener('abort', () => xhr.abort())
    }

    xhr.send(JSON.stringify(body))
  })
}

/**
 * PUT file bytes to a presigned R2 URL via XHR with real upload progress.
 *
 * The Content-Type header MUST match the value baked into the presigned
 * signature — sending a different type will cause R2 to reject the request.
 * No CSRF header is needed: the presigned URL itself is the authorization;
 * the PUT goes to R2's origin, not the app backend.
 */
function putToSignedUrl(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.setRequestHeader('Content-Type', contentType)

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`R2 upload failed: HTTP ${xhr.status}`))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Network error during R2 upload')))
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')))

    if (signal) {
      signal.addEventListener('abort', () => xhr.abort())
    }

    xhr.send(file)
  })
}

/**
 * AttachmentDropzone — full upload flow with real R2 binary transfer.
 *
 * The backend derives `storageKey` server-side from the authenticated tenant
 * (`uploads/{tenantId}/{uuid}/{sanitizedFilename}`); the client never sends a
 * path. This prevents path-traversal and cross-tenant overwrite attacks.
 *
 * Upload progress is tracked in five phases:
 *   Phase A (0  → 10 %): file read + SHA-256 hash (CPU-bound)
 *   Phase B (10 → 15 %): POST metadata to /api/attachments
 *   Phase C (15 → 20 %): GET presigned URL from /api/attachments/:id/upload-url
 *   Phase D (20 → 95 %): XHR PUT bytes to R2 (real upload progress)
 *   Phase E (95 → 100%): POST mark-uploaded to /api/attachments/:id/mark-uploaded
 */
export function AttachmentDropzone({ ownerType, ownerId, category, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const handleFile = useCallback((f: File | null) => {
    if (!f) return
    if (f.size > MAX_FILE_SIZE) {
      toast('File too large', { description: 'File exceeds 50 MB limit.' })
      return
    }
    if (!isAllowedType(f)) {
      toast('Unsupported file type', {
        description: 'Allowed: images, PDF, Word, Excel, CSV, TXT.',
      })
      return
    }
    setFile(f)
    setDone(false)
  }, [])

  const isUploading = progress !== null

  const handleUpload = useCallback(async () => {
    if (!file || isUploading) return

    setProgress(0)

    try {
      // Phase A: read file + compute SHA-256 hash (0 → 10 %)
      const buffer = await file.arrayBuffer()
      const hash = await sha256Hex(buffer)
      setProgress(10)

      const effectiveContentType = file.type || 'application/octet-stream'

      // Phase B: POST metadata to /api/attachments (10 → 15 %)
      const metadataResult = await xhrPost(
        '/api/attachments',
        {
          ownerType,
          ownerId,
          fileName: file.name,
          contentType: effectiveContentType,
          sizeBytes: file.size,
          storageBackend: 'r2',
          contentHashSha256: hash,
          isEncrypted: true,
          category: category ?? null,
          metadata: null,
        },
        (pct) => {
          // Map XHR send progress [0,100] → overall [10,15]
          setProgress(10 + Math.round((pct / 100) * 5))
        },
      )
      setProgress(15)

      const attachmentId = metadataResult.data.id

      // Phase C: GET presigned PUT URL (15 → 20 %)
      const urlRes = await fetch(`${API_BASE_URL}/api/attachments/${attachmentId}/upload-url`, {
        credentials: 'include',
        headers: STANDARD_API_HEADERS,
      })

      if (!urlRes.ok) {
        const body = (await urlRes.json().catch(() => ({}))) as { code?: string; error?: string }
        if (body.code === 'STORAGE_NOT_CONFIGURED') {
          // Local dev: storage not wired up yet. Treat as a soft warning.
          throw new Error('Object storage is not configured on this server. Binary upload skipped.')
        }
        throw new Error(`Failed to obtain upload URL: HTTP ${urlRes.status}`)
      }

      const { url: presignedUrl } = (await urlRes.json()) as { url: string; expiresIn: number }
      setProgress(20)

      // Phase D: PUT file bytes to R2 via presigned URL (20 → 95 %)
      await putToSignedUrl(presignedUrl, file, effectiveContentType, (pct) => {
        // Map R2 upload progress [0,100] → overall [20,95]
        setProgress(20 + Math.round((pct / 100) * 75))
      })
      setProgress(95)

      // Phase E: confirm upload to backend (95 → 100 %)
      await fetch(`${API_BASE_URL}/api/attachments/${attachmentId}/mark-uploaded`, {
        method: 'POST',
        credentials: 'include',
        headers: STANDARD_API_HEADERS,
      })
      setProgress(100)

      // Invalidate the attachments list query so callers see the new record
      void qc.invalidateQueries({ queryKey: ['attachments', ownerType, ownerId] })

      toast('File uploaded', { description: `${file.name} has been attached.` })

      setDone(true)
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      onUploaded?.(metadataResult.data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Upload failed', {
        description: msg.startsWith('Upload aborted') ? 'Upload was cancelled.' : msg,
      })
    } finally {
      // Small delay so the user sees 100% briefly before the bar disappears
      setTimeout(() => setProgress(null), 600)
    }
  }, [file, isUploading, ownerType, ownerId, category, onUploaded, qc])

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 transition-colors',
          isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-muted-foreground/50',
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setIsDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragOver(false)
          handleFile(e.dataTransfer.files[0] ?? null)
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
      >
        <Paperclip className="h-6 w-6 text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Drop files here or{' '}
            <span className="text-primary underline underline-offset-2">click to browse</span>
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Images, PDFs, and documents up to 50 MB
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {file && (
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={isUploading}
              className="ml-3 shrink-0"
            >
              {done ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Done
                </>
              ) : (
                <>
                  <FileUp className="h-4 w-4" />
                  Upload
                </>
              )}
            </Button>
          </div>

          {isUploading && (
            <div className="space-y-1">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground font-mono tabular-nums text-right">
                {progress}%
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
