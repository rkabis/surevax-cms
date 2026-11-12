# 2026-05-17 — Preview walkthrough handover (post-audit verification)

## Source

This session shipped **19 PRs across 8 orchestrate waves** closing the
critical path of the 9-wave audit captured in
[`2026-05-17-ui-ux-audit.md`](2026-05-17-ui-ux-audit.md) (1789 lines,
59 PR-shape items).

Code shipped, typecheck + build green on every PR, sibling-commit leaks
caught and rebased clean. **What remains is in-browser verification** —
no one has yet driven the merged features through the preview MCP. This
handover sets up that walkthrough.

## Why a separate verification pass

Typecheck and build catch type and compile errors; CI runs prettier,
lint, and the seed-smoke. None of those exercise:

- Click handlers + URL state survival
- Modal lifecycle (open → submit → close → list refresh)
- Critical clinical paths (PEP intake → administer → settle)
- Browser quirks (HMR, react-router transitions, autofocus, useBlocker)
- Visual regressions in dialogs, dropdowns, tooltips

The audit was driven against the dev preview; the verification pass
should be too, so we're comparing against the same surface the audit
captured.

## Shipped this session (chronological)

| PR                                                           | Title                                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [#327](https://github.com/njvil/surevax-cms-revamp/pull/327) | useSearchParams filter state — Encounters, ScheduledOrders, LabOrders                    |
| [#328](https://github.com/njvil/surevax-cms-revamp/pull/328) | DirtyFormGuard + auth `?returnTo=`                                                       |
| [#329](https://github.com/njvil/surevax-cms-revamp/pull/329) | Cash-drawer poll gate + PATTERNS.md #25–28                                               |
| [#330](https://github.com/njvil/surevax-cms-revamp/pull/330) | Claim → txn linking + region cascade `<Combobox>`                                        |
| [#331](https://github.com/njvil/surevax-cms-revamp/pull/331) | WHO bite-category radio cards                                                            |
| [#332](https://github.com/njvil/surevax-cms-revamp/pull/332) | Lab-order Sent + Result transition endpoints (backend)                                   |
| [#333](https://github.com/njvil/surevax-cms-revamp/pull/333) | ICD-10 picker + bundled dataset                                                          |
| [#334](https://github.com/njvil/surevax-cms-revamp/pull/334) | Lab result-receipt frontend (dialogs + status-driven rail)                               |
| [#336](https://github.com/njvil/surevax-cms-revamp/pull/336) | Kiosk 4-digit PIN backend                                                                |
| [#337](https://github.com/njvil/surevax-cms-revamp/pull/337) | `<SortableHead>` primitive + `useTableSort`                                              |
| [#338](https://github.com/njvil/surevax-cms-revamp/pull/338) | Kiosk PIN frontend (keypad + admin reset/clear)                                          |
| [#339](https://github.com/njvil/surevax-cms-revamp/pull/339) | R2 presigned-PUT + real binary upload progress                                           |
| [#340](https://github.com/njvil/surevax-cms-revamp/pull/340) | Sortable columns full-stack sweep (5 modules + 5 pages)                                  |
| [#341](https://github.com/njvil/surevax-cms-revamp/pull/341) | Hotfix: 0015 supplemental-SQL + idempotency                                              |
| [#342](https://github.com/njvil/surevax-cms-revamp/pull/342) | UI paper-cuts: deterministic avatars + breadcrumb + Services width                       |
| [#343](https://github.com/njvil/surevax-cms-revamp/pull/343) | `<ComingSoonButton>` primitive + Pattern 30 + 9-file sweep                               |
| [#344](https://github.com/njvil/surevax-cms-revamp/pull/344) | Malformed `:id` → 400 backend sweep (12 modules)                                         |
| [#345](https://github.com/njvil/surevax-cms-revamp/pull/345) | Inline wrap-up — 4 paper-cuts (subtitle bug, qty fmt, ICD-10 conditions, dashboard menu) |

## How to run the walkthrough

```bash
# Bootstrap (worktree env)
PNPM=/opt/homebrew/opt/node@22/bin/pnpm
$PNPM setup            # idempotent — creates worktree-specific DB + .env
$PNPM dev              # backend + frontend, prints port
```

Login as **`admin@surevax.com / TestPass123!`** unless the surface
explicitly tests Branch role.

Open the preview MCP and navigate routes per the section below. After
each surface, capture a screenshot (`preview_screenshot`) and note
issues — same format as the original audit (`Per screen` and `Workflow`
sections in `2026-05-17-ui-ux-audit.md`).

## Walkthrough checklist (by PR)

Mirror the order of PRs — they're shipped chronologically, so issues in
earlier PRs may surface in later ones.

### 1. URL state survives back/forward (#327)

- [ ] `/encounters` — type `santos` in search → click another page →
      browser back. Search input is repopulated.
- [ ] `/scheduled-orders` — tap Today/Upcoming/Overdue tabs; URL
      updates (`?tab=…`); refresh re-applies; back/forward survives.
- [ ] `/lab-orders` — same shape with `?q=` + `?status=`.

### 2. DirtyFormGuard + auth returnTo (#328)

- [ ] `/arrivals/identify` — pick a patient, go to step 2, type a chief
      complaint, click `Dashboard` in the sidebar → AlertDialog
      "Unsaved changes" appears, Cancel keeps you on the page, Discard
      navigates away and clears wizard state.
- [ ] `/transactions/new` — half-fill cashier form, sidebar click →
      same prompt.
- [ ] Patient detail → Allergies `+ Add` → type allergen → sidebar
      click → prompt fires.
- [ ] Log out, attempt to load `/scheduled-orders?tab=overdue` —
      bounces to `/login?returnTo=...`. After login, lands on the
      original URL.
- [ ] Open-redirect guard: `/login?returnTo=//evil.com` — login lands
      on `/dashboard` (or role default), NOT the external host.

### 3. Cash-drawer poll gate (#329)

- [ ] Open browser devtools → Network. As SuperAdmin, no
      `/api/cash-drawer/current` 404s in the log. As Branch role,
      exactly one in-flight call per AppShell render.

### 4. Claim → transaction linking + region Combobox (#330)

- [ ] `/admin/claims` → `+ New Claim` → enter a real PAT-… id → the
      `Linked transaction` Select renders, shows that patient's
      transactions. Pick one → Total Billed prefills with `netAmount`.
- [ ] Patient register → Address section → Region Combobox supports
      typeahead, cascade clears descendants on parent change.

### 5. WHO bite-category radio cards (#331)

- [ ] `/arrivals/identify` → select a patient → step 2 → Bite
      Assessment panel renders three radio cards. Cat III's action
      line is `text-destructive`; Cat II is `text-triage-due`. Each
      card has `role="radio"` + `aria-checked` (inspect via DevTools).
      Clicking the same card unselects.

### 6. Lab-order Sent → ResultReceived (#332 + #334)

- [ ] `/lab-orders` → pick a `Pending` order → rail shows `Mark Sent`
      button. Click → AlertDialog confirms → status flips → toast.
- [ ] Pick a now-`Sent` order → rail shows `Enter Result` +
      `Upload Result PDF` buttons.
- [ ] Click `Enter Result` → Dialog opens with the observations
      `useFieldArray`. Add a row with `interpretation: Critical` →
      Save Result → status flips to `ResultReceived` AND the
      `acknowledge-critical` endpoint fires (verify in Network log).
- [ ] `ResultReceived` rail renders the observations table with the
      Badge-variant interpretation cells.

### 7. ICD-10 picker (#333 + #345)

- [ ] Encounter → Diagnoses tab → `+ Add diagnosis` → ICD-10 picker
      Combobox renders. Empty search shows first 20 codes. Typing
      `rabies` filters to A82.0-A82.9. Selecting auto-fills the
      Description.
- [ ] Patient → Conditions card → `+ Add` → same picker fires; on Add,
      the Condition name auto-fills from the picker's description if
      blank (editable).
- [ ] Patient → Allergies `+ Add` — still free text (per design;
      allergens use RxNorm/DAS, not ICD-10).

### 8. Kiosk PIN (#336 + #338)

- [ ] Log in as `admin@surevax.com`. `/admin/users` → open user
      detail → `Reset PIN` button → enter `1234` → Save → toast.
- [ ] Log out, log in as `branch-main@surevax.com / TestPass123!` →
      `/branch/kiosk` → tap a staff member's Clock In card →
      PinKeypadDialog opens. Type wrong PIN twice → error banner +
      refocus. Type `1234` (the PIN you set) → dialog closes, Clock In
      mutation fires, toast.
- [ ] `/admin/attendance` after the kiosk action — the time-log entry
      shows the actual staff user as the actor (not Branch service
      account).
- [ ] Lockout: 5 wrong PINs → 60s lockout copy; backend returns 429.

### 9. SortableHead + server-side sort (#337 + #340)

- [ ] `/patients` → click "Patient" column header → URL gets
      `?sort=last_name&order=asc`, list reorders. Click again → `desc`.
      Click third time → no sort param, list reverts to default.
- [ ] Same shape on `/transactions`, `/lab-orders`, `/encounters`,
      `/inventory`.
- [ ] Inspect `<th>` element: `aria-sort="ascending"|"descending"|"none"`.
- [ ] `/admin/audit` — sort params are in URL but result order is
      unaffected (backend not yet wired; this is the known limitation).

### 10. R2 binary upload + progress (#339)

- [ ] `/appointments` → open an appointment → `AttachmentDropzone` →
      drop a real PDF. Progress bar shows:
      `0→10%` hash, `10→15%` metadata POST, `15→20%` presigned URL
      fetch, `20→95%` binary PUT (real XHR upload progress),
      `95→100%` mark-uploaded.
- [ ] R2 env vars missing locally → 503 `STORAGE_NOT_CONFIGURED` toast
      surfaces clearly. Frontend recovers.
- [ ] Verify Content-Type matches between signed URL and the actual
      PUT (DevTools Network → PUT request headers).

### 11. UI paper-cuts (#342 + #343)

- [ ] `/patients` list — patient initial-avatars have distinct,
      deterministic colors per `patient.id`. Same patient renders the
      same color across renders.
- [ ] Sidebar — click "TODAY" group header → children collapse.
      Aria-expanded flips. Chevron rotates 180°.
- [ ] Login page — `Forgot password?` and `Sign in with Google` show
      outline buttons with `Soon` badge (not gray-disabled).
- [ ] Inventory — `Receive shipment` + `Reorder report` → ComingSoon
      visual.
- [ ] Standing Orders — `+ New protocol` → ComingSoon visual.
- [ ] Patient detail — `Edit` and `Print` → ComingSoon visual.

### 12. Malformed `:id` → 400 (#344)

```bash
TOKEN=$(curl -s -X POST http://localhost:<PORT>/api/auth/login \
  -H 'Content-Type: application/json' -H 'X-Requested-With: fetch' \
  -d '{"email":"admin@surevax.com","password":"TestPass123!"}' \
  | jq -r .accessToken)

# 400 INVALID_ID for malformed-shape
for ep in lab-orders encounters inventory attachments appointments adverse-events; do
  curl -s -o - -w '\nHTTP %{http_code}\n' \
    -H "Authorization: Bearer $TOKEN" \
    "http://localhost:<PORT>/api/${ep}/not-a-valid-id"
done

# 404 NOT_FOUND for valid-shape-but-missing
curl -s -o - -w '\nHTTP %{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:<PORT>/api/patients/PAT-AAAAAAAA00
```

Expected: 400 with `code: "INVALID_ID"` for malformed, 404 with
`code: "NOT_FOUND"` for valid-shape-but-missing.

### 13. Inline wrap-up paper-cuts (#345)

- [ ] `/transactions?date=2026-05-16` (a past date) — subtitle no
      longer shows `-1:--1`; the `into shift` segment is hidden;
      `N today` becomes `N on date`.
- [ ] `/encounters/<id>` → `Initiate protocol` → dose qty renders
      as a clean integer (or `1.5`-style decimal), not `1.0000`.
- [ ] Dashboard → Shift dropdown → `Print EOD report`, `Close drawer`,
      `End shift` show inline `Soon` badge; `aria-disabled="true"` on
      each `DropdownMenuItem`.

## Issue capture format

Use the same shape as the original audit — group findings by surface,
note severity (blocker / cosmetic / suggestion), reference the PR if
the issue is a regression vs. a pre-existing gap.

```
### Lab result-receipt (PR #332 + #334)

- **Bug**: Enter Result dialog won't submit when only one observation
  has a value and the others are blank. Zod requires .min(1) per row.
  Either drop empty rows on submit or allow empty rows.
- **Cosmetic**: Critical-interpretation badge is the same red as the
  destructive button; difficult to scan in the table.
- **Suggestion**: Pre-fill `code` with a recent LOINC for common
  panels (CBC, CMP).
```

## Out-of-MCP follow-up checklist

Items the preview MCP can't reach — document for a real-browser pass:

- Hover the dotted-underline acronyms (BIR, FEFO, PEP, ABTC, RIG,
  OSCA, PWD, SC/PWD) and verify tooltip copy in `acronym-hint.tsx`
- Drag-and-drop a real File > 50 MB onto the dropzone
- Trigger Web Bluetooth / WebUSB on Chrome with a paired thermal
  printer
- Print receipt on Safari (Bluetooth + USB unavailable; only
  Download + Standard print available)
- Refresh-token expiry mid-action — JavaScript can't clear
  HTTP-Only cookies; force via DevTools Application → Cookies.
- True two-tab interactions (one tab opens via `target="_blank"`,
  preview MCP blocks `window.open`).

## Coverage gaps still open

After this audit cycle, these remain unaudited / undelivered:

- **Cashier / Nurse / Physician role-walk** (only SuperAdmin + Branch
  driven so far)
- **Tagalog (`fil`) UI swap**
- **Mobile / tablet / dark-mode**
- **Schedule-dot click-through** on PatientDetail Active Encounter
  card (blocked on upstream dose-fetching)
- **Format-module consolidation** (`@/shared/lib/format` →
  `@/lib/format`, 32 callsites; overlapping behavior makes this
  risky for a sweep — needs dedicated review)

## Audit close-out

**18 of 19 PRs already merged**; PR #345 is the final inline wrap-up
(armed for auto-merge). Once it lands, **the critical path of the
2026-05-17 audit is closed**. Remaining work is browser-verification
(this handover), Tier-3 deferred items, and one risky-cleanup PR
(format consolidation).

## Recommended next moves

1. Schedule a single 30-60 min preview-MCP walkthrough session against
   the checklist above. Capture findings in the same format as the
   original audit.
2. File new PRs for any blockers surfaced.
3. Defer cosmetic findings to a "polish v2" wave once role-walks +
   mobile + dark-mode are also auditable.
