# Live Catalog Semantic Scan — 2026-08-17

Scope: the frozen Drive `Vaccine` snapshot only. This is a catalog-only
comparison; it contains no patient, staff, transaction, or source-row details.

## Result

- 271 nonblank legacy catalog rows reduced to 51 transformed service entries.
- 10 entries exactly matched an existing seeded catalog code and semantics.
- 10 entries had a null legacy route and one known seeded route; that route is
  a target enrichment, not a conflict.
- No same-code service had a conflicting type, explicit route, stock rule, or
  active state.

The resolver therefore permits a null source route to reuse a seeded service,
but continues to reject an explicit route disagreement.

## Resolver correction

The legacy consultation and medical-certificate records use the physical seed
IDs `SVC_CONSULTATION` and `SVC_MEDCERT`, while the seed's unique catalog codes
are `CONSULTATION` and `MEDCERT`. The transformer now preserves the physical
IDs for references and emits those canonical codes for collision-safe reuse.

## Deterministic aliases not yet normalized

These transformed codes describe an already seeded clinical service and can be
normalized in a dedicated catalog-alias change rather than creating duplicate
catalog entries:

| Legacy-transform code(s)  | Seeded canonical code |
| ------------------------- | --------------------- |
| `ATS_IM`                  | `ATS`                 |
| `CHOLERA_Oral`            | `CHOLERA`             |
| `ERIG`                    | `ERIG_INF`            |
| `HRIG`                    | `HRIG_INF`            |
| `HTIG_IM`                 | `HTIG`                |
| `FLU`, `FLU_IM`           | `FLU_QUAD`            |
| `HEPA`, `HEPA_IM`         | `HEPA`                |
| `HPV4`, `HPV4_IM`         | `HPV4`                |
| `HPV9`, `HPV9_IM`         | `HPV9`                |
| `MMR`, `MMR_SC`           | `MMR`                 |
| `TDAP`, `TDAP_IM`         | `TDAP`                |
| `TT`, `TT_IM`             | `TT`                  |
| `TYPHOID`, `TYPHOID_IM`   | `TYPHOID`             |
| `SHINGRIX`, `SHINGRIX_IM` | `SHINGLES`            |
| `PCV13`, `PCV13_IM`       | `P13`                 |
| `PCV20`, `PCV20_IM`       | `P20`                 |
| `PPSV23`, `PPSV23_IM`     | `P23`                 |

All observed flu brands in this freeze are quadrivalent, which is why the
`FLU_QUAD` alias is deterministic for this frozen source pack.

## Withhold rather than infer

| Code(s)              | Reason                                                            |
| -------------------- | ----------------------------------------------------------------- |
| `ARVPEP`             | Payer-tier source rows omit the clinically material IM/ID choice. |
| `VARICELLA`          | Payer-tier source rows omit the clinically material IM/SC choice. |
| `HEPB`, `HEPB_IM`    | The source mixes pediatric 0.5 mL and adult 1.0 mL doses.         |
| `ERIG_IM`, `HRIG_IM` | Explicit IM conflicts with the seeded wound-infiltration route.   |
| `HEPA_SC`            | Explicit SC conflicts with the seeded IM route.                   |

These items stay out of automatic catalog reuse and need a named mapping or
manual reconciliation decision before clinical facts reference them.

## Verification

- Backend TypeScript check passed.
- Focused migration catalog resolver and catalog-transform tests passed: 2
  files, 12 tests.

## Payer-profile resolution — Trial E follow-up

The frozen Vaccine catalog emits only five payer references for service prices:
`PAYER_HMO`, `PAYER_HPPI`, `PAYER_MWELL`, `PAYER_HATI_HEALTH`, and
`PAYER_MEDASIA`. Each has one seeded target profile:

| Migration payer reference | Target payer display ID | Status                                                    |
| ------------------------- | ----------------------- | --------------------------------------------------------- |
| `PAYER_HATI_HEALTH`       | `PYR_AAAAAAA5`          | seeded                                                    |
| `PAYER_FORTICARE`         | `PYR_AAAAAAA6`          | seeded; not emitted by this freeze's Vaccine rows         |
| `PAYER_MEDASIA`           | `PYR_AAAAAAA7`          | seeded                                                    |
| `PAYER_PHILBRITISH`       | `PYR_AAAAAAA8`          | seeded; not emitted by this freeze's Vaccine rows         |
| `PAYER_HMO`               | `PYR_AAAAAAA9`          | seeded                                                    |
| `PAYER_HPPI`              | `PYR_AAAAAAAA`          | seeded                                                    |
| `PAYER_MWELL`             | `PYR_AAAAAAAB`          | seeded                                                    |
| `PAYER_AYALA_MALLS`       | `PYR_AAAAAAAC`          | A4-approved profile prerequisite; no rate is invented     |
| `PAYER_INTELLICARE`       | `PYR_AAAAAAA2`          | existing seeded HMO; not emitted by the current transform |

All other payer aliases, including `PAYER_AVEGA`, fail closed. The importer
will withhold an unresolved price instead of creating a payer or treating it
as retail.

The alias is intentionally applied only to catalog service-price rows. The
current transaction transform still derives payer attribution from the
ChargeAccounts overlay. The recorded source rule is that payer attribution must
come from `Transactions.t_MiscPaymentType`; ChargeAccounts is only payment
reconciliation evidence. Until that transform is corrected, transaction payer
writes remain a separate financial-semantic blocker rather than being silently
accepted through these aliases.

Payer resolution verification: backend TypeScript check passed; focused payer,
catalog-resolver, and catalog-transform tests passed (3 files, 15 tests).
