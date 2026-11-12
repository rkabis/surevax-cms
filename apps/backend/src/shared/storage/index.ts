import type { CloudStorageUploader } from './CloudStorageUploader.js'
import { StubUploader } from './stubUploader.js'

export type { CloudStorageUploader }

/**
 * Factory — returns the active CloudStorageUploader.
 *
 * Phase 1: always returns StubUploader (null cloud copy).
 * Phase 2: set CLOUD_STORAGE_UPLOADER=r2 to swap in the real R2 adapter:
 *   return process.env.CLOUD_STORAGE_UPLOADER === 'r2'
 *     ? new R2Uploader(...)
 *     : new StubUploader()
 */
export function getUploader(): CloudStorageUploader {
  return new StubUploader()
}
