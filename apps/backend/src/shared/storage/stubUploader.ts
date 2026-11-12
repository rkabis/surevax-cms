import type { CloudStorageUploader } from './CloudStorageUploader.js'

/**
 * StubUploader — no-op adapter used when no cloud storage is configured.
 * Drains the PDF stream (so it doesn't leak) and returns null.
 * Phase 2: replace by returning an R2Uploader from getUploader().
 */
export class StubUploader implements CloudStorageUploader {
  async uploadPatientHealthCard(args: {
    tenantId: string
    patientDisplayId: string
    pdfStream: NodeJS.ReadableStream
    fileName: string
  }): Promise<number | null> {
    // Drain the stream to avoid memory leaks; no-op cloud upload.
    await new Promise<void>((resolve, reject) => {
      args.pdfStream.on('data', () => {
        // consume
      })
      args.pdfStream.on('end', resolve)
      args.pdfStream.on('error', reject)
    })
    return null
  }
}
