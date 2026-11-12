# Payment-Leg Semantics — Frozen Drive Snapshot (2026-08-17)

Scope: the frozen Drive `Transactions` snapshot only. This note reports
aggregates and semantic categories; it contains no patient, staff, branch,
receipt, or raw-remark data.

## Finding

The Trial L stop is a small source-integrity subset, not a general payment
mapping failure.

| Measure                                 |            Result |
| --------------------------------------- | ----------------: |
| Source transactions assessed            |            41,362 |
| Header total paid equals tender-leg sum |  41,353 (99.978%) |
| Mismatched headers and tender legs      |        9 (0.022%) |
| All source `t_TotalAmountPaid`          | PHP 57,177,556.34 |
| All tender legs                         | PHP 57,150,235.62 |

The totals differ by PHP 27,320.72 because of the nine rows below. The other
41,353 rows are exact at cent precision.

## Mismatch categories

| Category                                                                  | Rows | Evidence                                                                                   | Safe treatment                                                                                                                                                            |
| ------------------------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header says zero, one Bank Transfer tender equals the final billed amount |    4 | Tender and `t_TotalAmount` agree; the header `t_TotalAmountPaid` is stale zero             | Deterministically repair target `amount_paid` from the tender sum (PHP 5,500 total) and retain raw source provenance.                                                     |
| Header says PHP 800, one Cash tender and final billed amount are PHP 820  |    1 | The PHP 20 positive adjustment is present in `t_Adjustment`; tender agrees with final bill | Deterministically repair target `amount_paid` to PHP 820 and retain raw source provenance.                                                                                |
| One-cent PayMongo difference                                              |    1 | Header paid amount and final bill are PHP 571.43; the only tender is PHP 571.42            | Set the single target payment to the header amount with an explicit `LEGACY_ROUNDING_CENT` migration annotation. Do not loosen the financial equality invariant globally. |
| Tender exceeds final bill by PHP 500                                      |    2 | PayMongo tender total PHP 4,299 vs source header/final bill PHP 3,299                      | Withhold the complete financial graph. The source does not establish whether the tender or the header is wrong.                                                           |
| Header/final bill says paid, but no tender is populated                   |    1 | PHP 33,840.71; no payment method or linked immunization reference                          | Withhold the complete financial graph. Creating an `Other` tender would invent its method.                                                                                |

## What does _not_ resolve the ambiguity

- All nine rows have a blank `t_MiscPaymentType`, so no partner-settlement
  payer/tender rule applies.
- Remarks are blank or free text. Aggregate keyword checks found no consistent
  correction instruction; three contain a generic payment term and five do
  not contain a payment-method or correction signal.
- Every mismatch has zero or one nonzero tender leg, so no tender-splitting
  inference is available.

## Recommended transform and queue behavior

Before building a financial graph, calculate:

`residual = t_TotalAmountPaid - sum(nonzero payment legs)`.

1. If tender sum exactly equals `t_TotalAmount`, use tender sum as target
   `amount_paid` even if the source header differs. Record the raw header and
   the repair reason in migration provenance.
2. If exactly one tender exists, the residual is exactly PHP 0.01, and header
   paid amount equals final bill, set that target tender to the header amount
   with `LEGACY_ROUNDING_CENT` provenance.
3. Otherwise, do **not** create a balancing `Other` payment and do **not**
   modify a real tender. Withhold the whole transaction/items/payments graph
   into a P1 financial-reconciliation queue, keyed by a source-envelope hash.

This repairs 6 rows deterministically and quarantines 3 rows. It preserves the
adapter's exact payment-total invariant for every durable graph.

## Verification method

The analysis used every frozen transaction row, the five tender columns, final
billed amount, header paid amount, adjustment, miscellaneous payment type, and
redacted remark signals. It did not use local development database data and did
not write to Railway or any production system.

## P0 — Transaction header double-counting defect

This is broader than the nine payment-leg mismatches and blocks production
financial migration.

`t_TransactionValueNonService` is **not** an amount to add to
`t_TransactionValue`. It is the vaccine-only subset of that transaction value
used by AppSheet's discount formula. The frozen source confirms the formula:

| Frozen-source test                                                               |   Rows |
| -------------------------------------------------------------------------------- | -----: |
| Transactions                                                                     | 41,362 |
| `t_TransactionValueNonService` is nonzero                                        | 20,827 |
| Of those, final total equals `t_TransactionValue`                                | 18,377 |
| Of those, final total equals `t_TransactionValue + t_TransactionValueNonService` |      2 |
| Final total equals `t_TransactionValue + t_Adjustment`                           | 41,352 |
| Formula exceptions requiring financial reconciliation                            |     10 |

The present transform calculates its header gross as
`TransactionValue + TransactionValueNonService`. It matches the final source
bill in only 18,933 rows, overstates it in 22,347 rows, and understates it in
82 positive-adjustment rows. The aggregate gross overstatement relative to the
source final bill is PHP 31,978,176.11. This is a P0 for any production
financial migration.

### Correct target mapping for the 41,352 formula-consistent rows

| Target field      | Source rule                                                                    |
| ----------------- | ------------------------------------------------------------------------------ |
| `gross_amount`    | `t_TransactionValue + max(t_Adjustment, 0)`                                    |
| `discount_amount` | `max(-t_Adjustment, 0)`                                                        |
| `net_amount`      | `t_TotalAmount` (equal to gross minus discount for the formula-consistent set) |
| `amount_paid`     | Reconciled tender sum under the payment-leg rules above                        |

This preserves the existing schema's identity, `net = gross - discount`, while
carrying a positive legacy adjustment as part of historical gross because the
current transaction table has no independent surcharge field. The raw signed
adjustment remains migration provenance. `t_TransactionValueNonService` should
remain source evidence for discount/line analysis only; it must never be added
again to the header.

### Exceptions

The 10 rows where `t_TotalAmount` differs from
`t_TransactionValue + t_Adjustment` must be placed in the P1 financial
reconciliation queue with their entire financial graph withheld. Do not choose
between the materialized final total and the formula inputs automatically.

The finance loader must not proceed beyond a disposable diagnostic trial until
this transform correction, its source-total assertions, and a clean rerun have
been verified.
