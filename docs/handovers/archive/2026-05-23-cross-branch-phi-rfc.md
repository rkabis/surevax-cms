# Handover — Cross-Branch PHI Access RFC (2026-05-23)

> **✅ IMPLEMENTED 2026-06-03 — steps 4–10 landed.** Break-glass route +
> `emitCrossBranchAccessAudit`, worker/admin migration onto the `withSystemTx` /
> `crossBranchRead` model, the breaking `branch_isolation` default-closed flip
> (now declared `AS RESTRICTIVE` so it actually AND-combines with
> `tenant_isolation`; persistent per-branch grants per D1; break-glass is
> read-only via `WITH CHECK`), the `BreakGlassReveal` modal, and the
> `/admin/cross-branch-access` review page. Proven by
> `apps/backend/tests/integration/cross-branch-phi.test.ts` (the 4 §6.5
> scenarios). Decisions D1–D6 below are locked; this doc is retained as the
> design/decision record.

> Companion handover to the [Pattern B RFC](../../specs/cross-branch-phi-access.md).
> The RFC is the implementation design; this doc is the **decision queue** —
> what needs sign-off, by whom, and what's blocked on what.

---

## Why this exists

The 2026-05-23 UI/UX audit surfaced ambiguous PHI access posture for
multi-branch tenants. The current `branch_isolation` RLS policy
default-opens to cross-branch reads when no branch GUC is set
(`0001_extensions_and_rls.sql:495-507`), and `withTenantTx` accepts
`branchId: null` without flagging the implicit cross-branch behavior.
A 2026-05-23 conversation clarified:

- **`Branch` login** is intentional shared-clinic access (kiosk, multiple
  staff use the same account at one physical location)
- **Per-role gating** is deferred to a future phase
- **Branch must be able to do all the workflows** — full clinical +
  billing access within the branch
- **Continuity-of-care across branches** is operationally important —
  a rabies PEP patient who moves between branches mid-series can't be
  re-enrolled

The question raised: should branches see all patients tenant-wide and
only see _details_ for their own branch, or should every cross-branch
read go through an approval flow?

The recommendation in the RFC is **Pattern B** — tenant-wide patient
_identity_ (search, demographics, safety flags, recent doses, active
courses) is always visible, but the full clinical _chart_ (encounter
detail, lab results, billing, free-text notes) is filtered to the
branch-of-service. Cross-branch chart access is "Break the Glass" —
one-click with a mandatory reason field, audit row emitted, grant
recorded for retrospective review.

This is the industry-default model (Epic, Cerner, Athenahealth,
CommonWell) and maps cleanly to DPA §19/§20 and HIPAA "minimum
necessary".

---

## Decisions needed before implementation starts

Listed in dependency order. Items further down depend on items above.

### D1. Confirm Pattern B over A or C

**Owner:** project lead / clinical-ops

**Default if undecided:** Pattern B (the RFC's design)

**Trade-offs:**

- **Pattern A** (strict isolation, break-glass everything) is the strictest
  posture but creates clinical safety hazards for mid-series patients
- **Pattern B** (tenant-wide identity + branch-scoped chart + break-glass)
  is the industry default and balances safety, privacy, and operations
- **Pattern C** (tenant-wide open with audit) is the simplest but fails
  DPA "proportionality" and HIPAA "minimum necessary"

**Action:** explicit yes/no on Pattern B. Then proceed with the RFC.

### D2. Financial-data scope

**Owner:** finance / operations

**Question:** should branch staff see consolidated financials (revenue,
AR, claims) across branches, or only their own?

**Options:**

- **Branch-scoped only** (default in RFC) — cleanest accountability,
  matches clinical-chart model
- **Tenant-wide for TenantAdmin role only** — consolidated revenue
  view for tenant owners
- **Tenant-wide for everyone** — diverges from clinical model

**RFC recommendation:** branch-scoped by default; TenantAdmin role
bypasses for consolidated reporting. Branch-role users break-glass for
cross-branch transactions when a patient paid at branch A for a service
delivered at branch B.

### D3. Break-glass duration

**Owner:** clinical-ops

**Question:** how long does a break-glass grant last?

**Options:**

- **Per request** (RFC default) — strictest; modal fires on every page
  navigation
- **Per session** (8h shift) — fewer interruptions for legitimate
  continuity-of-care use
- **Per-patient per-shift** — break-glass once for a patient, see their
  records the rest of the shift

**RFC recommendation:** per-request for Phase 1. If operational friction
is excessive, shorten the modal to one click for `Continuity_of_care`
specifically (keep audit emission, drop the reason field for that
category) while keeping the reason field for the other categories.

### D4. AEFI cross-branch visibility

**Owner:** clinical-ops

**Question:** should adverse event severity / outcome be visible across
branches in the Tier-1 demographic projection? Detail definitely stays
in Tier 2 — but is even severity-only visible considered too sensitive?

**RFC recommendation:** severity visible in Tier 1 (treats AEFI like
active recalls — patient safety signal). Detail stays in Tier 2 with
break-glass.

### D5. Lab result cross-branch visibility for series safety

**Owner:** clinical-ops

**Question:** should "recent critical lab results" be in Tier 1, or
only in Tier 2?

**RFC recommendation:** add `recent_critical_lab_results` to Tier 1
(last 90d, only `ResultReceived` status, only critical-flagged). Full
lab result data stays Tier 2. Reason: a nurse administering Day 3 ARV
should see that Day 2 INR came back critical, even if it was tested at
a different branch.

### D6. Approval-queue path vs break-glass only

**Owner:** project lead / future enterprise customers

**Question:** does the optional approval-queue path (RFC §5.6) ship in
Phase 1, or defer to Phase 2?

**RFC recommendation:** defer to Phase 2. The `approval_requests` infra
already exists in the codebase; flipping break-glass into an approval
queue is a config change later, not a rewrite. Phase 1 ships
break-glass mode.

---

## Implementation dependencies

The RFC implementation depends on these pre-existing items:

| Dependency                                                                    | Status     | Source                 |
| ----------------------------------------------------------------------------- | ---------- | ---------------------- |
| `pino-http` + correlation_id middleware (audit needs IP/UA columns populated) | ✅ shipped | 360 codebase review H2 |
| `consents` table polymorphic by `scope_ref_type`/`scope_ref_id`               | ✅ shipped | Schema v2 Phase 4      |
| `audit_logs` SHA-256 chain + BEFORE-INSERT trigger                            | ✅ shipped | PR #228                |
| `CROSS_BRANCH_ACCESS` audit action enum value                                 | ✅ exists  | `AuditPage.tsx:195`    |
| `user_branches` junction populated                                            | ✅ shipped | Wave 2.1               |
| `app.current_branch_id` GUC mechanism                                         | ✅ shipped | `withTenantTx`         |
| `approval_requests` table (for D6 deferred path)                              | ✅ shipped | Phase 1                |

The must-land-first dependency, **H2 from the 360 codebase review**
(pino-http + correlation_id), shipped 2026-05-23. `CROSS_BRANCH_ACCESS`
audit work can now rely on request correlation plus IP / user-agent GUCs.

---

## Effort estimate

Per the RFC §6.1 step-by-step:

| Step | Description                                           | Effort                |
| ---- | ----------------------------------------------------- | --------------------- |
| 1    | Land H2 (pino-http)                                   | ✅ shipped 2026-05-23 |
| 2    | `patients_demographic_v` view                         | 0.5 day               |
| 3    | `cross_branch_access_grants` table                    | 0.25 day              |
| 4    | `withTenantTx` + `emitCrossBranchAccessAudit`         | 0.5 day               |
| 5    | Migrate workers to `withWorkerTx`                     | 0.25 day              |
| 6    | Migrate admin endpoints to `crossBranchRead`          | 0.5 day               |
| 7    | Flip RLS policy default-closed                        | 0.25 day + test suite |
| 8    | Frontend Tier-1/Tier-2 split + BreakGlassReveal modal | 1.5 days              |
| 9    | `/admin/cross-branch-access` page                     | 0.5 day               |
| 10   | Documentation updates                                 | 0.5 day               |

**Total remaining:** ~4.5 person-days. Each step is independently
shippable except Step 7 which is the breaking change.

---

## Risks / open concerns

### Performance of the demographic view

The aggregated JSON columns (allergies, conditions, courses, doses,
recalls) are correlated subqueries. For a tenant with 100k+ patients
this could be slow on full-text patient search. Mitigations:

- Existing indexes on `(patient_id)` on every joined table
- `LIMIT 20` on `recent_doses`
- Consider `MATERIALIZED VIEW` with 5-min refresh post-Phase 1 if
  needed

### Worker-path migration risk

Step 5 migrates 6 worker code paths from `withTenantTx({ branchId:
null })` to a new `withWorkerTx`. Risk: a worker silently stops reading
data because the old null-branch loophole is closed. Mitigation:
integration tests for each worker before / after migration, and the
breaking-change throw in `withTenantTx` (RFC §4.4) makes silent
failures impossible — they crash loudly.

### Cross-branch audit-row volume

Every break-glass produces an `audit_logs` row + a
`cross_branch_access_grants` row. For a chain where 10% of visits are
cross-branch continuity, this is significant audit-log growth. The
existing audit-log retention (10-year partitioned by month per
`0010_audit_retention.sql`) handles it, but worth flagging for
storage planning.

### Operational friction

If break-glass fires every page navigation (per RFC default), nurses
will mash through the modal without reading it — defeating the
compliance value. D3 above addresses this. Plan to instrument
"% of break-glass clicks that used a reason_detail under 20 characters"
post-launch — if it's high, the modal is theater, not control.

### Patient explicitly opting out of cross-branch

DPA gives the patient the right to revoke consent. Currently, the
`consents` table tracks DPA consent at the tenant level. If a patient
revokes consent specifically for cross-branch sharing within the
tenant, the system has no place to record that. This RFC treats
cross-branch within tenant as covered by the original tenant DPA
consent ("treatment relationship" basis under DPA §13(b)), but a
patient who objects has no recourse short of revoking _all_ consent.
Possible future extension: per-purpose consent scoping. **Not in
this RFC.**

---

## What to do next

1. **Read the RFC** at [`docs/specs/cross-branch-phi-access.md`](../../specs/cross-branch-phi-access.md)
2. **Get sign-off on D1-D6** (decisions above) from the listed owners
3. **Confirm H2 (pino-http) landed first** — shipped 2026-05-23
4. **Start with Steps 2-6** (additive, non-breaking) — these can ship in
   parallel with any other UI audit fix waves from
   [`2026-05-23-ui-audit-deep-dive.md`](2026-05-23-ui-audit-deep-dive.md)
5. **Hold Step 7** (the breaking RLS flip) until the integration suite
   covers the four scenarios in RFC §6.5
6. **Frontend Step 8** can begin as soon as Step 2 ships (the view is
   the read path)
7. **Document the quarterly review SOP** as part of Step 10 in
   `docs/runbooks/cross-branch-access-review.md` — this is the
   organizational control that makes the technical control meaningful

---

## References

- RFC: [`docs/specs/cross-branch-phi-access.md`](../../specs/cross-branch-phi-access.md)
- 2026-05-23 UI audit (Branch role finding):
  [`docs/handovers/archive/2026-05-23-ui-audit-deep-dive.md`](2026-05-23-ui-audit-deep-dive.md)
- 360 codebase review (M12 default-open RLS, H2 pino-http):
  [`docs/handovers/archive/2026-05-23-360-codebase-review.md`](2026-05-23-360-codebase-review.md)
- Current RLS policy:
  [`apps/backend/drizzle/0001_extensions_and_rls.sql:495-507`](../../../apps/backend/drizzle/0001_extensions_and_rls.sql)
- DPA controls register:
  [`docs/compliance/dpa-controls.md`](../../compliance/dpa-controls.md)
- Tenant-scoped DB pattern:
  [`.claude/rules/patterns.md`](../../../.claude/rules/patterns.md)

---

## Cross-link in TODO.md

Adding a top-line item to `TODO.md` under the UI/UX Audit Fixes
section so this doesn't slip:

```markdown
### Wave 0 — Architecture decision (sign-off required)

- [ ] **Cross-branch PHI access model** — read RFC, get D1-D6 sign-off,
      start Steps 2-6 of the implementation.
      Owner: project lead + clinical-ops + finance for D2.
      See: [`docs/handovers/2026-05-23-cross-branch-phi-rfc.md`](docs/handovers/2026-05-23-cross-branch-phi-rfc.md)
```
