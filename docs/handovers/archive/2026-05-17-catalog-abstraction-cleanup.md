# Catalog Abstraction Cleanup — 2026-05-17

PRs that landed today (#348 → #355): standing-order templates aligned with the
Animal Bite Center SOP, AppSheet CSV audit + backfill, `seed.ts` modularization,
and a three-principle catalog cleanup that's worth flagging for anyone touching
the service catalog, standing orders, or transaction-revenue surfaces.

## The three principles

1. **Partner rates → `service_prices`, not catalog rows.** Hati Health,
   Forticare, MedAsia, Philbritish are payer profiles (`payer_profiles` table)
   with `service_prices.payer_id` rows for any service whose price differs from
   the base. The `_HH` / `_FC` / `_MEDASIA` / `_PB` catalog suffix variants
   that existed pre-cleanup were dropped (~30 rows).

2. **Brand picked at administer-time, not at standing-order start.** One
   abstract service per clinical entity (`ARVPEP_IM`, not eight
   brand×partner×route variants). `service_eligible_products` (new junction
   table, migration 0016) lists which products satisfy each service —
   FEFO unions the legacy `service_catalog.product_id` and the junction at
   administer-time to find the earliest-expiring eligible lot. ~28 brand-locked
   catalog rows dropped.

3. **Doctor attribution via `transaction_items.performed_by_id`, not catalog
   variants.** Single `CONSULTATION` and single `MEDCERT` service; attending
   physician recorded on the txn item FK at sale time. The 8 per-physician
   variants (`SERVICE_CONSULTATION_LACUARIN`, `_LINTAG`, `_TECSON`, `_UY` for
   both consultation and medcert) were dropped.

## Schema (migration 0016)

```
service_eligible_products (
  id text PK,                -- 'SEP-{10 B32}' or '{TEN-X}.SEP-{N B32}'
  tenant_id text NOT NULL,   -- RLS scoped
  service_id text NOT NULL,  -- FK service_catalog (cascade on delete)
  product_id text NOT NULL,  -- FK products
  is_default boolean,        -- UI preselection hint
  ranking integer,           -- FEFO tiebreaker / preferred-brand order
  created_at timestamptz
)

transaction_items.performed_by_id text REFERENCES users(id)
  -- per-line attending clinician for consultation / medcert revenue
```

## FEFO update — two-path eligibility

`apps/backend/src/modules/inventory/fefo.ts` joins through a union:

```sql
WHERE il.product_id IN (
  SELECT sc.product_id FROM service_catalog sc
    WHERE sc.id = ${serviceId} AND sc.product_id IS NOT NULL
  UNION
  SELECT sep.product_id FROM service_eligible_products sep
    WHERE sep.service_id = ${serviceId}
)
```

Legacy 1:1 services keep working; new abstract services draw from any product
the junction lists. Earliest-expiring eligible lot wins across the union.

## Catalog shape (post-cleanup)

| Group                                              |   Count | Notes                                                                                     |
| -------------------------------------------------- | ------: | ----------------------------------------------------------------------------------------- |
| Anti-Rabies (PEP/PrEP/Booster × IM/ID)             |       6 | Each draws from Abhayrab (default) or Speeda                                              |
| Tetanus + adjuncts (TT/ATS/ERIG_INF/HRIG_INF/HTIG) |       5 | Single brand each                                                                         |
| Flu (`FLU_QUAD`)                                   |       1 | Eligible: Vaxigrip Tetra / Influvac Tetra / Fluprevil / Fluarix Tetra                     |
| Other vaccines                                     |      19 | Cholera, Typhoid, Hep A, Hep B×2, HPV×2, MMR, TDAP, Shingles, Varicella×2, Pneumococcal×3 |
| Operational services                               |       6 | CONSULTATION, TELECONSULT, MEDCERT, OTHER, WOUND, FNAT                                    |
| Diagnostics — Individual (active)                  |      32 | Matches the AppSheet CSV's separately-orderable tests                                     |
| Diagnostics — Panel Constituents (hidden)          |      32 | `isActive = false`, exist only for `service_bundle_items.item_service_id` FK              |
| Diagnostics — Panels (bundles)                     |      24 | SV01–SV23 + TFT1 + CA125; composition wired via service_bundle_items                      |
| **Total**                                          | **125** | (155 if you count the 32 hidden panel constituents)                                       |

**List endpoints showing user-facing orderable services must filter
`is_active = true`** — otherwise the hidden panel constituents appear in
service pickers.

## Standing-Order Templates (23 — unchanged shape, repointed targets)

All templates now reference the new abstract `SVC_*` constants. Notable:

- `SOT_FLU` template item → `SVC_FLU_QUAD` (4-brand pool), not legacy
  single-product `SVC-FLU`.
- `SOT_TT_*` templates reference `SVC_TT` (renamed from `SVC_TT_ABHAY`).
- `SOT_HEPB_STANDARD` / `SOT_HEPB_ACCELERATED` → `SVC_HEPB_10` (adult dose).
- `SOT_HPV` → `SVC_HPV9` (Gardasil 9).
- `SOT_VARICELLA` → `SVC_VARICELLA_SC` (SC route default).

## Constants renamed / dropped

| Before                                                                      | After / Status                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------ |
| `SVC_TT_ABHAY`                                                              | `SVC_TT` (renamed)                                     |
| `SVC_PVRV`, `SVC_FLU`, `SVC_TETANUS`, `SVC_CONSULT`, `SVC_ERIG`, `SVC_HRIG` | Dropped (legacy back-compat aliases)                   |
| `SVC_HEPB` (alias)                                                          | Use `SVC_HEPB_10` (adult) or `SVC_HEPB_05` (pediatric) |
| `SVC_HPV` (alias)                                                           | Use `SVC_HPV9` or `SVC_HPV4`                           |
| `SVC_VARICELLA` (alias)                                                     | Use `SVC_VARICELLA_SC` or `SVC_VARICELLA_IM`           |
| (none)                                                                      | `SVC_FLU_QUAD` added — abstract 4-brand flu            |

Transaction/encounter seed references repointed:

- `SVC_PVRV → SVC_ARVPEP_IM`
- `SVC_FLU → SVC_FLU_QUAD`
- `SVC_TETANUS → SVC_TT`
- `SVC_CONSULT → SVC_CONSULTATION`
- `SVC_ERIG → SVC_ERIG_INF`

Inventory seed product references repointed:

- `Verorab → Abhayrab`
- `Influvac → Vaxigrip Tetra`
- `Tetanus Toxoid → AbhayTox`

## seed.ts modular layout (PR #350)

`apps/backend/src/shared/db/seed.ts` (5,803 → 85 lines) is now a thin
orchestrator. Section bodies live under `apps/backend/src/shared/db/seed/`:

```
seed/db.ts                   postgres client + setSeedTenantContext
seed/helpers.ts              daysAgo / today / dateStr / seqSuffix
seed/constants.ts            all display-ID constants (~150)
seed/tenant.ts               tenant + 11 branches
seed/users.ts                users + roles + branches
seed/payers.ts               payer profiles (now 8 — added 4 partners)
seed/partner-labs.ts         3 partner laboratories
seed/patients.ts             20 patients + allergies + conditions + tags
seed/catalog.ts              categories + products + services + prices +
                             bundle items + service_eligible_products +
                             per-payer service_prices
seed/standing-orders.ts      23 SOT templates + 58 template items
seed/encounters.ts           encounters + PSOs + clinical orders + consents
seed/lab-orders.ts           5 lab orders
seed/inventory.ts            10 inventory lots
seed/transactions.ts         transactions + items (with performed_by_id) + payments
seed/shifts.ts               staff_time_logs + approval requests
seed/audit.ts                audit logs + notification templates
```

Cross-section dependency: `seedCatalog()` returns the
`productIdByManufacturer` map, which `seedInventory()` accepts as a parameter.

## PRs in this batch

- [#348](https://github.com/njvil/surevax-cms-revamp/pull/348) — 23 standing-order templates from Animal Bite Center SOP
- [#349](https://github.com/njvil/surevax-cms-revamp/pull/349) — 97 catalog rows from AppSheet CSV (32 lab indiv + 32 panel components + 24 panels + 8 physician services + Fluarix)
- [#350](https://github.com/njvil/surevax-cms-revamp/pull/350) — seed.ts → 15-file modular split
- [#351](https://github.com/njvil/surevax-cms-revamp/pull/351) — abstract services + payer-driven pricing + doctor attribution (schema 0016)
- [#352](https://github.com/njvil/surevax-cms-revamp/pull/352) — fix: SVP-/PRD- canonical display-ID formats
- [#353](https://github.com/njvil/surevax-cms-revamp/pull/353) — fix: Cholera `defaultRoute: 'PO'` (was `'Oral'`)
- [#354](https://github.com/njvil/surevax-cms-revamp/pull/354) — drop legacy services + rename `SVC_TT` + hide panel components
- [#355](https://github.com/njvil/surevax-cms-revamp/pull/355) — fix: test fixtures repointed to `TEN-SUREVAX.SVC-ARVPEP-IM`

## Follow-ups to consider

- Repoint historical `transactions.ts` items currently pointing at `SVC_ARVPEP_IM` to verify the new FEFO path picks an Abhayrab or Speeda lot correctly when both are in stock.
- Add a frontend brand-picker UI at administer-time (gives clinician explicit choice between eligible products instead of letting FEFO auto-pick).
- Consider whether the 4 legacy "compat" PAT*\* / TXN*\* historical seed rows still make sense, or repoint them to today's date ranges so the demo data feels fresh.
