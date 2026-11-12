# DPA / NPC Phase-1 Control Register

> **Status:** Maintained repository control register, updated 2026-08-22. The
> repository implements the controls explicitly marked below; Railway,
> Cloudflare R2, Sentry, backup/PITR, legal approvals, and delivery evidence are
> external and unverified until an owner attaches current account evidence. The
> last documented posture was development-only; that external state was not
> re-verified for this update. Do not admit real PHI until
> [`../runbooks/pilot-go-live.md`](../runbooks/pilot-go-live.md) passes.

---

## Scope

This control register covers Sensitive Personal Information (SPI) stored and processed by SureVax CMS. In-scope data includes:

- **PHI in tenant-scoped tables** (defined in `apps/backend/src/shared/db/schema.ts`):
  - `patients` — name, date of birth, sex, contact details, MRN
  - `encounters` — SOAP notes, presenting complaints, vital signs
  - `clinical_orders` — vaccine/medication orders, dose records
  - `lab_orders` — test requests, results
  - `attachments` — files stored in Cloudflare R2 (lab result PDFs, consent forms)
  - `audit_logs` — append-only tamper-evident audit trail referencing the above
- **Non-genomic clinical data** — vaccine administration records, adverse event records, standing-order schedules, consent records
- **Government-issued IDs and insurance numbers** stored as free-text fields on `patients` (PhilHealth ID, PWD/SC card numbers)

Out of scope for this register:

- Pseudonymized or aggregated analytics tables (no direct PII linkage)
- Application-level session tokens and short-lived JWTs (covered by the HTTP-only cookie + TLS controls)
- Data held exclusively in client-side browser memory (no PHI cached client-side; all PHI is server-side)

---

## Regulatory Basis

| Instrument                                                                | Relevance                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RA 10173 — Philippine Data Privacy Act of 2012**                        | Primary legal basis. Requires organizations processing SPI to implement reasonable and appropriate security measures. §20 mandates organizational, physical, and technical security measures proportionate to the nature of the data.                                             |
| **NPC Circular 2023-06 §5 — Security of Personal Data**                   | Specifies AES-256 (or equivalent) at rest and TLS 1.2+ in transit as acceptable technical controls for SPI. The controls documented in this register satisfy these requirements via infrastructure-managed encryption.                                                            |
| **NPC Circular 16-01 — Security of Personal Data in Government Agencies** | Cited as the closest available control-structure template. **Note:** SureVax is a private-sector system; NPC Circular 16-01 is jurisdictionally binding only on government agencies. It is referenced here for control taxonomy and evidence format, not as a binding obligation. |

---

## Decision: B1a — Railway-Managed At-Rest Encryption as the SPI Control

**Decision statement:** SureVax CMS adopts Railway-managed PostgreSQL at-rest
encryption as the intended primary technical control for SPI at rest. This is
"Path B1a" as documented in
`docs/handovers/archive/2026-05-19-remaining-todos.md` §5 B1. Adoption is a
design decision, not proof that the current Railway account satisfies it; the
owner must attach current provider/account evidence before PHI.

The team assessed two paths:

- **B1a (adopted):** Rely on Railway-managed AES-256 disk encryption on the underlying AWS EBS volumes. Infrastructure-level; zero application code required; standard NPC attestation language available from Railway's data-security documentation.
- **B1b (deferred):** Column-level encryption via `pgcrypto` on PhilHealth ID, government IDs, and free-text SOAP notes. Defeats a DB-admin "SELECT \*" attack vector, but breaks search and join operations on encrypted columns, and requires key-management infrastructure SureVax does not yet have.

**Rationale for B1a:** The current threat model trusts the Railway platform boundary. No evidence has emerged (pen tests, NPC circulars, or customer contractual requirements) that application-layer encryption is required at this stage. B1b is documented under §Re-evaluation Triggers below and will be revisited if the threat model changes.

---

## Control Surfaces

External documentation links below are historical references, not current
account attestations. Re-verify the provider statement and the live account
configuration before regulator, customer, or pilot reliance.

| Surface                            | Intended mechanism                                                                      | Current evidence status                                                                                                                                       | Owner action before PHI                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Postgres at rest**               | Railway-managed encrypted storage under the adopted B1a decision                        | **External/unverified.** Historical provider reference: https://docs.railway.com/reference/data-encryption                                                    | Attach current provider statement, live database/plan evidence, region, retention, and responsible owner.                 |
| **Postgres in transit**            | TLS connection string supplied by Railway; application does not disable TLS             | **Partly repository-defined, externally unverified.** `apps/backend/src/shared/db/index.ts` does not override the connection SSL mode.                        | Verify the live runtime and migrator URLs require TLS without recording either URL.                                       |
| **Attachments at rest/in transit** | Cloudflare R2 managed encryption and HTTPS presigned object access                      | **Repository path implemented; external bucket absent/unverified until evidenced.** Historical reference: https://developers.cloudflare.com/r2/data-security/ | Verify bucket, encryption/retention, restricted credentials, exact-origin CORS, object cleanup, and evidence owner.       |
| **Runtime tenant isolation**       | `surevax_app` is `NOSUPERUSER NOBYPASSRLS`; tenant/branch GUCs are transaction local    | **Repository migrations/helpers implemented; production role external/unverified.**                                                                           | Run role and cross-tenant/branch probes against the live runtime connection.                                              |
| **Audit integrity and alerting**   | Partitioned hash-chained audit log, verifier, and actionable security-alert abstraction | **Repository implemented; external Sentry/notification delivery unverified.**                                                                                 | Configure scrubbing, alert destination, acknowledgement, and failure fallback; preserve synthetic test evidence.          |
| **Backup at rest and recovery**    | Railway backup/PITR under approved RPO/RTO                                              | **External/unverified; no completed restore evidence is recorded here.**                                                                                      | Approve RPO/RTO, verify live policy, and complete [`../runbooks/disaster-recovery.md`](../runbooks/disaster-recovery.md). |

---

## Erasure/Retention Workflow and Residual Limits

The repository now implements a deliberately gated Phase-1 primary-store
de-identification workflow:

1. `POST /api/admin/dpa/purge` produces tenant-scoped impact analysis only.
2. `POST /api/admin/dpa/erasure-requests` creates a 24-hour
   `patient_erasure` approval request bound to one patient display ID. It
   requires two TenantAdmin approvers and records request, legal-basis,
   structured retention decision (`retain_required_records` or
   `no_additional_retention`), and rollback references. Free-text rationale is
   prohibited so approval/audit evidence cannot become a secondary PHI store.
3. The requester cannot satisfy their own approval, distinct approving votes
   are required, and platform administrators cannot request or execute tenant
   erasure. Because only a TenantAdmin can create the request and the request
   requires two other TenantAdmin votes, the tenant needs at least three
   individually assigned active TenantAdmin accounts; a shared Branch login
   does not satisfy this separation.
4. `POST /api/admin/dpa/erasure-requests/:approvalId/execute` locks and consumes
   an approved request once. Wrong tenant/patient/purpose, missing quorum,
   expiry, rejection, replay, and incomplete evidence fail closed.
5. Live execution refuses while any associated attachment metadata remains,
   including soft-deleted rows. Soft deletion does not delete or prove deletion
   of the R2 object. Object deletion and metadata reconciliation are separate,
   authorized owner actions.
6. The database de-identifies the primary patient identity and deletes direct
   operational identifiers including emergency contacts, patient notifications,
   and patient cross-branch grants. It deliberately retains clinical,
   financial, consent, audit, and PHI-access records under their applicable
   retention bases.
7. A `dpa_erasure_executions` record preserves the impact, completion, and
   rollback-limit reports plus executor, approval, request, and rollback
   references. One approval can produce only one execution record.

The completion response and evidence explicitly report
`statutoryDeletionComplete: false`. Live execution is irreversible after its
transaction commits. Restoring an older backup could reintroduce identifiers
and therefore requires separate authorization and DPA reconciliation.

This workflow is operator/request driven; it is not proof that every lawful
retention period has elapsed, every R2 object was deleted, every processor copy
was erased, or every backup expired. Soft deletion is never evidence of
statutory deletion.

## Recorded Gaps and Re-evaluation Items

The following controls remain gaps or external responsibilities for DPO review.

1. **Column-level encryption (pgcrypto) — B1b, not implemented.**
   PhilHealth ID, government-issued ID numbers, and free-text SOAP notes are stored in plaintext columns on the Railway-managed encrypted disk. The "SELECT \* as a DB admin" attack vector is not mitigated at the application layer. Rationale: column-level encryption defeats indexed search and joins; current threat model accepts this; Railway's tenancy boundary is trusted. Revisit under §Re-evaluation Triggers.

2. **Mobile / local client PHI caching — out of scope.**
   SureVax CMS is a server-rendered web application; no PHI is persisted in localStorage, IndexedDB, or native mobile storage. If a React Native / PWA offline mode is added in future, this gap must be re-evaluated.

3. **External object deletion and backup expiry are not automated proof.**
   Every associated attachment metadata row, including soft-deleted metadata,
   blocks primary-store execution until the owner authorizes, verifies, and
   reconciles R2 deletion. Retained backups/processors remain governed by their
   approved schedules and cannot be reported complete from the primary database
   result.

4. **Backup verification / DR drill — pilot blocker.**
   Backup/PITR availability and encryption are external and unverified here. An
   untested backup is not recovery evidence. RPO/RTO require owner approval and
   a timed isolated drill under
   [`../runbooks/disaster-recovery.md`](../runbooks/disaster-recovery.md).

5. **Legal-basis and statutory-completion decisions remain human controls.**
   Repository quorum proves that two authorized application users approved the
   bounded execution; it does not determine the applicable retention law,
   validate external approver authority, or make regulator/processor filings.

---

## Re-evaluation Triggers (When to Revisit B1a vs. B1b)

Revisit this decision and assess whether B1b (column-level encryption) is required if any of the following occur:

1. **A Phase 2 customer contract requires column-level encryption attestation.** If a clinic's HIPAA-equivalent obligations or their own DPO assessment requires application-layer SPI encryption, B1b must be scoped before that customer's data enters production.

2. **NPC publishes a binding circular requiring application-layer SPI encryption.** If the NPC explicitly places the DB-admin attack vector in scope (i.e., encryption must survive disclosure of the DB connection string), B1a is no longer sufficient.

3. **A penetration test or formal risk assessment classifies Railway's tenancy boundary as insufficient.** If a pen tester demonstrates a realistic DB-admin exfiltration path that Railway's controls do not mitigate, B1b is required.

4. **SureVax migrates off Railway-managed PostgreSQL.** If the team self-hosts PostgreSQL (bare metal, self-managed AWS RDS without integrated encryption attestation, or any provider where disk encryption is not on by default and verified), this register must be updated before migrating any PHI.

---

## Decision-Owner Attestation

- **Document owner:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ (CTO / Tech Lead)
- **Reviewing officer (DPO equivalent):** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_
- **Date of initial decision:** 2026-05-21
- **Next scheduled review:** 2027-05-21 (annual) OR upon a re-evaluation trigger above
- **Signature / approval reference:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ (PR # / signed PDF / e-signature ID)

---

## Cross-References

- `.claude/rules/gotchas.md` — operational gotchas covering JWT secret rules, audit trigger requirements, and RLS enforcement patterns
- `docs/ai-context/01-DATA-AND-COMPLIANCE.md` — overall data architecture and DPA alignment narrative (encryption, retention schedule, breach-notification obligations)
- `docs/handovers/archive/2026-05-19-remaining-todos.md` §5 — historical
  compliance backlog; use this maintained register for current B2 status
- `docs/runbooks/break-glass.md` — one-time tenant-admin account-recovery lease;
  distinct from clinical cross-branch chart reveal
- `docs/runbooks/disaster-recovery.md` — backup/restore evidence and DPA restore reconciliation
- `docs/runbooks/incident-response.md` — breach assessment, containment, recovery, and notification decision record
- `docs/runbooks/pilot-go-live.md` — final operational gate before real PHI
