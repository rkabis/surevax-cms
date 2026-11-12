import type { TransactionDetail } from '@/features/transactions/api'
import { ESC_POS, escposKV, escposLabelOrBlank, escposWrap, LINE_CHARS_57 } from './commands'
import { toCents, fromCents } from '@/lib/money'

/**
 * BIR Official Receipt header values. Present only when a branch has been
 * registered with the BIR for a computerized receipt; when present, the
 * renderers switch from acknowledgement-receipt mode to official-receipt mode.
 * Phase 1: always null (the clinic issues manual ORs on request).
 */
export type BirReceiptInfo = {
  tin: string
  registeredName: string
  permitNo: string
  accreditationNo: string | null
  orSeries: string | null
}

export type ClinicInfo = {
  name: string
  address: string
  phone: string
  initials: string
  bir?: BirReceiptInfo | null
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function buildReceiptNumber(initials: string, transactedAt: string): string {
  const d = new Date(transactedAt)
  return `${initials}-${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}`
}

function fmtAmount(val: string | null | undefined): string {
  const n = parseFloat(val ?? '0')
  if (Number.isNaN(n)) return '0.00'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Generate an ESC/POS acknowledgement receipt for a TransactionDetail.
// Mirrors the POS implementation's layout: 32-char fixed width, per-line reset.
export function generateReceiptESCPOS(txn: TransactionDetail, clinic: ClinicInfo): string {
  const transactedDate = new Date(txn.transactedAt)
  const receiptNumber = buildReceiptNumber(clinic.initials, txn.transactedAt)

  const patientName = txn.patient ? `${txn.patient.lastName}, ${txn.patient.firstName}` : ''

  const paymentMethodDisplay =
    txn.payments.length === 0
      ? '—'
      : txn.payments.length === 1
        ? (txn.payments[0]?.method ?? '—')
        : txn.payments.map((p) => p.method).join(' + ')

  const grossAmount = parseFloat(txn.grossAmount || '0')
  const discountAmount = parseFloat(txn.discountAmount || '0')
  const vatAmount = parseFloat(txn.vatAmount || '0')
  const netAmount = parseFloat(txn.netAmount || '0')
  // Server-truthed: `amountPaid` is trigger-maintained and `amountOutstanding`
  // is GENERATED (net - paid, floored at 0). Keeps the thermal print in step
  // with the on-screen preview on a partly-paid bill.
  const totalPaid = txn.amountPaid
  const balanceDue = txn.amountOutstanding
  const hasBalanceDue = toCents(balanceDue) > 0
  const change = fromCents(Math.max(0, toCents(totalPaid) - toCents(txn.netAmount)))
  const hasChange = toCents(change) > 0

  const bir = clinic.bir ?? null
  const isOfficial = bir !== null

  let out = ''
  out += ESC_POS.initialize()

  // Header
  escposWrap(isOfficial ? 'OFFICIAL RECEIPT' : 'ACKNOWLEDGEMENT RECEIPT').forEach((line) => {
    out += ESC_POS.printText(line, { align: 'center', bold: true })
  })
  escposWrap((isOfficial ? bir!.registeredName || clinic.name : clinic.name).toUpperCase()).forEach(
    (line) => {
      out += ESC_POS.printText(line, { align: 'center', bold: true })
    },
  )
  escposWrap(clinic.address).forEach((line) => {
    out += ESC_POS.printText(line, { align: 'center' })
  })
  if (clinic.phone) {
    escposWrap(clinic.phone).forEach((line) => {
      out += ESC_POS.printText(line, { align: 'center' })
    })
  }
  if (isOfficial) {
    escposWrap(`TIN: ${bir!.tin}`).forEach((line) => out += ESC_POS.printText(line, { align: 'center' })) // prettier-ignore
    if (bir!.permitNo) {
      escposWrap(`Permit: ${bir!.permitNo}`).forEach((line) => out += ESC_POS.printText(line, { align: 'center' })) // prettier-ignore
    }
    if (bir!.accreditationNo) {
      escposWrap(`Accred: ${bir!.accreditationNo}`).forEach((line) => out += ESC_POS.printText(line, { align: 'center' })) // prettier-ignore
    }
  }
  out += ESC_POS.printLine('=', LINE_CHARS_57)

  // Not-an-OR disclaimer (acknowledgement mode only)
  if (!isOfficial) {
    out += ESC_POS.printText('THIS IS NOT AN OFFICIAL RECEIPT', { align: 'center', bold: true })
    out += ESC_POS.printText('For acknowledgement only', { align: 'center' })
    out += ESC_POS.printLine('=', LINE_CHARS_57)
  }

  // Metadata
  if (isOfficial && (bir!.orSeries || txn.receiptNo)) {
    out += ESC_POS.printText(escposKV('OR No:', bir!.orSeries ?? txn.receiptNo ?? ''), {
      align: 'left',
    })
  }
  out += ESC_POS.printText(escposKV(isOfficial ? 'Ref No:' : 'Ack No:', receiptNumber), {
    align: 'left',
  })
  out += ESC_POS.printText(escposKV('Date:', transactedDate.toLocaleDateString('en-US')), {
    align: 'left',
  })
  out += ESC_POS.printText(
    escposKV(
      'Time:',
      transactedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    ),
    { align: 'left' },
  )
  escposLabelOrBlank('Patient:', patientName).forEach((line) => {
    out += ESC_POS.printText(line, { align: 'left' })
  })
  if (txn.discountIdType && txn.discountIdType !== 'NA') {
    escposLabelOrBlank(`SC/PWD ID (${txn.discountIdType}):`, txn.discountIdNumber).forEach(
      (line) => {
        out += ESC_POS.printText(line, { align: 'left' })
      },
    )
  }
  out += ESC_POS.printText(`Payment: ${paymentMethodDisplay}`, { align: 'left' })
  out += ESC_POS.printLine('-', LINE_CHARS_57)

  // Line items
  txn.items.forEach((item) => {
    const unitPrice = parseFloat(item.unitPrice || '0')
    const qty = parseFloat(item.quantity || '1')
    const subtotal = parseFloat(item.subtotal || '0')
    const serviceName = item.service?.name ?? 'Service'
    const serviceType = item.service?.serviceType

    escposWrap(serviceName).forEach((line) => {
      out += ESC_POS.printText(line, { align: 'left', bold: true })
    })
    if (serviceType) {
      escposWrap(`[${serviceType}]`).forEach((line) => {
        out += ESC_POS.printText(line, { align: 'left' })
      })
    }
    const qtyStr = qty % 1 === 0 ? qty.toFixed(0) : String(qty)
    const left = `${qtyStr} x PHP ${fmtAmount(String(unitPrice))}`
    const right = `PHP ${fmtAmount(String(subtotal))}`
    out += ESC_POS.printText(escposKV(left, right), { align: 'left' })
    out += ESC_POS.lineFeed(1)
  })

  out += ESC_POS.printLine('-', LINE_CHARS_57)

  // Totals
  out += ESC_POS.printText(escposKV('Subtotal:', `PHP ${fmtAmount(String(grossAmount))}`), {
    align: 'left',
  })
  if (discountAmount > 0) {
    out += ESC_POS.printText(escposKV('Discount:', `-PHP ${fmtAmount(String(discountAmount))}`), {
      align: 'left',
    })
  }
  if (vatAmount !== 0) {
    out += ESC_POS.printText(escposKV('VAT:', `PHP ${fmtAmount(String(vatAmount))}`), {
      align: 'left',
    })
  }
  out += ESC_POS.printLine('=', LINE_CHARS_57)
  out += ESC_POS.printText(`TOTAL: PHP ${fmtAmount(String(netAmount))}`, {
    align: 'center',
    bold: true,
  })
  out += ESC_POS.printLine('=', LINE_CHARS_57)

  // Payments
  txn.payments.forEach((p) => {
    out += ESC_POS.printText(escposKV(`${p.method}:`, `PHP ${fmtAmount(p.amount)}`), {
      align: 'left',
    })
  })
  out += ESC_POS.printText(escposKV('Total Paid:', `PHP ${fmtAmount(totalPaid)}`), {
    align: 'left',
    bold: true,
  })
  if (hasBalanceDue) {
    out += ESC_POS.printText(escposKV('Balance Due:', `PHP ${fmtAmount(balanceDue)}`), {
      align: 'left',
      bold: true,
    })
  }
  if (hasChange) {
    out += ESC_POS.printText(escposKV('Change:', `PHP ${fmtAmount(change)}`), {
      align: 'left',
      bold: true,
    })
  }

  out += ESC_POS.printLine('=', LINE_CHARS_57)

  // Footer
  out += ESC_POS.printText('Thank you for choosing', { align: 'center' })
  out += ESC_POS.printText(clinic.name, { align: 'center', bold: true })
  out += ESC_POS.printLine('=', LINE_CHARS_57)
  if (isOfficial) {
    out += ESC_POS.printText('This is your Official Receipt.', { align: 'center' })
  } else {
    out += ESC_POS.printText('This is an acknowledgement', { align: 'center' })
    out += ESC_POS.printText('receipt, not an Official', { align: 'center' })
    out += ESC_POS.printText('Receipt. An Official Receipt', { align: 'center' })
    out += ESC_POS.printText('(BIR) is issued on request.', { align: 'center' })
  }
  out += ESC_POS.printLine('=', LINE_CHARS_57)
  const printedAt = new Date()
  out += ESC_POS.printText(
    `${printedAt.toLocaleDateString('en-US')} ${printedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
    { align: 'center' },
  )

  out += ESC_POS.lineFeed(3)
  out += ESC_POS.cutPaper()
  return out
}
