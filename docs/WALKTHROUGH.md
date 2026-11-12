# SureVax CMS — Seed Data Walkthrough

A guided tour of the demo data so you can exercise every major workflow without
hunting for which record does what. All dates are **relative to the day the seed
was run** (`daysAgo` / `today` / `daysFromNow` helpers), so "today", "this week",
and "next week" below stay accurate on a fresh reseed. The clinic operates in
the Philippines (UTC+8) — "today" follows the browser's local date.

> Reseed any time with:
> `DATABASE_URL="<public-url>" pnpm --filter @surevax/backend db:seed`
> (idempotent — safe to re-run; drop + migrate first for a clean slate).

---

## 0. Sign in

| Role              | Email                     | Password       | Entry point                          |
| ----------------- | ------------------------- | -------------- | ------------------------------------ |
| Tenant Admin      | `admin@surevax.com`       | `TestPass123!` | `/login` — sees everything           |
| Platform Operator | `platform@surevax.com`    | `TestPass123!` | `/operator/login` — cross-tenant ops |
| Branch Account    | `branch-main@surevax.com` | `TestPass123!` | kiosk service account                |

All seeded staff share kiosk PIN **`1234`** (clock-in/out kiosk).
Tenant: **SVX** · 11 branches (HST = Holy Spirit is the default/home branch).

Sign in as the **Tenant Admin** for the full tour — they belong to all 11
branches, so cross-branch surfaces (transfers, branch pickers) are populated.

---

## 1. Dashboard

Lands on today's clinic snapshot — revenue, encounters, pending doses, low-stock
alerts. The KPI strip and "due today" widgets are driven by the relative-dated
data below. Best viewed at **2560×1440** (the clinics' primary screen).

---

## 2. Appointments — the scheduling board _(17 appointments)_

The headline "current + next week" surface. Open **Appointments**:

- **Today (4):** Dela Cruz `CheckedIn` (Rabies PEP Day 0), Torres `InProgress`
  (PEP Day 0 + ERIG), Lim `Completed` (flu + BP), Garcia `Scheduled` (new
  exposure assessment).
- **Tomorrow (2):** Reyes `Confirmed` (PEP Day 3), Mendoza `Scheduled` (asthma
  follow-up).
- **Next 3–10 days (8):** Cruz / Aguilar / Luna PEP follow-ups, Herrera wound
  procedure, Javier lab draw, Navarro & Bautista vaccinations, Ocampo geriatric
  review — covers `Scheduled` and `Confirmed`.
- **History (3):** Santos `Completed`, Fernandez `NoShow`, Gonzales `Cancelled`.

Things to try: filter by status, open the detail rail, reschedule a `Scheduled`
appointment (the provider double-booking guard rejects overlapping slots for the
same physician), cancel one (requires a reason).

---

## 3. Patients _(20 patients)_

Open **Patients**. Each row is a full chart. Notable records:

- **Maria Dela Cruz** (`PAT_AAAAAAA1`, dog bite Cat III) — active rabies PEP,
  emergency contact, bite incident, today's appointment.
- **Grace Lim** (`PAT_AAAAAAA3`) — Intellicare HMO, Penicillin allergy,
  Hypertension; flu encounter completed today + an AEFI report.
- **Lourdes Bautista / Nena Gonzales / Leonardo Ocampo** — seniors with
  `senior-citizen` + `SC-discount` tags (exercise BIR SC/PWD discounting).
- **Rowena Ilagan** — `PWD` tagged. **Kristine Katipunan** (age 15) —
  `pediatric` + `guardian-required`, guardian on file.
- **Elena Cruz / Carlo Fernandez** — no contact number (guardian-only), good for
  testing missing-contact handling.

Detail rail shows normalized **allergies**, **conditions**, **tags**,
**emergency contacts** (7 patients have next-of-kin on file), and **onboarding
channel** (Walk-in / Referral / Vaccination drive / Social media / Returning).

---

## 4. Encounters _(15 — clinical visits)_

Open **Encounters**. Status spread reflects a live day:

- **InProgress today:** Dela Cruz, Torres (rabies intakes happening now).
- **Completed today:** Lim (flu), Santos (tetanus), Mendoza (general check-up).
- **In-progress past / completed past:** Villanueva, Cruz, Aguilar, Luna,
  Herrera, Reyes, Katipunan, Navarro, Ocampo.

Every encounter now carries **vitals** (temp, HR, BP, SpO₂, weight/height/BMI,
pain score) and an **ICD-10 diagnosis** — rabies visits show `Z20.3` (rabies
exposure) + `W54.0` (dog bite); vaccinations show `Z23`; the general visit shows
`Z00.00`. Open the detail rail to see the full vitals + diagnosis block.

---

## 5. Scheduled / Clinical Orders — the dose pipeline _(51 clinical orders)_

Open **Scheduled Orders**. The rabies PEP regimens (Days 0/3/7/14/28) are dated
off each patient's start date, so **16 doses fall due today through next week**.

- Dose 1 is `Completed` for visits that started today or are past-in-progress.
- Remaining doses are `Pending` (overdue / due-today / upcoming) or `Scheduled`
  (Garcia's `Open` encounter).
- Look for **Reyes Day 3 (tomorrow)**, **Cruz Day 7**, **Aguilar Day 14**,
  **Luna Day 28** — these line up with the matching appointments in §2.

Try the **Administer** flow on a due dose: pick the brand (the house brand is
preselected, alternatives are one click away) and it decrements
inventory, gated by an active consent check.

---

## 6. Bite Incidents + animal observation _(9 incidents, 9 follow-ups)_

Open **Bite Incidents**. The rabies-clinic intake artefact — species, WHO/DOH
exposure category (II/III), bite site, animal vaccination status.

The 14-day **animal observation** follow-ups are the current-relevant piece:

- **Villanueva** — observation **due today** (`Pending`).
- **Luna** — due **this week**.
- **Aguilar / Cruz / Reyes** — due **next week**.
- **Herrera** — `Completed`, outcome **AliveHealthy** → demonstrates the
  "Day-28 dose may be omitted" path.

Filter follow-ups by `Pending` to see the nurse's observation worklist.

---

## 7. Transactions & payments _(16 transactions, 13 payments)_

Open **Transactions**. Status coverage:

- **Paid** (majority) — with receipt numbers and `branch_seq`.
- **Pending** — partially settled / awaiting payment (AR balance shows).
- **Draft** — not yet finalized.
- **Voided** — excluded from revenue/AR aggregates (verify the dashboard totals
  ignore it).

Open a Paid transaction to see line items, payments, the acknowledgement
receipt, and per-physician attribution (`performed_by_id`). Senior/PWD patients
exercise the BIR VAT-strip discount math.

---

## 8. Inventory + transfers

**Inventory** _(10 lots)_ — covers the full stock lifecycle:

- Healthy stock (Abhayrab VRB-2026-003: 38 on hand; flu, TT, ERIG, HRIG lots).
- **Near-expiry / quarantined:** VRB-2025-099 and the expired FLU-2026-010
  (quarantined, awaiting disposal) — these also drive the active **product
  recall** (FLU-2026-\*).
- Lots are listed earliest-expiry-first; low/zero-stock lots surface in dashboard alerts.

**Inventory Transfers** _(4)_ — inter-branch movement from the HST hub:

- HST → Timog: `PendingReceipt` (shows on Timog's incoming list).
- HST → Pasig: `PendingReceipt` (ERIG for an incoming case).
- HST → Taguig: `Received` (closed).
- HST → Baclaran: `Cancelled` (with reason).

---

## 9. Adverse Events (AEFI) _(4 reports)_

Open **Adverse Events**. Each links the implicated vaccine/dose + encounter:

- **Lim** (flu) — `Mild`, Recovered.
- **Santos** (tetanus) — `Moderate`, Recovering.
- **Reyes** (rabies) — `Mild`, Recovered (vasovagal).
- **Navarro** (flu) — `Severe`, Recovering — **escalated to the FDA**
  (`authority_reference_number` populated, `reportedToAuthorityAt` set).

---

## 10. Notifications _(7)_

Open **Notifications** (or the bell). The outbound SMS/Email log + reminder
queue:

- **Queued** — Reyes PEP Day-3 reminder scheduled for tomorrow morning.
- **Sent / delivered** — Luna dose-due, Villanueva observation-due-today, Lim
  email receipt (read), Dela Cruz registration (read).
- **Failed** — Torres SMS (carrier rejected, 2 retries) — the failure path.

---

## 11. Lab Orders _(5)_

Open **Lab Orders** — diagnostic orders routed to partner labs (Hi-Precision,
St. Luke's, RITM), tied to clinical orders, with mixed statuses.

---

## 12. Shifts, day summary, kiosk

- **Shifts / Attendance** _(20 time logs)_ — a full week of clock-in/out across
  admin, physician, nurses, cashier; today's shifts are still active (no
  clock-out).
- **Day Summary** — end-of-day reconciliation (cash drawer, revenue), clinic-wide
  (day-scoped session model, shared across nurses).
- Clock in/out at the **kiosk** with any staff PIN `1234`.

---

## 13. Admin surfaces

Under **Admin** (TenantAdmin only):

- **Users** — 7 staff across roles (TenantAdmin / Physician / Nurse×2 / Cashier /
  Branch service account).
- **Branches** — 11 branches; switch the branch picker to see branch-scoped data.
- **Product Recalls** — 1 active recall on the FLU-2026 lots.
- **Approvals** — 1 pending approval request.
- **Notification Templates** — 3 message blueprints.
- **Cross-branch access** — break-glass grant review (empty until a clinical user
  reveals an out-of-branch chart).

---

## Quick reference — what each patient demonstrates

| Patient                  | Display ID          | Demonstrates                                          |
| ------------------------ | ------------------- | ----------------------------------------------------- |
| Maria Dela Cruz          | `PAT_AAAAAAA1`      | Rabies PEP Day 0 today · bite incident · appointment  |
| Miguel Torres            | `PAT_AAAAAAA2`      | PEP + ERIG · failed SMS · cat bite Cat III            |
| Grace Lim                | `PAT_AAAAAAA3`      | HMO · allergy · flu AEFI · email receipt              |
| Villanueva               | `PAT_AAAAAAA4`      | Animal observation **due today**                      |
| Elena Cruz               | `PAT_AAAAAAA5`      | PEP Day 7 next week · no contact number               |
| Juan Santos              | `PAT_AAAAAAA6`      | Tetanus booster · moderate AEFI                       |
| Ana Reyes                | `PAT_AAAAAAA7`      | PEP Day 3 tomorrow · queued reminder · AEFI           |
| Pedro Garcia             | `PAT_AAAAAAA8`      | `Open` encounter — all doses `Scheduled`              |
| Aguilar / Luna           | `PAT_AAAAAAB0`/`B8` | PEP follow-ups due this/next week                     |
| Bautista/Gonzales/Ocampo | senior              | SC discount · emergency contacts · recall demographic |
| Katipunan                | `PAT_AAAAAAB7`      | Pediatric · guardian required                         |
| Herrera                  | `PAT_AAAAAAB4`      | Completed observation (AliveHealthy)                  |

---

_Seed source: `apps/backend/src/shared/db/seed/` (one file per domain, wired in
`apps/backend/src/shared/db/seed.ts`). Add data by extending the relevant
sub-seed — keep date math relative via the `helpers.ts` date helpers so the
walkthrough stays accurate._
