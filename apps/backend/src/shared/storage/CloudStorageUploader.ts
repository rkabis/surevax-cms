/**
 * CloudStorageUploader — interface for uploading patient health-card PDFs to
 * cloud storage. The stub implementation returns null (no-op). When R2 is
 * wired in Phase 2, a real adapter is registered via getUploader() without
 * touching any call sites.
 */
export interface CloudStorageUploader {
  /**
   * Upload a PDF (or other blob) to cloud storage and return the attachment_id
   * (bigint) for the created `attachments` row.
   *
   * Returns null when no cloud storage is configured — callers MUST treat null
   * as "no cloud copy stored" and skip the patients.health_card_attachment_id
   * update.
   */
  uploadPatientHealthCard(args: {
    tenantId: string
    patientDisplayId: string
    pdfStream: NodeJS.ReadableStream
    fileName: string
  }): Promise<number | null>
}
