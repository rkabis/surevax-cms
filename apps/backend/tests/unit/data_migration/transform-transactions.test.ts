import { describe, it, expect } from 'vitest'
import { transformTransactions } from '../../../src/modules/data_migration/transform/transactions.js'

const svcMap = new Map<string, string>([['ARVPEP_AbhayrabID', 'ARVPEP_ID']])

describe('transformTransactions', () => {
  it('fans out payment-method columns into separate payments rows', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN1',
          t_Timestamp: new Date('2024-07-29T12:00:00Z'),
          t_PatientRef: 'PAT-A',
          t_NurseRef: 'RoberosePuri',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 800,
          t_TotalAmount: 800,
          t_TotalAmountPaid: 800,
          t_AmountPaid_Cash: 500,
          t_AmountPaid_GCash: 300,
        },
      ],
      [],
      [],
      'SVX',
      svcMap,
    )
    expect(out.transactions).toHaveLength(1)
    expect(out.payments).toHaveLength(2)
    expect(out.payments.map((p) => p.method).sort()).toEqual(['Cash', 'GCash'])
    expect(out.transactions[0]!.status).toBe('Paid')
  })

  it('emits one transaction_items row per linked immunization', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN2',
          t_Timestamp: new Date('2024-07-29T12:00:00Z'),
          t_PatientRef: 'PAT-A',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 1600,
          t_AmountPaid_Cash: 1600,
        },
      ],
      [
        {
          'Row ID': 'IMM1',
          i_TransactionRef: 'TXN2',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_DosagePrice: 800,
          i_DosageCount: '1',
        },
        {
          'Row ID': 'IMM2',
          i_TransactionRef: 'TXN2',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_DosagePrice: 800,
          i_DosageCount: '1',
        },
      ],
      [],
      'SVX',
      svcMap,
    )
    expect(out.items).toHaveLength(2)
    expect(out.items.every((i) => i.serviceId === 'ARVPEP_ID')).toBe(true)
  })

  it('records a discountIdType from t_DiscountRef', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN3',
          t_Timestamp: new Date(),
          t_PatientRef: 'PAT-A',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 1000,
          t_DiscountRef: 'Senior',
          t_Adjustment: -200,
          t_AmountPaid_Cash: 800,
        },
      ],
      [],
      [],
      'SVX',
      svcMap,
    )
    expect(out.transactions[0]!.discountIdType).toBe('OSCA')
    expect(out.transactions[0]!.discountIdNumber).toBe('SENIOR_LEGACY')
    expect(out.transactions[0]!.discountAmount).toBe('200.00')
  })

  it('maps t_DiscountRef=FullyPaid to discount_id_type=Other + ₱200 fixed amount', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN5',
          t_Timestamp: new Date(),
          t_PatientRef: 'PAT-A',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 3200,
          t_DiscountRef: 'FullyPaid',
          t_Adjustment: -200,
          t_TotalAmount: 3000,
          t_AmountPaid_Cash: 3000,
        },
      ],
      [],
      [],
      'SVX',
      svcMap,
    )
    expect(out.transactions[0]!.discountIdType).toBe('Other')
    expect(out.transactions[0]!.discountIdNumber).toBe('FULLY_PAID_COURSE')
    expect(out.transactions[0]!.discountAmount).toBe('200.00')
    expect(out.fullyPaidPatientLegacyIds.has('PAT-A')).toBe(true)
  })

  it('parses multi-value t_ImmunizationRef list (forward direction)', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN-MULTI',
          t_Timestamp: new Date(),
          t_PatientRef: 'PAT-A',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 1600,
          t_AmountPaid_Cash: 1600,
          t_ImmunizationRef: 'IMM-A, IMM-B',
        },
      ],
      [
        {
          'Row ID': 'IMM-A',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_DosagePrice: 800,
          i_DosageCount: '1',
        },
        {
          'Row ID': 'IMM-B',
          i_VaccineRef: 'ARVPEP_AbhayrabID',
          i_DosagePrice: 800,
          i_DosageCount: '1',
        },
      ],
      [],
      'SVX',
      svcMap,
    )
    expect(out.items).toHaveLength(2)
    expect(out.immunizationsInTxnList.has('IMM-A')).toBe(true)
    expect(out.immunizationsInTxnList.has('IMM-B')).toBe(true)
  })

  it('sets payer_code from t_MiscPaymentType and uses ChargeAccounts only for reconciliation', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN4',
          t_Timestamp: new Date(),
          t_PatientRef: 'PAT-A',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 1500,
          t_TotalAmount: 1500,
          t_TotalAmountPaid: 1500,
          t_AmountPaid_Misc: 1500,
          t_MiscPaymentType: 'Hati Health',
        },
      ],
      [],
      [
        {
          'Transaction ID': 'TXN4',
          'Charge Account': 'Hati Health',
          'Reconciliation Status': 'OK',
        },
      ],
      'SVX',
      svcMap,
    )
    expect(out.transactions[0]!.payerCode).toBe('PAYER_HATI_HEALTH')
    expect(out.payments[0]!.reconciliationStatus).toBe('Cleared')
  })

  it('does not add the non-service discount base to transaction gross a second time', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN-NONSERVICE',
          t_Timestamp: new Date(),
          t_PatientRef: 'PAT-A',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 3100,
          t_TransactionValueNonService: 800,
          t_TotalAmount: 3100,
          t_TotalAmountPaid: 3100,
          t_AmountPaid_Cash: 3100,
        },
      ],
      [],
      [],
      'SVX',
      svcMap,
    )
    expect(out.transactions[0]).toMatchObject({
      grossAmount: '3100.00',
      discountAmount: '0.00',
      netAmount: '3100.00',
    })
  })

  it('materialises a positive source adjustment inside gross while preserving final net', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN-MARKUP',
          t_Timestamp: new Date(),
          t_PatientRef: 'PAT-A',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 1000,
          t_Adjustment: 150,
          t_TotalAmount: 1150,
          t_TotalAmountPaid: 1150,
          t_AmountPaid_Misc: 1150,
          t_MiscPaymentType: 'Ayala Malls (UPTC)',
        },
      ],
      [],
      [],
      'SVX',
      svcMap,
    )
    expect(out.transactions[0]).toMatchObject({
      payerCode: 'PAYER_AYALA_MALLS',
      grossAmount: '1150.00',
      discountAmount: '0.00',
      netAmount: '1150.00',
    })
  })

  it('repairs a stale paid header when the tender leg equals the final bill', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN-STALE-PAID',
          t_Timestamp: new Date(),
          t_PatientRef: 'PAT-A',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 800,
          t_TotalAmount: 800,
          t_TotalAmountPaid: 0,
          t_AmountPaid_BankTransfer: 800,
        },
      ],
      [],
      [],
      'SVX',
      svcMap,
    )
    expect(out.transactions[0]!.amountPaid).toBe('800.00')
    expect(out.correctedPaymentTransactions).toEqual([
      { rowId: 'TXN-STALE-PAID', rule: 'PAYMENT_LEGS_MATCH_FINAL_BILL' },
    ])
  })

  it('withholds a graph when the tender leg agrees with neither header nor final bill', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN-AMBIGUOUS-PAYMENT',
          t_Timestamp: new Date(),
          t_PatientRef: 'PAT-A',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 1200,
          t_TotalAmount: 1200,
          t_TotalAmountPaid: 1200,
          t_AmountPaid_PayMongo: 1700,
        },
      ],
      [],
      [],
      'SVX',
      svcMap,
    )
    expect(out.transactions).toHaveLength(0)
    expect(out.payments).toHaveLength(0)
    expect(out.unresolvedPaymentTransactions).toHaveLength(1)
  })

  it('withholds a transaction whose materialised total breaks its source formula', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN-BAD-TOTAL',
          t_Timestamp: new Date(),
          t_PatientRef: 'PAT-A',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 1000,
          t_Adjustment: -200,
          t_TotalAmount: 900,
        },
      ],
      [],
      [],
      'SVX',
      svcMap,
    )
    expect(out.transactions).toHaveLength(0)
    expect(out.unresolvedHeaderTransactions).toEqual([
      { rowId: 'TXN-BAD-TOTAL', reason: 'FINAL_BILL_FORMULA_DISAGREEMENT' },
    ])
  })

  it('withholds a negative refund until its original transaction can be linked', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN-REFUND',
          t_Timestamp: new Date(),
          t_PatientRef: 'PAT-A',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 0,
          t_Adjustment: -600,
          t_TotalAmount: -600,
          t_TotalAmountPaid: -600,
          t_AmountPaid_BankTransfer: -600,
          t_Remarks: 'refund',
        },
      ],
      [],
      [],
      'SVX',
      svcMap,
    )
    expect(out.transactions).toHaveLength(0)
    expect(out.unresolvedHeaderTransactions).toEqual([
      { rowId: 'TXN-REFUND', reason: 'NEGATIVE_REFUND_REQUIRES_ORIGINAL_TRANSACTION' },
    ])
  })

  it('withholds a mixed positive tender and negative refund leg as a refund graph', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN-OVERPAY-REFUND',
          t_Timestamp: new Date(),
          t_PatientRef: 'PAT-A',
          t_BranchRef: 'Alabang',
          t_TransactionValue: 1600,
          t_TotalAmount: 1600,
          t_TotalAmountPaid: 1600,
          t_AmountPaid_PayMongo: 1700,
          t_AmountPaid_Cash: -100,
          t_Remarks: 'overpayment returned in cash',
        },
      ],
      [],
      [],
      'SVX',
      svcMap,
    )
    expect(out.transactions).toHaveLength(0)
    expect(out.payments).toHaveLength(0)
    expect(out.unresolvedHeaderTransactions).toEqual([
      { rowId: 'TXN-OVERPAY-REFUND', reason: 'NEGATIVE_PAYMENT_LEG_REQUIRES_REFUND_GRAPH' },
    ])
  })

  it('withholds an unresolved group-patient transaction instead of breaking the load plan', () => {
    const out = transformTransactions(
      [
        {
          'Row ID': 'TXN-GROUP',
          t_Timestamp: new Date(),
          t_PatientRef: 'Multiple',
          t_BranchRef: 'HolySpirit',
          t_TransactionValue: 1500,
        },
      ],
      [],
      [],
      'SVX',
      svcMap,
      new Set(['PAT-A']),
    )
    expect(out.transactions).toHaveLength(0)
    expect(out.unresolvedTransactions).toEqual([{ rowId: 'TXN-GROUP', patientRef: 'Multiple' }])
  })
})
