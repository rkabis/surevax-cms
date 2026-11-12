import PDFDocument from 'pdfkit'
import { PassThrough } from 'node:stream'

export type HealthCardPatient = {
  displayId: string
  mrn: string | null
  firstName: string
  lastName: string
  middleName: string | null
  dateOfBirth: string | null
  sex: string | null
  contactNumber: string | null
  address: string | null
  province: string | null
  city: string | null
  barangay: string | null
  guardianName: string | null
  guardianRelationship: string | null
  guardianContact: string | null
  allergies: Array<{ allergen: string; severity: string | null; reaction: string | null }>
  conditions: Array<{ conditionName: string; status: string | null; icd10Code: string | null }>
}

function dash(v: string | null | undefined): string {
  return v?.trim() || '—'
}

function formatDob(raw: string | null): string {
  if (!raw) return '—'
  try {
    const d = new Date(raw)
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return raw
  }
}

/**
 * Compose a single-page patient health-card PDF using pdfkit.
 * Returns a PassThrough stream that emits the PDF bytes.
 *
 * Uses PassThrough so the caller can fork: one branch streams to the HTTP
 * response, another branch can be passed to the cloud uploader.
 */
export function buildHealthCardPdf(
  patient: HealthCardPatient,
  opts: { tenantName?: string; generatedAt?: Date },
): PassThrough {
  const out = new PassThrough()

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    autoFirstPage: true,
    bufferPages: false,
  })

  doc.pipe(out)

  const PAGE_WIDTH = doc.page.width - 100 // margins
  const LEFT = 50
  const generatedAt = opts.generatedAt ?? new Date()
  const tenantName = opts.tenantName ?? 'SureVax Clinic'

  // ── Header ─────────────────────────────────────────────────────────────────
  doc
    .fontSize(16)
    .font('Helvetica-Bold')
    .text('PATIENT HEALTH CARD', LEFT, 50, { align: 'center', width: PAGE_WIDTH })

  doc
    .fontSize(10)
    .font('Helvetica')
    .text(tenantName, LEFT, 72, { align: 'center', width: PAGE_WIDTH })

  doc
    .moveTo(LEFT, 90)
    .lineTo(LEFT + PAGE_WIDTH, 90)
    .stroke()

  // MRN badge — right-aligned
  doc
    .fontSize(9)
    .font('Helvetica-Bold')
    .text(`MRN: ${dash(patient.mrn)}`, LEFT, 97, { align: 'right', width: PAGE_WIDTH })

  // MRN-only on the patient-facing card; the internal display_id is not
  // shown — it's an opaque server handle, not patient-friendly.

  // ── Patient Identity ────────────────────────────────────────────────────────
  let y = 120

  doc.fontSize(11).font('Helvetica-Bold').text('PATIENT INFORMATION', LEFT, y)
  y += 16
  doc
    .moveTo(LEFT, y)
    .lineTo(LEFT + PAGE_WIDTH, y)
    .strokeColor('#cccccc')
    .stroke()
  doc.strokeColor('#000000')
  y += 8

  const fullName = [patient.lastName, patient.firstName, patient.middleName]
    .filter(Boolean)
    .join(', ')

  const fields: Array<[string, string]> = [
    ['Full Name', fullName],
    ['Date of Birth', formatDob(patient.dateOfBirth)],
    ['Sex', dash(patient.sex)],
    ['Contact Number', dash(patient.contactNumber)],
    [
      'Address',
      [patient.address, patient.barangay, patient.city, patient.province]
        .filter(Boolean)
        .join(', ') || '—',
    ],
  ]

  for (const [label, value] of fields) {
    doc.fontSize(9).font('Helvetica-Bold').text(`${label}:`, LEFT, y, { continued: false })
    doc
      .fontSize(9)
      .font('Helvetica')
      .text(value, LEFT + 120, y - 11, {
        width: PAGE_WIDTH - 120,
      })
    y += 16
  }

  y += 8

  // ── Allergies ───────────────────────────────────────────────────────────────
  doc.fontSize(11).font('Helvetica-Bold').text('KNOWN ALLERGIES', LEFT, y)
  y += 16
  doc
    .moveTo(LEFT, y)
    .lineTo(LEFT + PAGE_WIDTH, y)
    .strokeColor('#cccccc')
    .stroke()
  doc.strokeColor('#000000')
  y += 8

  const allergies = patient.allergies.slice(0, 5)
  if (allergies.length === 0) {
    doc.fontSize(9).font('Helvetica').text('No known allergies recorded.', LEFT, y)
    y += 16
  } else {
    for (const a of allergies) {
      const parts = [a.allergen]
      if (a.severity) parts.push(`[${a.severity}]`)
      if (a.reaction) parts.push(`— ${a.reaction}`)
      doc
        .fontSize(9)
        .font('Helvetica')
        .text(`• ${parts.join(' ')}`, LEFT + 8, y, {
          width: PAGE_WIDTH - 8,
        })
      y += 14
    }
  }

  y += 8

  // ── Active Conditions ───────────────────────────────────────────────────────
  doc.fontSize(11).font('Helvetica-Bold').text('ACTIVE CONDITIONS', LEFT, y)
  y += 16
  doc
    .moveTo(LEFT, y)
    .lineTo(LEFT + PAGE_WIDTH, y)
    .strokeColor('#cccccc')
    .stroke()
  doc.strokeColor('#000000')
  y += 8

  const conditions = patient.conditions
    .filter((c) => c.status?.toLowerCase() !== 'resolved')
    .slice(0, 5)

  if (conditions.length === 0) {
    doc.fontSize(9).font('Helvetica').text('No active conditions recorded.', LEFT, y)
    y += 16
  } else {
    for (const c of conditions) {
      const parts = [c.conditionName]
      if (c.icd10Code) parts.push(`(${c.icd10Code})`)
      if (c.status) parts.push(`[${c.status}]`)
      doc
        .fontSize(9)
        .font('Helvetica')
        .text(`• ${parts.join(' ')}`, LEFT + 8, y, {
          width: PAGE_WIDTH - 8,
        })
      y += 14
    }
  }

  y += 8

  // ── Emergency Contact ───────────────────────────────────────────────────────
  doc.fontSize(11).font('Helvetica-Bold').text('EMERGENCY CONTACT', LEFT, y)
  y += 16
  doc
    .moveTo(LEFT, y)
    .lineTo(LEFT + PAGE_WIDTH, y)
    .strokeColor('#cccccc')
    .stroke()
  doc.strokeColor('#000000')
  y += 8

  if (patient.guardianName) {
    const contactFields: Array<[string, string]> = [
      ['Name', dash(patient.guardianName)],
      ['Relationship', dash(patient.guardianRelationship)],
      ['Contact', dash(patient.guardianContact)],
    ]
    for (const [label, value] of contactFields) {
      doc.fontSize(9).font('Helvetica-Bold').text(`${label}:`, LEFT, y, { continued: false })
      doc
        .fontSize(9)
        .font('Helvetica')
        .text(value, LEFT + 120, y - 11, {
          width: PAGE_WIDTH - 120,
        })
      y += 16
    }
  } else {
    doc.fontSize(9).font('Helvetica').text('No emergency contact recorded.', LEFT, y)
  }

  // ── Footer ──────────────────────────────────────────────────────────────────
  const footerY = doc.page.height - 60
  doc
    .moveTo(LEFT, footerY)
    .lineTo(LEFT + PAGE_WIDTH, footerY)
    .strokeColor('#cccccc')
    .stroke()

  const ts = generatedAt.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  })
  doc
    .fontSize(8)
    .font('Helvetica')
    .fillColor('#777777')
    .text(`Generated: ${ts} · ${tenantName} · For official use only`, LEFT, footerY + 6, {
      align: 'center',
      width: PAGE_WIDTH,
    })

  doc.end()
  return out
}
