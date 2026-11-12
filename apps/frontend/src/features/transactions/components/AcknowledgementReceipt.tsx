import type { TransactionDetail } from '../api'
import { formatLongDate, formatMoney } from '@/lib/format'
import { toCents, fromCents } from '@/lib/money'
import type { ClinicInfo } from '@/lib/escpos'

// Clinic header values come from the transaction's branch (see buildClinicInfo
// in ../receiptClinic). When `clinic.bir` is present the branch is BIR-registered
// and this renders as an Official Receipt; otherwise it renders as an
// acknowledgement receipt (Phase 1 — the clinic issues manual ORs on request).

type Props = {
  transaction: TransactionDetail
  clinic: ClinicInfo
}

function padStart2(n: number): string {
  return String(n).padStart(2, '0')
}

function buildReceiptNumber(initials: string, transactedAt: string): string {
  const d = new Date(transactedAt)
  const mm = padStart2(d.getMonth() + 1)
  const dd = padStart2(d.getDate())
  const hh = padStart2(d.getHours())
  const min = padStart2(d.getMinutes())
  return `${initials}-${mm}${dd}${hh}${min}`
}

const DASH_LINE = '================================'

export default function AcknowledgementReceipt({ transaction: txn, clinic }: Props) {
  const bir = clinic.bir ?? null
  const isOfficial = bir !== null

  const transactedDate = new Date(txn.transactedAt)
  const receiptNumber = buildReceiptNumber(clinic.initials, txn.transactedAt)

  const patientName = txn.patient ? `${txn.patient.lastName}, ${txn.patient.firstName}` : '—'
  const multiPatient = txn.patients.length > 1

  const paymentMethodDisplay =
    txn.payments.length === 0
      ? '—'
      : txn.payments.length === 1
        ? (txn.payments[0]?.method ?? '—')
        : txn.payments.map((p) => p.method).join(' + ')

  // Paid + balance come from the server (trigger-maintained `amountPaid`, and
  // `amountOutstanding` GENERATED as net - paid floored at 0), so a downpayment
  // receipt states the same remainder the account surfaces do.
  const totalPaid = txn.amountPaid
  const balanceDue = txn.amountOutstanding
  const hasBalanceDue = toCents(balanceDue) > 0
  const netAmount = parseFloat(txn.netAmount || '0')
  const change = fromCents(Math.max(0, toCents(totalPaid) - toCents(txn.netAmount)))
  const hasChange = toCents(change) > 0

  const grossAmount = parseFloat(txn.grossAmount || '0')
  const discountAmount = parseFloat(txn.discountAmount || '0')
  const hasDiscount = discountAmount > 0

  // BIR-conformant VAT breakdown (PH inclusive pricing — VAT is embedded in the price).
  // VATable Sales = total vatable base excl. VAT = vatAmount / 0.12
  // The receipt must foot: VATableSales + VATAmount + VATExempt = netAmount
  const vatAmount = parseFloat(txn.vatAmount || '0')
  const vatableSales = vatAmount > 0 ? Math.round((vatAmount / 0.12) * 100) / 100 : 0
  const vatExemptSales = Math.round((netAmount - vatableSales - vatAmount) * 100) / 100

  const printedAt = new Date()

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '1mm',
    fontSize: '10px',
  }

  return (
    <div
      className="printable-receipt"
      style={{
        fontFamily: "'Courier New', monospace",
        maxWidth: '80mm',
        width: '100%',
        margin: '0 auto',
        padding: '4mm',
        background: '#fff',
        color: '#000',
        fontSize: '11px',
        lineHeight: '1.4',
      }}
    >
      {/* Header */}
      <div
        style={{
          textAlign: 'center',
          borderBottom: '2px solid #000',
          paddingBottom: '4mm',
          marginBottom: '3mm',
        }}
      >
        <div
          style={{
            fontWeight: 'bold',
            fontSize: '13px',
            letterSpacing: '1px',
            marginBottom: '2mm',
          }}
        >
          {isOfficial ? 'OFFICIAL RECEIPT' : 'ACKNOWLEDGEMENT RECEIPT'}
        </div>
        <div style={{ fontSize: '10px', marginBottom: '1mm' }}>
          {(isOfficial ? bir.registeredName || clinic.name : clinic.name).toUpperCase()}
        </div>
        <div style={{ fontSize: '10px', marginBottom: '1mm' }}>{clinic.address}</div>
        <div style={{ fontSize: '10px' }}>{clinic.phone}</div>
        {isOfficial && (
          <div style={{ fontSize: '9px', marginTop: '1mm' }}>
            <div>TIN: {bir.tin}</div>
            {bir.permitNo && <div>Permit No: {bir.permitNo}</div>}
            {bir.accreditationNo && <div>Accreditation: {bir.accreditationNo}</div>}
          </div>
        )}
      </div>

      {/* Not-an-OR disclaimer (acknowledgement mode only) */}
      {!isOfficial && (
        <div
          style={{
            textAlign: 'center',
            border: '1px solid #000',
            padding: '2mm',
            marginBottom: '3mm',
            fontSize: '9px',
            lineHeight: '1.4',
          }}
        >
          <div style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '1mm' }}>
            THIS IS NOT AN OFFICIAL RECEIPT
          </div>
          <div>Issued for acknowledgement only.</div>
          <div>An Official Receipt (BIR) is issued upon request.</div>
        </div>
      )}

      {/* Transaction metadata */}
      <div style={{ marginBottom: '3mm', paddingBottom: '3mm', borderBottom: '1px dashed #333' }}>
        {isOfficial && (bir.orSeries || txn.receiptNo) && (
          <div style={rowStyle}>
            <span>OR No:</span>
            <span style={{ fontWeight: 600 }}>{bir.orSeries ?? txn.receiptNo}</span>
          </div>
        )}
        <div style={rowStyle}>
          <span>{isOfficial ? 'Ref No:' : 'Ack No:'}</span>
          <span style={{ fontWeight: 600 }}>{receiptNumber}</span>
        </div>
        {txn.branchSeq !== null && (
          <div style={rowStyle}>
            <span>Branch Txn #:</span>
            <span style={{ fontWeight: 600 }}>{txn.branchSeq.toLocaleString('en-PH')}</span>
          </div>
        )}
        <div style={rowStyle}>
          <span>Date:</span>
          <span>{formatLongDate(transactedDate)}</span>
        </div>
        <div style={rowStyle}>
          <span>Time:</span>
          <span>
            {transactedDate.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div style={rowStyle}>
          <span>Patient:</span>
          <span style={{ textAlign: 'right', maxWidth: '55%', wordBreak: 'break-word' }}>
            {multiPatient ? `${patientName} +${txn.patients.length - 1} more` : patientName}
          </span>
        </div>
        {!multiPatient && txn.discountIdType && txn.discountIdType !== 'NA' && (
          <div style={rowStyle}>
            <span>SC/PWD ID ({txn.discountIdType}):</span>
            <span>{txn.discountIdNumber ?? '—'}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
          <span>Payment:</span>
          <span style={{ textAlign: 'right', maxWidth: '55%' }}>{paymentMethodDisplay}</span>
        </div>
      </div>

      {/* Line items — grouped per patient on multi-patient bills */}
      <div style={{ marginBottom: '3mm', paddingBottom: '3mm', borderBottom: '1px dashed #333' }}>
        {txn.items.length === 0 && <div style={{ fontSize: '10px', color: '#555' }}>No items.</div>}
        {(multiPatient
          ? txn.patients.map((p) => ({
              key: p.patient.id,
              heading: `${p.patient.lastName}, ${p.patient.firstName}`,
              discount: p.discountIdType
                ? `${p.discountIdType}${p.discountIdNumber ? ` · ${p.discountIdNumber}` : ''}`
                : null,
              items: txn.items.filter((it) => it.patient?.id === p.patient.id),
            }))
          : [{ key: 'all', heading: null, discount: null, items: txn.items }]
        ).map((group) => (
          <div key={group.key} style={{ marginBottom: multiPatient ? '2.5mm' : 0 }}>
            {group.heading && (
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 'bold',
                  borderBottom: '1px dotted #999',
                  marginBottom: '1mm',
                }}
              >
                {group.heading}
                {group.discount && (
                  <span style={{ fontWeight: 'normal', color: '#444' }}> · {group.discount}</span>
                )}
              </div>
            )}
            {group.items.map((item) => {
              const unitPrice = parseFloat(item.unitPrice || '0')
              const qty = parseFloat(item.quantity || '1')
              const subtotal = parseFloat(item.subtotal || '0')
              const serviceName = item.service?.name ?? 'Service'
              const serviceType = item.service?.serviceType

              return (
                <div key={item.id} style={{ marginBottom: '2mm' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '10px', wordBreak: 'break-word' }}>
                    {serviceName}
                  </div>
                  {serviceType && (
                    <div
                      style={{
                        fontSize: '9px',
                        color: '#444',
                        marginLeft: '2mm',
                        marginBottom: '1mm',
                      }}
                    >
                      [{serviceType}]
                    </div>
                  )}
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}
                  >
                    <span>
                      {qty % 1 === 0 ? qty.toFixed(0) : qty} x {formatMoney(unitPrice)}
                    </span>
                    <span style={{ fontWeight: 600 }}>{formatMoney(subtotal)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Totals — VAT-inclusive PH pricing breakdown (informational on the ack receipt) */}
      <div style={{ marginBottom: '3mm', paddingBottom: '3mm', borderBottom: '1px dashed #333' }}>
        {hasDiscount && (
          <div style={rowStyle}>
            <span>Gross amount:</span>
            <span>{formatMoney(grossAmount)}</span>
          </div>
        )}
        {hasDiscount && (
          <div style={rowStyle}>
            <span>Discount (SC/PWD):</span>
            <span>-{formatMoney(discountAmount)}</span>
          </div>
        )}
        {/* VAT breakdown lines — must foot to TOTAL */}
        <div style={rowStyle}>
          <span>VATable sales:</span>
          <span>{formatMoney(vatableSales)}</span>
        </div>
        {vatExemptSales > 0.005 && (
          <div style={rowStyle}>
            <span>VAT-exempt sales:</span>
            <span>{formatMoney(vatExemptSales)}</span>
          </div>
        )}
        <div style={rowStyle}>
          <span>VAT amount (12%):</span>
          <span>{formatMoney(vatAmount)}</span>
        </div>
        {/* Emphasized total box — equals vatableSales + vatExemptSales + vatAmount */}
        <div
          style={{
            fontWeight: 'bold',
            fontSize: '12px',
            textAlign: 'center',
            margin: '3mm 0',
            padding: '2mm 0',
            borderTop: '2px solid #000',
            borderBottom: '2px solid #000',
            letterSpacing: '1px',
          }}
        >
          TOTAL: {formatMoney(txn.netAmount)}
        </div>
      </div>

      {/* Payments breakdown */}
      <div style={{ marginBottom: '3mm', paddingBottom: '3mm', borderBottom: '1px dashed #333' }}>
        {txn.payments.map((p) => (
          <div key={p.id} style={rowStyle}>
            <span>{p.method}:</span>
            <span>{formatMoney(p.amount)}</span>
          </div>
        ))}
        <div style={rowStyle}>
          <span>Total Paid:</span>
          <span style={{ fontWeight: 600 }}>{formatMoney(totalPaid)}</span>
        </div>
        {hasBalanceDue && (
          <div style={{ ...rowStyle, fontWeight: 700 }}>
            <span>Balance Due:</span>
            <span>{formatMoney(balanceDue)}</span>
          </div>
        )}
        {hasChange && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
            <span>Change:</span>
            <span>{formatMoney(change)}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', fontSize: '9px', lineHeight: '1.5' }}>
        <div>{DASH_LINE}</div>
        <div>Thank you for choosing</div>
        <div style={{ fontWeight: 'bold' }}>{clinic.name}</div>
        <div>{DASH_LINE}</div>
        {isOfficial ? (
          <div>This is your Official Receipt.</div>
        ) : (
          <>
            <div>This is an acknowledgement</div>
            <div>receipt, not an Official Receipt.</div>
            <div>An Official Receipt (BIR) is</div>
            <div>issued upon request.</div>
          </>
        )}
        <div>{DASH_LINE}</div>
        <div style={{ marginTop: '1mm' }}>
          {printedAt.toLocaleDateString('en-PH')}{' '}
          {printedAt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}
