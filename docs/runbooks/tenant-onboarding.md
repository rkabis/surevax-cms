# Tenant Onboarding Runbook (Phase 2)

> **STATUS: DRAFT** — Phase 1 is single-tenant (`SVX`). This runbook
> walks through provisioning tenant #2+ once Phase 2 is operationally
> live. Every code path it references already exists; what's missing is
> a one-page sequence + the SQL/HTTP calls that wire a new clinic up.

Read [`docs/ENVIRONMENTS.md`](../ENVIRONMENTS.md) and
[`.claude/rules/gotchas.md`](../../.claude/rules/gotchas.md) — "Display IDs"

- "Tenant resolution" — before you start. The schema decisions there
  (`tenants.id` is the slug, JWT carries the slug, branch codes are 3
  uppercase letters, `MRN-NNNNNN` is per-tenant) are load-bearing.

---

## 1. Inputs you collect before you touch anything

Get these from the clinic-onboarding intake form / kickoff call:

| Field                       | Example                                                                    | Source / constraint                                                                                                                                                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant slug                 | `STJUDE`                                                                   | 3–10 uppercase letters. **IS the `tenants.id` PK** — every FK in the schema is `text NOT NULL REFERENCES tenants(id)`. Becomes part of every `display_id` for branches (`STJUDE.MNL`) and the JWT `tenantSlug` claim. Once chosen, it's permanent (you can't rename without a multi-table cascade).              |
| Tenant display name         | `St. Jude Medical Center`                                                  | `tenants.name`. Renders on receipts, health cards, and the cross-tenant operator console.                                                                                                                                                                                                                        |
| Timezone                    | `Asia/Manila`                                                              | `tenants.timezone`. Defaults to Manila. For non-PH tenants, set early — day-summary aggregations + retention jobs key off this. See risks H1/C2.                                                                                                                                                                 |
| Country code                | `PH`                                                                       | `tenants.country_code`. PH-only today; if anything other than PH, audit BIR receipt logic + Senior/PWD discount math before going live.                                                                                                                                                                          |
| Subdomain                   | `stjude.surevax.com`                                                       | Drives tenant resolution. Cloudflare Pages routes the subdomain to the frontend; the frontend sends `X-Tenant-Slug: STJUDE` on every API call.                                                                                                                                                                   |
| Branches (one row per site) | `(MNL, Manila Main, "1234 Roxas Blvd, Manila", "(02) 8123-4567")`          | One `branches` row per physical clinic site. `code` is 3 uppercase letters; the row's `display_id` is auto-derived as `{slug}.{code}` (e.g. `STJUDE.MNL`).                                                                                                                                                       |
| Initial TenantAdmin         | `admin@stjude.com` / personal name / temporary password (force-rotate ≤7d) | Bootstrap login for the clinic. Must be a real human, not a shared mailbox — every audit-log row attributes to this user until further accounts are created.                                                                                                                                                     |
| Payer profiles needed       | `Hati Health`, `PhilHealth`, `Maxicare`, …                                 | If the clinic accepts HMO / corporate / government coverage, payer rows are tenant-scoped. The shared SVX seed has 8 default payers — you can either copy those into the new tenant or wait for the clinic to add via the admin UI.                                                                              |
| Service catalog source      | `copy from SVX` / `custom`                                                 | The service catalog (`service_catalog`, `service_prices`, `products`, `service_bundle_items`, `service_eligible_products`) is tenant-scoped. Most clinics will share the SVX defaults plus their own products. A `clone_catalog_to_tenant(source_slug, dest_slug)` SQL helper is on the deferred list (see §10). |

Stash these in a Linear ticket or onboarding checklist before touching SQL.

---

## 2. DNS + Cloudflare Pages routing

This must land at least a few hours ahead of the database work — DNS
propagation takes time and you do NOT want the clinic logging in to a
half-provisioned subdomain.

1. **Add subdomain DNS record** in the customer's domain or in Cloudflare:
   ```
   Type:   CNAME
   Name:   stjude              (or @ for an apex — needs Cloudflare CNAME flattening)
   Target: surevax-cms.pages.dev (or whatever the Pages project is currently named)
   Proxy:  Proxied (orange cloud)
   TTL:    Auto
   ```
2. **Add to Cloudflare Pages custom domains:**
   - Project → Custom domains → Add → `stjude.surevax.com`
   - Wait for the SSL cert handshake (usually <2 min).
3. **Update `CORS_ORIGIN` on Railway** so the backend allows the new origin:
   ```bash
   railway variables set \
     CORS_ORIGIN="https://app.surevax.com,https://stjude.surevax.com,…(others)"
   railway redeploy
   ```
   `CORS_ORIGIN` is parsed as a comma-separated list by `env.ts`; wildcard
   `*` is rejected at boot in production. Confirm with:
   ```bash
   curl -i -X OPTIONS https://api.surevax.com/api/auth/login \
     -H "Origin: https://stjude.surevax.com" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: x-requested-with,content-type"
   ```
   Expect `Access-Control-Allow-Origin: https://stjude.surevax.com`.

---

## 3. Database provisioning (run from a tenant-scoped Postgres session)

> All inserts in this section MUST run inside a transaction with the
> `app.current_tenant_id` GUC set to the new tenant slug — the audit
> trigger raises otherwise. Easiest path: open `psql` against the
> Railway database, then run `SELECT set_config('app.current_tenant_id',
'STJUDE', false);` once at the top of the session.

```sql
-- 3.1 — Seed the tenant row
INSERT INTO tenants (id, name, slug, timezone, country_code)
VALUES ('STJUDE', 'St. Jude Medical Center', 'STJUDE', 'Asia/Manila', 'PH');

-- 3.2 — Provision the per-tenant MRN sequence
SELECT provision_tenant_counters('STJUDE');
-- Creates: mrn_seq_stjude

-- 3.3 — Audit + RLS GUCs for the bootstrap inserts
SELECT set_config('app.current_tenant_id', 'STJUDE', false);
SELECT set_config('app.current_user_id', '', false);     -- no user yet
SELECT set_config('app.current_branch_id', '', false);

-- 3.4 — Branches (one row per physical clinic site)
INSERT INTO branches (display_id, tenant_id, code, name, address, city, province, contact_number, email)
VALUES
  ('STJUDE.MNL', 'STJUDE', 'MNL', 'Manila Main',
   '1234 Roxas Blvd', 'Manila', 'NCR', '(02) 8123-4567', 'manila@stjude.com'),
  ('STJUDE.QC',  'STJUDE', 'QC',  'Quezon City Branch',
   '5678 EDSA', 'Quezon City', 'NCR', '(02) 8765-4321', 'qc@stjude.com');
-- Repeat for every branch the clinic operates.
```

If the clinic shares the SVX service catalog, copy the service_catalog +
service_prices + products + service_bundle_items + service_eligible_products
rows over, **rewriting `tenant_id` to the new slug**. The cleanest path is a
short SQL script — there's no `clone_catalog_to_tenant` helper yet
(deferred work in §10). A minimal version:

```sql
-- 3.5 — Service catalog copy from SVX (skip if catalog is custom)
INSERT INTO service_catalog (id, tenant_id, code, sku, name, service_type,
                             category_id, product_id, cvx_code, ndc_code, cpt_code,
                             loinc_code, default_route, default_dose_volume_ml,
                             default_manufacturer, is_vat_exempt, requires_stock,
                             requires_rx, requires_consent, requires_vis,
                             requires_dose_calculation, is_active, created_at, updated_at)
SELECT id, 'STJUDE', code, sku, name, service_type,
       category_id, product_id, cvx_code, ndc_code, cpt_code,
       loinc_code, default_route, default_dose_volume_ml,
       default_manufacturer, is_vat_exempt, requires_stock,
       requires_rx, requires_consent, requires_vis,
       requires_dose_calculation, is_active, NOW(), NOW()
FROM   service_catalog
WHERE  tenant_id = 'SVX';
-- Note: `id` is the catalog code (text PK), shared across tenants per
-- the schema. No conflict — `(tenant_id, id)` is unique only on tenant
-- so cross-tenant rows with the same `id = 'ARVPEP_IM'` coexist.

-- service_prices, products, service_bundle_items, service_eligible_products
-- follow the same pattern. See seed.ts:seedCatalog for the canonical order.
```

> **WARNING:** This catalog-copy is hand-rolled. The seed module
> (`apps/backend/src/shared/db/seed/catalog.ts`) handles dependency
> ordering correctly via Drizzle and `display_id` regeneration. For a
> live tenant, consider running the seed module against the new tenant
> slug instead of the SQL above — `pnpm db:seed -- --tenant STJUDE`
> (CLI flag is on the deferred list).

---

## 4. Bootstrap admin user

```sql
-- 4.1 — Insert the user
-- bcrypt the temporary password OUT OF BAND first (NEVER write a plain
-- password into SQL):
--   node -e "console.log(require('bcrypt').hashSync('TempStJude!2026', 12))"
-- → $2b$12$abc…xyz   (paste below)

INSERT INTO users (display_id, tenant_id, primary_branch_id, email, password_hash,
                   first_name, last_name, is_active, can_login, license_number,
                   created_at, updated_at)
VALUES
  (
    'USR_' || upper(substring(md5(random()::text) for 8)),   -- random 8-char suffix
    'STJUDE',
    (SELECT id FROM branches WHERE display_id = 'STJUDE.MNL'),
    'admin@stjude.com',
    '$2b$12$abc…xyz',   -- ← paste bcrypt hash here
    'St. Jude',
    'Admin',
    true,
    true,
    NULL,
    NOW(),
    NOW()
  )
RETURNING id, display_id;
-- Note both. The bigint `id` and the `display_id` (USR_…) feed the next inserts.

-- 4.2 — Grant TenantAdmin role
INSERT INTO user_roles (user_id, role, tenant_id)
VALUES ((SELECT id FROM users WHERE email = 'admin@stjude.com'), 'TenantAdmin', 'STJUDE');

-- 4.3 — Map to every branch (so cross-branch admin UI works end-to-end)
INSERT INTO user_branches (tenant_id, user_id, branch_id)
SELECT 'STJUDE',
       (SELECT id FROM users WHERE email = 'admin@stjude.com'),
       b.id
FROM   branches b
WHERE  b.tenant_id = 'STJUDE';
```

After 4.3 finishes, switch the session GUCs so later writes carry a usable
`app.current_user_id` (RLS cast-to-bigint needs the real id):

```sql
SELECT set_config('app.current_user_id',
                  (SELECT id::text FROM users WHERE email = 'admin@stjude.com'),
                  false);
SELECT set_config('app.current_branch_id',
                  (SELECT id::text FROM branches WHERE display_id = 'STJUDE.MNL'),
                  false);
```

(Optional but recommended for any further provisioning inserts.)

---

## 5. PIN seed for kiosk access (optional, Phase 1 parity)

If the clinic uses the kiosk clock-in flow, every staff user needs a PIN.
For the bootstrap admin only:

```sql
-- bcrypt('1234') out of band first
UPDATE users
SET    pin_hash = '$2b$12$…',
       pin_set_at = NOW()
WHERE  email = 'admin@stjude.com';
```

Real PINs should be set by each user via the admin UI after first login.
The seeded default mirrors the SVX dev convention; rotate before go-live.

---

## 6. Operator-console verification

Confirm the new tenant shows in the platform-operator console at
`/operator/tenants`:

```bash
TOKEN=$(curl -s -X POST https://api.surevax.com/api/operator/login \
  -H 'Content-Type: application/json' -H 'X-Requested-With: fetch' \
  -d '{"email":"platform@surevax.com","password":"…"}' | jq -r .accessToken)

curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.surevax.com/api/operator/tenants | jq '.[] | select(.id=="STJUDE")'
# Expect: { "id": "STJUDE", "name": "St. Jude Medical Center", "branchCount": 2 }
```

---

## 7. End-to-end smoke test (10 minutes)

Go through every gate the live frontend exercises. **Do not skip** —
this is the only proof the tenant resolution + RLS + audit-trigger +
JWT-issuer/audience chain works for the new slug.

```bash
# 7.1 — Tenant resolution via subdomain
curl -i https://stjude.surevax.com/api/health
# Cloudflare Pages serves the SPA — should return HTML, not the API.

curl -i -H 'X-Tenant-Slug: STJUDE' -H 'X-Requested-With: fetch' \
  https://api.surevax.com/api/auth/csrf-token
# Expect 200 with a body. If 400 TENANT_REQUIRED, header isn't reaching
# the backend — check the frontend's apiFetch base URL config + CORS.

# 7.2 — Login
TOKEN=$(curl -s -X POST https://api.surevax.com/api/auth/login \
  -H 'Content-Type: application/json' -H 'X-Requested-With: fetch' \
  -H 'X-Tenant-Slug: STJUDE' \
  -d '{"email":"admin@stjude.com","password":"TempStJude!2026"}' | jq -r .accessToken)
[[ -z "$TOKEN" || "$TOKEN" = "null" ]] && echo "LOGIN FAILED" && exit 1

# 7.3 — /me — confirms JWT audience + tenant scoping
curl -s -H "Authorization: Bearer $TOKEN" -H 'X-Tenant-Slug: STJUDE' \
  https://api.surevax.com/api/auth/me | jq '.user | {email, tenantId, branchCode, role}'
# Expect: { email: "admin@stjude.com", tenantId: "STJUDE", branchCode: "MNL", role: "TenantAdmin" }

# 7.4 — RLS isolation — must NOT see SVX patients
curl -s -H "Authorization: Bearer $TOKEN" -H 'X-Tenant-Slug: STJUDE' \
  https://api.surevax.com/api/patients?limit=5 | jq '.data | length'
# Expect: 0  (fresh tenant has no patients yet)

# Cross-check: log in as SVX admin and confirm THAT user can NOT see
# the new STJUDE branches via /api/admin/branches.

# 7.5 — Create first patient (audit trigger + display ID gen check)
curl -s -X POST https://api.surevax.com/api/patients \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'X-Requested-With: fetch' -H 'X-Tenant-Slug: STJUDE' \
  -d '{"firstName":"Smoke","lastName":"Test","sex":"M","dateOfBirth":"1990-01-01"}' \
  | jq '{id, displayId, mrn, tenantId, branchId}'
# Expect: { id: "PAT_xxxxxxxx", displayId: "PAT_xxxxxxxx", mrn: "MRN-000001", tenantId: "STJUDE", branchId: "BRN_…" }
# If audit trigger raises, GUC chain broke — check the JWT shape + auth middleware.

# 7.6 — Audit row landed
curl -s -H "Authorization: Bearer $TOKEN" -H 'X-Tenant-Slug: STJUDE' \
  https://api.surevax.com/api/audit?limit=3 | jq '.[0] | {actor, action, entityType, entityId}'
# Expect the patient CREATE event with actor = admin's USR_… display id.
```

Failing any of 7.1–7.6 = abort and roll back (§9).

---

## 8. Hand-off to the clinic

After 7 passes, the clinic can log in. Send the onboarding team:

- **Login URL:** `https://stjude.surevax.com`
- **First-login credentials:** `admin@stjude.com` / `TempStJude!2026`
- **Force-rotate the password within 7 days.** Document this in the clinic
  contract; the system does not enforce it (yet).
- **PIN reminder:** the seeded `1234` kiosk PIN must be rotated by each
  staff member via the admin UI before kiosk go-live.
- **Walkthrough:** schedule a 60-minute session covering admin UI →
  branch/user setup → service catalog adjustments → first-day cashier flow.

---

## 9. Rollback (if smoke test 7.x fails)

Order matters — children before parents, otherwise FK constraints raise.
Run inside a transaction with the GUCs set as in §3.3:

```sql
BEGIN;
DELETE FROM audit_logs        WHERE tenant_id = 'STJUDE';
DELETE FROM phi_access_log    WHERE tenant_id = 'STJUDE';
DELETE FROM user_branches     WHERE tenant_id = 'STJUDE';
DELETE FROM user_roles        WHERE tenant_id = 'STJUDE';
DELETE FROM users             WHERE tenant_id = 'STJUDE';
DELETE FROM service_eligible_products WHERE tenant_id = 'STJUDE';
DELETE FROM service_bundle_items      WHERE tenant_id = 'STJUDE';
DELETE FROM service_prices            WHERE tenant_id = 'STJUDE';
DELETE FROM service_catalog           WHERE tenant_id = 'STJUDE';
DELETE FROM service_categories        WHERE tenant_id = 'STJUDE';
DELETE FROM products                  WHERE tenant_id = 'STJUDE';
DELETE FROM payer_profiles            WHERE tenant_id = 'STJUDE';
DELETE FROM branches                  WHERE tenant_id = 'STJUDE';
DELETE FROM tenants                   WHERE id        = 'STJUDE';
DROP SEQUENCE IF EXISTS mrn_seq_stjude;
COMMIT;
```

Then drop the Cloudflare Pages custom domain + DNS record + remove the
origin from `CORS_ORIGIN`.

---

## 10. Deferred / known-fragile bits

These are explicitly NOT in this runbook because they need design work
first. File a Linear ticket if you hit them:

- **`pnpm db:seed -- --tenant <slug>` CLI flag** — would replace §3.5 (the
  hand-rolled catalog copy) with the existing seed module's correct
  dependency ordering. The seed module currently hardcodes `TENANT_SLUG = 'SVX'`.
- **`clone_catalog_to_tenant(source_slug, dest_slug)` SQL helper** —
  one-call alternative to the manual catalog copy. Risk: cross-tenant
  catalog drift over time once tenants edit their own catalogs.
- **Subdomain wildcard SSL** — currently each new tenant subdomain
  requires a manual Cloudflare Pages custom-domain add. Switching to a
  wildcard `*.surevax.com` cert + Pages routing rule cuts the manual step.
- **Self-serve onboarding UI** — operator console currently only LISTS
  tenants; no "create tenant" form. Building one is its own design pass
  (auth + form + transactional SQL wrapping all the steps above).
- **Tenant-aware date boundaries** — `tenants.timezone` is stored but
  not consistently consumed in day-summary / retention aggregations.
  See [`docs/handovers/archive/2026-05-19-remaining-todos.md`](../handovers/archive/2026-05-19-remaining-todos.md) C2
  (now rolled into [`docs/STATUS.md`](../STATUS.md)).
- **DPA right-to-erasure on tenant-level data** — the `purge_patient`
  SQL gate exists but no tenant-level purge has been built. If a
  clinic terminates and demands its data be deleted under DPA §34(b),
  this runbook's §9 rollback gets you partway but doesn't cover
  encounter / clinical-order cascade audit, R2 attachment cleanup, or
  the BIR 10-year retention exemption logic.

---

## Related docs

- [`docs/ENVIRONMENTS.md`](../ENVIRONMENTS.md) — environment fail-closed posture
- [`docs/runbooks/break-glass.md`](break-glass.md) — emergency-access companion
- [`.claude/rules/gotchas.md`](../../.claude/rules/gotchas.md) — Display IDs, tenant resolution, audit trigger GUC
- [`.claude/rules/patterns.md`](../../.claude/rules/patterns.md) — tenant-scoped DB access, RLS, audit trigger
- [`docs/handovers/2026-05-23-cross-branch-phi-rfc.md`](../handovers/archive/2026-05-23-cross-branch-phi-rfc.md) — cross-branch posture for multi-branch tenants
- [`apps/backend/src/shared/db/seed.ts`](../../apps/backend/src/shared/db/seed.ts) — canonical bootstrap sequence for the SVX tenant
