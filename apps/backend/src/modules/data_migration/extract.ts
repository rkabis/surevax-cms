/**
 * XLSX extractor.
 *
 * Reads `surevax_gsheet_db.xlsx` into a {@link SourceBundle}. Uses exceljs so
 * the 14 MB workbook is read once into typed records.
 *
 * Public surface:
 *   - `extractFromFile(path)` — reads a workbook from disk, returns the full bundle.
 *   - `bundleFromMap(map)` — wraps a partial record into a SourceBundle with
 *     defaults for missing sheets. Used by tests to feed fixture rows directly.
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type { SourceBundle } from './types.js'

const SHEET_NAMES: ReadonlyArray<keyof SourceBundle> = [
  'Patient',
  'Immunization',
  'Transactions',
  'Remarks',
  'Vaccine',
  'Branch',
  'Nurse',
  'BranchReport',
  'ImmunizationBundle',
  'InventoryLog',
  'CashBalanceLog',
  'AdminEmails',
  'Discount',
  'TimeLog',
  'NurseShift',
  'ChargeAccounts',
]

export async function extractFromFile(filePath: string): Promise<SourceBundle> {
  const abs = path.resolve(filePath)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(abs)
  const bundle = emptyBundle()
  for (const sheetName of SHEET_NAMES) {
    const ws = wb.getWorksheet(sheetName)
    if (!ws) continue
    const rows = sheetToRecords(ws, wb.properties.date1904)
    ;(bundle as Record<string, unknown[]>)[sheetName] = rows
  }
  return bundle
}

type DriveChunk = {
  schemaVersion: 1
  sheet: string
  requestedRange: string
  values: unknown[][]
}

const DRIVE_DATE_HEADERS = new Set([
  'cbl_Timestamp',
  'Transaction Posting Date',
  'Service Render Date',
  'i_Timestamp_Ideal',
  'i_Timestamp_Actual',
  'p_DateOfBirth',
  'p_DateFirstVisit',
  'p_PetFirstARVDate',
  'r_Timestamp',
  't_Timestamp',
])

/**
 * Reconstruct an AppSheet source bundle from immutable Google Drive range
 * snapshots. Each sheet's first chunk owns the header; later chunks contain
 * continuation rows only. Google returns dates as Excel serials when
 * UNFORMATTED_VALUE is requested, so the known date columns are restored to
 * Date objects before the normal transforms see them.
 */
export async function extractFromDriveSnapshot(directory: string): Promise<SourceBundle> {
  const abs = path.resolve(directory)
  const names = (await readdir(abs)).filter((name) => name.endsWith('.json')).sort()
  const chunks = await Promise.all(
    names.map(async (name) => {
      const chunk = JSON.parse(await readFile(path.join(abs, name), 'utf8')) as DriveChunk
      if (chunk.schemaVersion !== 1 || !Array.isArray(chunk.values)) {
        throw new Error(`invalid Drive snapshot chunk: ${name}`)
      }
      return { name, chunk }
    }),
  )

  const bundle = emptyBundle()
  for (const sheetName of SHEET_NAMES) {
    const sheetChunks = chunks
      .filter(({ chunk }) => chunk.sheet === sheetName)
      .sort((a, b) => a.name.localeCompare(b.name))
    if (sheetChunks.length === 0) continue
    const headers = (sheetChunks[0]?.chunk.values[0] ?? []).map((value) => String(value ?? ''))
    if (headers.length === 0) throw new Error(`Drive snapshot sheet ${sheetName} has no header`)

    const records: Array<Record<string, unknown>> = []
    for (let chunkIndex = 0; chunkIndex < sheetChunks.length; chunkIndex += 1) {
      const values = sheetChunks[chunkIndex]?.chunk.values ?? []
      const rows = chunkIndex === 0 ? values.slice(1) : values
      for (const row of rows) {
        const record: Record<string, unknown> = {}
        let hasAny = false
        for (let column = 0; column < headers.length; column += 1) {
          const header = headers[column]
          if (!header) continue
          const raw = row[column]
          if (raw === null || raw === undefined || raw === '') continue
          const normalized = normalizeDriveValue(header, raw)
          record[header] = normalized
          hasAny = true
        }
        if (hasAny) records.push(record)
      }
    }
    ;(bundle as Record<string, unknown[]>)[sheetName] = records
  }
  return bundle
}

export function bundleFromMap(
  map: Partial<{ [K in keyof SourceBundle]: SourceBundle[K] }>,
): SourceBundle {
  return { ...emptyBundle(), ...map }
}

function emptyBundle(): SourceBundle {
  return {
    Patient: [],
    Immunization: [],
    Transactions: [],
    Remarks: [],
    Vaccine: [],
    Branch: [],
    Nurse: [],
    BranchReport: [],
    ImmunizationBundle: [],
    InventoryLog: [],
    CashBalanceLog: [],
    AdminEmails: [],
    Discount: [],
    TimeLog: [],
    NurseShift: [],
    ChargeAccounts: [],
  }
}

function sheetToRecords(ws: ExcelJS.Worksheet, date1904: boolean): Array<Record<string, unknown>> {
  const headerRow = ws.getRow(1)
  const headers: string[] = []
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellValue(cell) as string
  })
  const out: Array<Record<string, unknown>> = []
  const totalRows = ws.rowCount
  for (let r = 2; r <= totalRows; r++) {
    const row = ws.getRow(r)
    const record: Record<string, unknown> = {}
    let hasAny = false
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const header = headers[colNumber - 1]
      if (!header) return
      const v = cellValue(cell)
      const normalized = header === 'Row ID' ? rowIdValue(v, date1904) : v
      if (normalized !== null && normalized !== undefined && normalized !== '') {
        record[header] = normalized
        hasAny = true
      }
    })
    if (hasAny) out.push(record)
  }
  return out
}

/**
 * AppSheet row IDs are identifiers even when Google Sheets/XLSX leaves a date
 * number format on the cell. ExcelJS then exposes numeric IDs such as 1253939
 * as dates in the year 5333. Convert only the `Row ID` column back to its Excel
 * serial so foreign-key refs remain exact; genuine clinical date columns stay
 * as Date values.
 */
function rowIdValue(value: unknown, date1904: boolean): unknown {
  if (!(value instanceof Date)) return value
  const serial = 25569 + value.getTime() / 86_400_000 - (date1904 ? 1462 : 0)
  const nearestInteger = Math.round(serial)
  return String(Math.abs(serial - nearestInteger) < 1e-9 ? nearestInteger : serial)
}

function cellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value
  if (v === null || v === undefined) return null
  // exceljs returns objects for rich-text / formula / hyperlink cells. Flatten.
  if (typeof v === 'object') {
    const obj = v as unknown as Record<string, unknown>
    if (Array.isArray((obj as { richText?: unknown }).richText)) {
      const parts = (obj as { richText: Array<{ text?: string }> }).richText
      return parts.map((p) => p.text ?? '').join('')
    }
    if ('result' in obj) return (obj as { result: unknown }).result
    if ('text' in obj) return (obj as { text: unknown }).text
    if (v instanceof Date) return v
  }
  return v
}

function normalizeDriveValue(header: string, value: unknown): unknown {
  if (header === 'Row ID' && typeof value === 'number') return String(value)
  if (!DRIVE_DATE_HEADERS.has(header) || typeof value !== 'number') return value
  return new Date(Math.round((value - 25569) * 86_400_000))
}

export const __testing__ = { rowIdValue, normalizeDriveValue }
