# Security and Privacy Incident-Response Runbook

> **Status: MAINTAINED PHASE-1 PROCEDURE.** Repository controls provide
> structured logs, audit records, audit-chain verification, account/session
> controls, health/readiness signals, and optional Sentry delivery. External
> alert routing, on-call contacts, provider controls, legal assessment, and
> regulatory/data-subject notifications require owner configuration and
> evidence. Nothing in this runbook automatically files a notification.

## Non-negotiable handling rules

- Never place PHI, passwords, tokens, cookies, authorization headers, request
  bodies, connection strings, MFA secrets, or database rows in tickets, chat,
  alerts, screenshots, or ordinary logs.
- Use display IDs and tenant slugs in operational records. Keep any necessary
  identity-to-incident mapping in the approved restricted evidence store.
- Preserve logs and audit evidence. Do not update or delete `audit_logs`, bypass
  audit triggers, or “repair” an audit-chain mismatch in place.
- Contain to the smallest tenant, user, credential, integration, and time
  window. Do not silently broaden tenant or branch scope.
- Record every decision in UTC and PHT, including who authorized it.
- Start the breach-assessment clock when the organization becomes aware of a
  suspected qualifying breach; the DPO/legal owner determines applicability
  and the current deadline. Use 72 hours as the internal escalation ceiling,
  not as an automatic conclusion that notification is or is not required.

## Severity and activation

| Severity | Operational definition                                                                                                                                                               | Initial response target                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| SEV-1    | Confirmed or credible cross-tenant exposure, active credential compromise, audit tampering, destructive data loss, or unavailable critical clinical workflow with no safe workaround | Declare immediately; page Incident Commander, security/DPO, technical owner, and clinic owner |
| SEV-2    | Tenant-contained suspected exposure, material integrity issue, repeated alert-delivery failure, or degraded critical workflow with a controlled workaround                           | Declare within 30 minutes; assign the same core roles                                         |
| SEV-3    | Low-impact security defect or transient degradation with no evidence of PHI exposure or integrity loss                                                                               | Track and investigate in business hours; escalate on new evidence                             |

Any audit-chain mismatch begins as SEV-1 until proven to be an expected verifier
or partition-management defect without evidence loss.

## Roles

| Role                       | Responsibility                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| Incident Commander         | Owns severity, scope, timeline, decisions, handoffs, and closure.                             |
| Technical lead             | Contains services/integrations, preserves technical evidence, and leads recovery.             |
| Security/DPO lead          | Leads exposure assessment, evidence handling, notification decision, and privacy obligations. |
| Clinic operations lead     | Controls clinical workaround and validates safe resumption.                                   |
| Communications/legal owner | Approves regulator, data-subject, partner, and public communications.                         |
| Scribe                     | Maintains the PHI-free chronological decision log.                                            |

One person may fill multiple roles in Phase 1, but Incident Commander and final
reviewer should be different people for SEV-1.

## Procedure

### 1. Detect, acknowledge, and declare

1. Acknowledge the alert or staff report through the configured on-call path.
2. Create an incident ID and restricted record containing only:
   - detection source and safe summary;
   - first observed and acknowledged timestamps;
   - affected tenant slug(s), service, and time window;
   - current severity and confidence;
   - assigned roles; and
   - links to protected evidence, never evidence contents containing PHI.
3. If normal alert delivery failed, invoke the out-of-band contact tree and
   record the failed destination, fallback used, acknowledgement time, and owner.
   The application emits a sanitized local error and retries on the next worker
   cycle; it does not invoke the owner-managed contact tree automatically.
4. Preserve the triggering logs, Sentry event IDs, deployment ID, application
   commit, database backup point, audit partition names, and correlation IDs.

### 2. Triage without expanding exposure

Determine, with evidence:

- confidentiality: was PHI or a credential viewed or disclosed;
- integrity: were clinical, financial, identity, consent, audit, or access rows changed;
- availability: which critical workflows are unavailable and what safe manual process exists;
- scope: exact tenants, users, integrations, records/classes, and time window;
- persistence: whether tokens, sessions, API keys, webhooks, workers, or queued
  notifications can continue the incident; and
- auditability: whether logs and audit chains are complete and trustworthy.

Do not query or export full records merely to count impact. Prefer aggregate,
catalog, display-ID, and correlation-ID checks.

### 3. Contain

Choose the smallest effective action and record authorization:

- revoke the affected user's refresh-token family and disable login when account compromise is suspected;
- rotate only exposed signing/API/storage credentials through the provider secret manager;
- pause a worker or outbound integration if it is propagating the incident;
- block a vulnerable route or roll back the application to a pinned safe release;
- preserve the least-privilege `surevax_app` runtime role and RLS;
- isolate a damaged database before recovery; and
- use the emergency account-recovery lease only under
  [`break-glass.md`](break-glass.md).

Do not rotate `JWT_SECRET` expecting current sessions to end. Current access and
refresh tokens use `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, respectively.

### 4. Assess privacy and notification obligations

The security/DPO lead records:

- what data classes and approximate count of people may be affected;
- whether the data was intelligible, acquired, altered, lost, or merely at risk;
- safeguards in effect, including tenant/branch boundary and encryption;
- likely harm and vulnerable populations;
- containment and continuing risk;
- whether regulator, data-subject, clinic, insurer, processor, or law-enforcement notification is required;
- the legal source/version used for the decision; and
- decision maker, timestamp, deadline, and notification evidence reference.

Use approved templates and legal review. The repository does not verify that a
notification was delivered or that a statutory obligation is complete.

### 5. Eradicate and recover

1. Identify the root cause and the exact fixed application/configuration version.
2. Add or confirm a regression test before redeploying when feasible.
3. For data loss or corruption, follow
   [`disaster-recovery.md`](disaster-recovery.md).
4. Deploy through the normal change path with a recorded rollback point.
5. Verify:
   - `/health` and database-backed `/ready`;
   - normal login, cookie, and CORS behavior;
   - runtime role is
     `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`;
   - tenant and branch isolation;
   - audit-chain integrity;
   - alert delivery and out-of-band fallback;
   - affected clinical/financial workflow using synthetic or minimum necessary data; and
   - no unintended worker, webhook, or notification replay.
6. Obtain clinic and security/DPO acceptance before reopening traffic.

### 6. Review and close

Closure requires:

- a complete PHI-free timeline and decision record;
- reconciled audit and emergency-access evidence;
- exposure/notification decision and delivery references;
- confirmed recovery and monitoring window;
- revoked temporary access and rotated exposed credentials;
- root cause, contributing controls, and corrective actions with owners/dates;
- an alert-delivery test after remediation; and
- independent final review for SEV-1.

## Audit-chain alert response

When the audit verifier reports a mismatch:

1. Acknowledge the Sentry/notification event and declare SEV-1.
2. Record only partition name, mismatch count, first mismatching audit display ID
   or non-sensitive identifier, timestamp, environment, and correlation/event ID.
3. Freeze destructive maintenance and DPA live execution for the affected tenant
   or environment until evidence integrity is assessed.
4. Preserve database and log snapshots through approved provider controls.
5. Run the on-demand verifier from an authorized admin context and compare
   current/prior partitions without exporting row contents.
6. Treat alert-delivery failure as a second incident condition. Use the manual
   contact tree; do not downgrade because Sentry is unavailable.
7. Do not edit chain fields. Recover from a trusted point or repair only through
   an independently reviewed, evidence-preserving procedure.

## Alert-delivery failure drill

Before pilot and quarterly:

| Step                                                                 | Expected evidence                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| Trigger a synthetic non-PHI alert through the repository abstraction | Repository event/correlation ID and timestamp          |
| Confirm primary Sentry/notification destination                      | Received timestamp and acknowledging person            |
| Simulate or inject delivery failure in the test environment          | Failed delivery result; no PHI or secret in error data |
| Invoke out-of-band contact path                                      | Contacted/acknowledged timestamps within target        |
| Reconcile both paths                                                 | Test owner, result, gaps, corrective-action due dates  |

Do not disable a live production paging route merely to run this drill.

## Incident record template

| Field                                                | Value |
| ---------------------------------------------------- | ----- |
| Incident ID / severity                               |       |
| Detected / acknowledged / declared UTC and PHT       |       |
| Roles and contacts                                   |       |
| Safe summary                                         |       |
| Tenant/service/time-window scope                     |       |
| Evidence references                                  |       |
| Containment actions and approvals                    |       |
| Credentials/sessions revoked, by reference only      |       |
| Audit-chain result                                   |       |
| Exposure assessment                                  |       |
| Notification decision, deadline, authority, evidence |       |
| Recovery version and rollback point                  |       |
| Clinical/security acceptance                         |       |
| Alert and fallback verification                      |       |
| Root cause and corrective actions                    |       |
| Closed/reviewer                                      |       |

## External controls requiring owner evidence

- Sentry projects, DSNs, data-scrubbing rules, alert rules, escalation schedule,
  and successful test delivery.
- Railway deployment, database, backup/PITR, log-retention, credential-rotation,
  and access evidence.
- Cloudflare DNS/TLS/WAF/R2 configuration and activity evidence.
- Current DPO/legal notification rules, contacts, templates, and delivery evidence.
- Clinic downtime workflow, communication tree, and acceptance authority.

## Related controls

- [`break-glass.md`](break-glass.md)
- [`disaster-recovery.md`](disaster-recovery.md)
- [`pilot-go-live.md`](pilot-go-live.md)
- [`../compliance/dpa-controls.md`](../compliance/dpa-controls.md)
