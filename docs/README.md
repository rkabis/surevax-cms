# SureVax CMS: Documentation Map

Start here. This indexes everything under `docs/` plus the doc-like files at the
repo root.

## Living documents (edit in place, no dated forks)

| Doc                                                                                  | What it is                                                                                                                                            |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`STATUS.md`](STATUS.md)                                                             | **The backlog.** Current state + open work (P0 / P1 / P2) + deferred items + verification status + owner decisions. Single source for "what's next."  |
| [`ROADMAP.md`](ROADMAP.md)                                                           | Long-term module expansion (Phase 2 to 4: pharmacy, telemedicine, and beyond). Aspirational, past go-live.                                            |
| [`ENVIRONMENTS.md`](ENVIRONMENTS.md)                                                 | dev to production transition plan + runtime posture.                                                                                                  |
| [`ai-context/_INDEX.md`](ai-context/_INDEX.md)                                       | Router to the 7 durable architecture/context files (data model, backend API, frontend, infra, deps, clinical workflows). Read only what's relevant.   |
| [`phase-1-financial-controls-decisions.md`](phase-1-financial-controls-decisions.md) | Owner/bookkeeper sign-off record for void/refund staffing and patient-credit document semantics; engineering compatibility boundary is recorded here. |

## Current indexed delivery record

| Delivery                                                                                     | Narrative record                                                                                           | Live follow-up                                        |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Phase-1 financial controls — PR [#617](https://github.com/njvil/surevax-cms-revamp/pull/617) | [`handovers/2026-08-23-phase-1-financial-controls.md`](handovers/2026-08-23-phase-1-financial-controls.md) | `STATUS.md` → **Phase-1 financial controls closeout** |

## Current implementation records

These records explain what changed and why. Current priorities still belong in
[`STATUS.md`](STATUS.md).

| Record                                                                                                                       | Scope                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`handovers/2026-08-23-phase-1-revenue-integrity-reporting.md`](handovers/2026-08-23-phase-1-revenue-integrity-reporting.md) | PR #618 investigation, report contracts, financial semantics, role/RLS boundaries, adversarial review, verification evidence, and intentionally excluded work |
| [`handovers/2026-06-19-appsheet-data-crosscheck.md`](handovers/2026-06-19-appsheet-data-crosscheck.md)                       | AppSheet live-data cross-check and migration/capability evidence                                                                                              |

## Current readiness evidence

| Doc                                                                                                        | Publication status                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`audits/2026-08-22-branch-account-live-usability.md`](audits/2026-08-22-branch-account-live-usability.md) | **Current pilot decision.** Live seeded Branch-account walkthrough performed 2026-08-23: **NO-GO** pending the P0/P1 acceptance tests tracked in [`STATUS.md`](STATUS.md). |
| [`nurse-testing-readiness.md`](nurse-testing-readiness.md)                                                 | Earlier code/test-based readiness assessment. Retained as point-in-time evidence; it does not override the later live-browser findings.                                    |

## Reference by topic

| Dir                          | Contents                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ai-context/`](ai-context/) | Durable architecture reference (the deep-context set).                                                                                         |
| [`decisions/`](decisions/)   | [Indexed architecture decisions](decisions/README.md), including bounded implementation and compatibility contracts.                           |
| [`specs/`](specs/)           | Design specs / RFCs for implemented or planned features.                                                                                       |
| [`runbooks/`](runbooks/)     | Operational procedures: pilot admission, incident response, disaster recovery, emergency account recovery, tenant onboarding, and RLS cutover. |
| [`migration/`](migration/)   | AppSheet to SureVax data-migration analysis + script docs.                                                                                     |
| [`audits/`](audits/)         | Point-in-time analyses + audit artifact bundles, including the current Branch-account live usability audit.                                    |
| [`compliance/`](compliance/) | Regulatory notes (DPA / BIR / DOH).                                                                                                            |
| [`security/`](security/)     | Security reviews.                                                                                                                              |
| [`handovers/`](handovers/)   | Dated, append-only session notes. See [`handovers/README.md`](handovers/README.md). Superseded ones live in `handovers/archive/`.              |

## Current implementation record

| Work                            | Durable decision                                                                                                         | Session history                                                                                  | Live next steps                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Corporate/group billing PR #615 | [`2026-08-22-corporate-group-billing-vertical-slice.md`](decisions/2026-08-22-corporate-group-billing-vertical-slice.md) | [`2026-08-23-corporate-group-billing-pr.md`](handovers/2026-08-23-corporate-group-billing-pr.md) | [`STATUS.md`](STATUS.md#pending-review-2026-08-23-corporategroup-billing-pr-615) |

## Feature implementation index

| Feature                         | Contract                                                           | Implementation record                                                                            | Publication state                                                                                       |
| ------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Runtime Review Center — Phase 1 | [`specs/review-center-phase-1.md`](specs/review-center-phase-1.md) | [`handovers/2026-08-23-review-center-phase-1.md`](handovers/2026-08-23-review-center-phase-1.md) | Implemented in [PR #616](https://github.com/njvil/surevax-cms-revamp/pull/616); pending merge to `main` |

## Doc conventions

- **Living vs narrative.** State that changes over time lives in the living docs
  above and is edited in place. Time-stamped narrative ("what I did this
  session") goes in `handovers/` and is append-only. A handover never becomes the
  backlog; it links to `STATUS.md`.
- **The backlog has one home.** If you catch yourself updating "what's next" in
  more than one file, that is drift. Put it in `STATUS.md` and link.
- **Agent instructions are separate.** `.claude/rules/*.md` (always loaded) and
  `.claude/skills/` (on demand) steer the agent, not human readers.
  `.claude/rules/risks.md` is the risk register; the actionable backlog is
  `STATUS.md`.
