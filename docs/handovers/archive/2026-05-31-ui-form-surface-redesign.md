# Handover — UI/UX cleanup + form-surface redesign (2026-05-31)

**Status:** audit + product-owner preferences captured; rule + context codified
in PATTERNS.md / CLAUDE.md (P0 done). **P1 + P2 landed 2026-06-01** — patient
record/register/edit are now full-page routes with a persistent search switcher
and a generalised next-dose banner; the Arrivals wizard registers via the
`/patients/new?returnTo=arrivals` page route (the legacy `<Sheet>` form is gone);
Scheduled Orders is keyboard-driveable (⌘↵ administer → payment hand-off) and
denser. **P3 landed 2026-06-03** — the Dashboard surfaces Cash vs Non-cash
collected today and wires the shift menu (Print EOD report → the print-ready
`/day-summary`, Close drawer → the existing dialog); the Day Summary prints as a
clean A4 end-of-day report. **P4–P5 landed 2026-06-03** — the dose-schedule
visualisation is generalised to any standing order (`StandingOrderTab` replaces
the PEP-specific tab) and the manual `EncounterForm` is now a full-page route.
**Scope:** standardise which create/edit/action forms are **overlays** (modal /
sheet) vs **full pages**, and align all UI/UX decisions to how the clinic
actually works. Optimised for the **only** target device: a 27" front-desk Mac.

> **TL;DR** — Design for **one operator (the Branch role) on one 27" Mac**, with
> the **Dashboard** as home. The two daily workhorses are the **Scheduled-Orders
> "due today" worklist → Administer (fast overlay) → payment after**, and the
> **Arrivals wizard** for walk-in first visits (already a page). The patient
> record becomes a **full page reached by search**, and **patient
> register/edit** moves there too (revised from "pane"). Most other forms stay
> overlays. Appointments, lab-result entry, mobile/tablet, and offline are all
> **deferred** per the product owner.

---

## 1. Clinic workflow & UI/UX preferences (authoritative — product owner, 2026-05-31)

These answers override generic SaaS assumptions. Build to these.

### Platform & scope

- **Only device that matters: the 27" front-desk Mac (2560×1440).** Kiosk,
  tablet, mobile, and touch operation are **deferred** — do not invest in them
  now. (The primitive-level responsiveness already shipped in #519/#520 stays as
  cheap insurance, but no further small-screen work.)
- **Always online** — no offline/queue handling.
- **Receipts are Acknowledgement Receipts, not BIR ORs** — no BIR OR formatting
  needed in the UI (`AcknowledgementReceipt.tsx` is the artifact).

### One role, one machine

- **Only the `Branch` role matters right now — it does everything** (register,
  administer, take payment, book, reconcile). **Do not build per-role landing
  pages or role-gated UI** yet. Physician/Nurse/Cashier/Admin splits are later.
- **Home screen = Dashboard** for the Branch operator.
- **One shared physical machine** per branch (shift handover via clock-in/out +
  drawer session).
- **Branch logins are location-bound** — a branch account must not be usable
  from another physical location (security constraint; surface the _current
  branch_ clearly in the UI). One person may have access to multiple branches,
  but each branch login lives at that branch.

### The daily loop

- **Return-visit dose (high volume, must be fast):** operator opens
  **Scheduled Orders → due today**, the patient presents a physical vaccination
  card / ID, operator clicks **Administer**, then **collects payment afterward**
  (administer and payment are **sequential**, not a combined screen). Most doses
  are returning doses.
- **First visit / walk-in (frequent):** the **Arrivals wizard** is the preferred
  path (creates patient + encounter + standing order + Day-0 dose). Registering
  first and doing the encounter later is _possible_ but the wizard is easier.
  Appointments are **not yet used**, so walk-ins dominate.
- **End of day:** drawer reconciliation + day summary, especially **cash vs
  non-cash** — ideally surfaced on the Dashboard, plus a generated
  **end-of-day report** (desired feature; not built).

### Behaviour & interaction

- **Worklists default to "what needs me now"** (urgency-sorted). On Scheduled
  Orders, **Due today is first**; **Overdue** and **Backfill** are separate
  filters.
- **Denser tables** preferred (more rows, smaller text within the scale floor).
- **Both keyboard and mouse** supported; keyboard-first where it speeds work
  (cashier flow is the model).
- **Irreversible actions require a typed reason.** **Payments must not be easily
  undoable** (hard-gated void/refund); **administration is flexible**
  (amend/reschedule allowed).

### Clinical specifics

- **Generalise the dose-schedule visualisation to ANY standing order, not just
  rabies PEP** — a patient may be on PEP _or_ another scheduled-dose vaccine.
  Show **standing-order status**, not "PEP" specifically (Pattern 13, dashboard
  "next dose due", patient record).
- **Patient record's #1 at-a-glance fact: next dose due.**
- **Bite assessment wants richer input** (structured / body-map) — future
  enhancement.

### Aesthetic

- Stay **stock shadcn** (blue/white, Inter) — confirmed; details in §7.

---

## 2. The form-surface decision rule (the standard to apply)

Match the surface to the form's size/complexity — **not** "everything becomes a
page." Codify in PATTERNS.md next to "Page archetypes".

| Form shape                                                                    | Surface                  | Rationale                                          |
| ----------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------- |
| Confirm / destructive yes-no                                                  | `AlertDialog`            | Blocking is the point                              |
| 1–5 controls, one quick action                                                | `Dialog` (modal)         | Fast, in-context; a page is friction               |
| ~6–12 controls, single logical group, edit-in-place                           | `Sheet` (`width="wide"`) | Keeps context, fits without a scroll-tunnel        |
| **Multi-section, multi-step, or ~15+ controls, or a full-entity create/edit** | **Full page** (route)    | Narrow rail/modal becomes a tunnel; wastes the 27" |

Trigger for "page" is qualitative: **multiple sections, steps, or doesn't fit
without heavy scrolling.** Never nest overlays (dialog-from-sheet); use the
**same surface for create and edit**. Irreversible commits get a typed-reason
gate (§1).

---

## 3. Verified finding — the per-visit workhorse is _Administer_, not _Encounter_

A multi-agent audit first ranked `EncounterForm` as the #1 "needs a page,
used every visit" surface. **Code trace disproved the frequency claim** — and it
matches the product owner's Q8/Q9 description exactly:

- `EncounterForm` has **one caller** — the manual "New encounter" button on
  `PatientDetail.tsx:313`. Nothing opens it automatically.
- **Return-visit dosing never touches it.** `AdministerDialog` reuses the
  existing encounter — `scheduled_orders/db.ts:1005`
  `effectiveEncounterId = order.encounterId ?? order.psoInitiatingEncounterId` —
  inserts a `consents` row + marks the clinical order administered. No new
  encounter, no form.
- Encounters are created in only two places: `encounters/db.ts` (the manual
  form) and `arrivals/routes.ts` (the **first-visit wizard**, which also writes
  the standing order). Standing orders come from arrivals + bite-incidents,
  **never** from the encounter form.

**Conclusion:** the high-frequency per-visit surface is **Administer (overlay)**;
the dense first-visit surface is the **Arrivals wizard (already a page)**.
`EncounterForm` is a **lower-frequency, manual/ad-hoc** fallback. It was demoted
accordingly below.

---

## 4. Revised form-surface verdicts

### 🔴 REWORK → full page

| Form / surface              | File                                             | Now                 | → Target                                                                                                                                                            |
| --------------------------- | ------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Patient record (view)**   | `features/patients/components/PatientDetail.tsx` | Master-detail split | **Full page `/patients/:id`** + persistent patient-search switcher in header (see §5)                                                                               |
| **Register / edit patient** | `features/patients/components/PatientForm.tsx`   | Sheet (672px)       | **Full-page `/patients/new`, `/patients/:id/edit`** (revised from "pane" — consistent now that the record is a page). 17 fields / 7 sections; lay out multi-column. |

### 🟠 REWORK → full page, but LOWER priority

| Form                    | File                                               | Why lower                                                                                                                                           | → Target                        |
| ----------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Manual ad-hoc encounter | `features/encounters/components/EncounterForm.tsx` | The frequent walk-in path is the **Arrivals wizard** (already a page); this is the manual fallback. Page it for consistency once Patients is paged. | Full page (or reuse the wizard) |

### 🟢 KEEP as overlay — correct, do not change

- **Administer dose** (`scheduled-orders/AdministerDialog`) — the per-visit
  workhorse; keep it a **fast overlay**, amendable/flexible (§1).
- **Payment, Void, Refund, Apply prepayment, Print** — overlays; **payment
  void/refund hard-gated with a typed reason** (§1).
- Sub-record adds: Allergy, Condition, Emergency contact, External immunization.
- Order actions: Reschedule, Append external dose.
- Lab/safety quick updates: Mark sent, Upload result, Record outcome, Update AEFI.
- Inventory: Ship/receive transfer, adjust.
- All `AlertDialog` confirmations.
- Read-only `DetailSheet` view rails (Pattern 6) — keep.

### ⏸️ DEFERRED (per product owner) — leave exactly as-is

- **Book appointment** (`appointments/AppointmentsPage.tsx`) — appointments not
  yet used (Q16). No surface change.
- **Enter lab result** (`lab-orders/EnterLabResultDialog.tsx`) — lab results to
  be automated via API later (Q17). No surface change.
- **Report adverse event** — borderline; leave as a Dialog for now.
- Medium edit sheets (`PayerProfileEditSheet`, `ServiceDetail`) — optional
  `width="wide"` bump only; not a priority.

---

## 5. Patient record layout (Q13/Q14 decision)

Navigation between a patient's chart / schedule / bill is **sequential** in this
clinic (administer → then payment), so **no side-by-side patient panes are
needed**. Therefore:

- **Patient record = routed full page** (`/patients/:id`), not the list+detail
  split. Uses the full 27" width for the chart (next dose due up top, per §1).
- **Persistent patient switcher**: keep the global ⌘K command palette **and** a
  search box in the patient-page header to jump to another patient without
  going back to a list.
- **Create/edit** = full-page routes, same shell.
- The Patients **list** stays for browsing, but it's secondary — the operator
  mostly reaches a patient via **search** or from a **Scheduled Order**, not by
  scrolling a list.
- Keep `DirtyFormGuard` on the create/edit pages (forms shouldn't be abandoned —
  Q18).

---

## 6. Prioritised backlog

1. ✅ **P0 (done, this PR) — Codified** the form-surface rule in
   `apps/frontend/docs/PATTERNS.md` ("Form surface — overlay vs page"), the
   "single Branch operator, Dashboard home, 27"-only" context in
   `apps/frontend/CLAUDE.md` ("Clinic context"), and the solo-dev posture in the
   root `CLAUDE.md`.
2. ✅ **P1 (done 2026-06-01) — Patient record → full page + search switcher**
   (§5); **register/edit** moved onto full-page routes (`/patients/new`,
   `/patients/:id`, `/patients/:id/edit`). Resolves the 672px-sheet problem. The
   `<Sheet>` form was deleted outright; its third caller (the Arrivals wizard)
   was migrated to the `/patients/new?returnTo=arrivals` page route.
3. ✅ **P2 (done 2026-06-01) — Scheduled Orders polish** (the daily workhorse):
   "Due today" default, denser rows (one severity stripe, `py-1.5`), urgency-first,
   overdue/backfill as filters; **Administer** is keyboard-driveable (⌘↵ from the
   detail opens the dialog, ⌘↵ inside confirms) with a primary "Collect payment →"
   hand-off in the success state.
4. ✅ **P3 (done 2026-06-03) — Dashboard end-of-day**: the Dashboard KPI strip
   now shows **Cash today** + **Non-cash today** (Cash vs all other payment
   methods, excl. Voided/Refunded), backed by new `cashCollectedToday` /
   `nonCashCollectedToday` fields on `/api/dashboard`. The shift dropdown's
   **Print EOD report** navigates to `/day-summary?print=1` (auto-prints) and
   **Close drawer** opens the existing `DrawerCloseDialog` (gated on an open
   drawer). The **generated end-of-day report** is the `/day-summary` page given
   a clean A4 print stylesheet (app chrome + controls hidden) — no separate
   `/reports` build; the admin `/reports` stub stays for later broad analytics.
5. ✅ **P4 (done 2026-06-03) — Generalised dose-schedule viz** to any standing
   order: `PepScheduleTab` replaced by `StandingOrderTab` (shows standing-order
   status, not PEP-specific) on the patient record, backed by
   `useStandingOrderProgress`. Works for rabies PEP or any other scheduled-dose
   course. (`usePepProgress` / `PepProgress` kept as deprecated aliases.)
6. ✅ **P5 (done 2026-06-03) — Manual `EncounterForm` → full page**: now the route
   `/patients/:id/encounters/new` (`EncounterNewPage`); the PatientDetail "New
   encounter" action navigates instead of opening an overlay. `DirtyFormGuard`
   kept on the page.
7. **Later / not now:** richer bite-assessment input; appointments; lab-result
   API + surface; per-role UI; tablet/kiosk/mobile; offline; compliance exports.

---

## 7. Aesthetic & density guidance (Q30, web-search-backed)

Stock shadcn is the right call and aligns with 2026 clinical-UI guidance. Rules:

- **Reserve colour for clinical severity only.** Use the triage tokens
  (`overdue/due/ok/info`) strictly for status — never decorative. The #1
  documented failure mode in clinical UIs is **alert fatigue**: when everything
  is coloured/badged, clinicians stop seeing the one thing that matters. Keep the
  base calm/neutral; let a single "Due today"/overdue cue stand out.
- **Dense, scannable tables** (text-xs floor, tight rows, `tabular-nums`) for
  worklists — clinicians scan queues; density helps.
- **One severity signal per row** — the left **severity stripe** + at most one
  badge. Not a rainbow.
- **Surface the next action, not raw data** — worklists answer "what needs me
  now"; the dashboard should show next-step prompts (next dose due, unsettled
  txns, expiring lots), which it already does.
- **Reduce clicks** — keyboard-first commits, sensible defaults, no needless
  confirmations (reserve friction for the typed-reason gates on payments).

Sources: [Healthcare UX best practices 2026 — Fuselab](https://fuselabcreative.com/healthcare-ux-design-best-practices-guide/) ·
[EMR best practices 2026 — Emorphis](https://emorphis.health/blogs/emr-best-practices-in-2026/) ·
[Healthcare UI 2026 — Eleken](https://www.eleken.co/blog-posts/user-interface-design-for-healthcare-applications).

---

## 8. Out of scope / explicitly deferred

Kiosk / tablet / mobile / touch · offline queue · BIR OR formatting · per-role
landing pages & role-gated UI · appointments · lab-result entry surface (API
later) · compliance exports (BIR/DOH/PhilHealth/DPA) · native reporting beyond
the end-of-day report · any backend/API/schema change (this is presentation only,
except the noted location-binding + end-of-day-report features which need
backend support when scheduled).
