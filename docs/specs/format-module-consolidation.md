# Format Module Consolidation — Canonical-Semantics Spec

> **STATUS: DRAFT — needs design sign-off before codemod.** Today two
> overlapping format helpers exist (`@/lib/format` and
> `@/shared/lib/format`), and `apps/frontend/CLAUDE.md` + `.claude/rules/design-system.md`
> both call out "consolidation pending." A naive codemod silently
> regresses every list page and detail drawer because the two modules
> disagree on `formatDate` / `formatDateTime` / `formatMoney` semantics.
> This doc decides the canonical shape, then unblocks a codemod PR (or
> a series of per-feature codemod PRs) to land the consolidation.

---

## 1. Why this can't just be sed-and-rename

The two modules look interchangeable until you check the actual output:

| Helper                               | `@/lib/format`                                                  | `@/shared/lib/format`                                    |
| ------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------- |
| `formatDate`                         | **Relative**: `Today` / `Yesterday` / `3 days ago` for ≤14 days | **Locale**: always `May 24, 2026` (`en-PH` short date)   |
|                                      | then locale `MMM D, YYYY` for older                             |                                                          |
| `formatDateTime`                     | ISO-style `2026-05-24 15:45` (24h)                              | Locale `May 24, 2026, 03:45 PM` (12h)                    |
| `formatMoney`                        | `PHP 4,820.00` (with PHP prefix)                                | `4,820.00` (no prefix)                                   |
| `formatPhpAmount`                    | n/a                                                             | `PHP 4,820.00` (with prefix — same as new `formatMoney`) |
| `formatTime`                         | n/a                                                             | Locale `03:45 PM`                                        |
| `DASH` / `nullable` / `formatScalar` | n/a                                                             | present                                                  |

If we swap `import { formatDate } from '@/shared/lib/format'` → `from '@/lib/format'`:

- The Patients list cell "Last seen" reads `May 17, 2026` today → would read `7 days ago` after codemod. **Different UX intent.**
- The PayerProfile detail rail "Created" reads `May 17, 2026` today → would read `7 days ago` after codemod. **Different UX intent.**
- The AuditPage technical row reads `May 24, 2026, 03:45 PM` today → would read `2026-05-24 15:45` after codemod. **OK if we want ISO everywhere, regression if we don't.**

So consolidation can't be a one-line import codemod. It requires a per-surface decision: which date format goes where?

---

## 2. Canonical decision — recommendation

Adopt the following as the canonical semantics in `@/lib/format`. Move legacy callers to the right helper for their surface. Where the legacy helper's output differed, ADD a NEW canonical helper rather than collapsing the difference.

| Canonical helper                             | Output                                                                              | When to use                                                                                                                                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatDate(input)`                          | Relative for ≤14d (`Today` / `3 days ago`), locale `MMM D, YYYY` older, `—` if null | Default for **list cells + detail rails** where humans scan ages. Already canonical in `@/lib/format`.                                                                                      |
| `formatDateAbsolute(input)` _(NEW)_          | Always locale `MMM D, YYYY` (no relative)                                           | Where the surface needs the absolute calendar date — receipts, BIR records, signed audit fields, anywhere "3 days ago" reads wrong. Same output the legacy `formatDate` produced.           |
| `formatDateTime(input)`                      | ISO `2026-05-24 15:45` (24h, no seconds)                                            | Technical surfaces — audit log raw row, detail-rail "Created at" / "Updated at" metadata. Already canonical in `@/lib/format`.                                                              |
| `formatDateTimeReadable(input)` _(NEW)_      | Locale `May 24, 2026, 03:45 PM` (12h with month name)                               | Where the surface needs a human-readable timestamp, not technical — toast bodies, dialog descriptions, narrative copy. Same output the legacy `formatDateTime` produced.                    |
| `formatTime(input)`                          | Locale `03:45 PM` (12h)                                                             | Already exists in legacy module. Re-export from canonical. Used in branch banner "open since 09:42", appointment slot times.                                                                |
| `formatMoney(input)`                         | `PHP 4,820.00` with prefix                                                          | Default for **every currency display surface** — list cells, totals, receipts, dialog amounts. Already canonical in `@/lib/format`. Eliminates the legacy `formatPhpAmount` alias entirely. |
| `formatMoneyNumber(input)` _(NEW or RENAME)_ | `4,820.00` no prefix                                                                | The very few call sites that need a bare number — input pre-fills, label-stripped contexts, CSV exports. Most callers should use `formatMoney` instead. Audit each one.                     |
| `DASH = '—'`                                 | em-dash constant                                                                    | Re-export from canonical for the few places that compare against it. Prefer the helpers' built-in `—` fallback over manual `=== DASH` comparisons.                                          |
| `nullable(v, fb?)`                           | Returns `v` or `fb` if null/empty                                                   | Re-export from canonical. Niche helper — most surfaces should use the formatters directly which already null-coalesce.                                                                      |
| `formatScalar(v)`                            | Dispatches on type (ISO date → datetime, object → JSON.stringify, etc.)             | Used in detail-rail generic field rendering. Niche. Re-export from canonical.                                                                                                               |

**Two key principles:**

1. **Default toward the new (relative + ISO) semantics.** Most call sites are list cells + detail rails where relative dates + ISO timestamps read better.
2. **Surface-specific absolute helpers exist when needed.** Receipts, BIR fields, narrative copy get a dedicated helper instead of being asked to memorize "use the legacy one here."

---

## 3. Codemod plan (after sign-off)

### Phase A — canonical module additions

Add to `apps/frontend/src/lib/format.ts`:

```ts
export const DASH = '—'
export function nullable<T>(v: T | null | undefined, fb: string = DASH): T | string { ... }
export function formatTime(input: string | Date | null | undefined): string { ... }
export function formatDateAbsolute(input: string | Date | null | undefined): string { ... }
export function formatDateTimeReadable(input: string | Date | null | undefined): string { ... }
export function formatMoneyNumber(input: string | number | null | undefined): string { ... }
export function formatScalar(v: unknown): string { ... }
```

Keep the existing `formatDate`, `formatDateTime`, `formatMoney` — already canonical.

This is ~80 LoC of additive code. Lands as its own PR — no behavior change for any existing caller.

### Phase B — per-feature codemod (probably 4–6 small PRs)

For each feature directory in `apps/frontend/src/features/`:

1. Run the surface audit:
   ```bash
   grep -rn "from '@/shared/lib/format'" apps/frontend/src/features/<feature>/
   ```
2. For each call site, pick the canonical helper per Table 2:
   - List-cell date cell → keep using `formatDate` from `@/lib/format` (relative semantics)
   - Detail-rail "Created" / "Updated" → consider switching to `formatDateTime` (ISO)
   - Detail-rail "Date of birth" / "Issued at" / "Scheduled" → keep as `formatDateAbsolute` (legacy semantics, locale calendar date)
   - Receipt / BIR-audit / narrative → keep as `formatDateAbsolute` / `formatDateTimeReadable`
   - Money everywhere → `formatMoney` (with PHP prefix) — review whether any legacy `formatMoney` (no prefix) consumer needs `formatMoneyNumber` instead
3. Update imports + call sites in the same PR. Run `pnpm build` to confirm.
4. Visual check key surfaces (PatientList, TransactionsCreatePage, AuditPage detail rail, AcknowledgementReceipt) — load each, screenshot, eyeball the date/money cells.

Feature batches (rough — adjust per actual import counts):

- **patients + encounters** — densest date cells (DOB, vitals dates, encounter dates). ~40 sites.
- **transactions + receipts** — money + receipt absolute dates. ~25 sites.
- **scheduled-orders + clinical-orders + arrivals** — clinical timeline dates. ~30 sites.
- **lab-orders + adverse-events + bite-incidents** — date-of-event + result dates. ~25 sites.
- **inventory + inventory-transfers** — lot expiry dates (absolute), movement timestamps. ~20 sites.
- **admin/branch (audit, users, attendance, kiosk, drawer)** — mixed; audit page wants ISO, banner wants readable. ~30 sites.

### Phase C — delete the legacy module

After every consumer is migrated:

1. `grep -rn "from '@/shared/lib/format'" apps/frontend/src/` returns empty.
2. Delete `apps/frontend/src/shared/lib/format.ts`.
3. Update `.claude/rules/design-system.md` "Formatting + status humanizer utils" — drop the "two modules exist" warning. Add the canonical helper list.

This is a 5-line PR.

---

## 4. Risks

- **Visual regression risk on relative-date sites.** Every list page is reviewed visually after Phase B per feature. If `formatDate` was used for an "Issued at" detail field, switching to relative reads weirdly ("Issued 3 days ago" → not a date). Catch these per-feature.
- **Receipt regression risk.** `AcknowledgementReceipt` already uses `formatPhpAmount` from legacy. The codemod replaces with `formatMoney` from canonical — same output, no change. Same for `formatDateAbsolute` — same output as legacy `formatDate`. Low risk.
- **Localized output for non-PH tenants.** Both modules hardcode `'en-PH'`. Phase 2 onboarding playbook (`docs/runbooks/tenant-onboarding.md` §1) leaves this open. Out of scope here — when a non-PH tenant onboards, both modules need to consult the tenant's locale. Defer.

---

## 5. Effort estimate

| Phase     | Description                  | Effort                                                    |
| --------- | ---------------------------- | --------------------------------------------------------- |
| A         | Canonical module additions   | ~1 hour                                                   |
| B (×6)    | Per-feature codemod + visual | ~3-4 hours total (split across orchestrate or 2 sessions) |
| C         | Legacy module deletion       | ~15 minutes                                               |
| Visual QA | Browser walk all key pages   | ~1 hour                                                   |

Total: ~6 hours. Split across 2 sessions cleanly.

---

## 6. Open questions for the design call

1. Is the "relative under 14 days, absolute older" cutoff right? Some surfaces (e.g. audit log) might want absolute always; others (kiosk staff list "last seen") might want extended relative ("3 weeks ago").
2. Should `formatMoney` always carry `PHP` prefix, or should we add a `currencyCode` argument for the future when we accept multi-currency (USD pricing for international clinics)? Probably keep monomorphic for now and add `formatCurrency(amount, code)` if/when multi-currency lands. Out of scope.
3. Receipt: today `AcknowledgementReceipt.tsx` already uses `formatPhpAmount`. After the codemod, it'll use `formatMoney` from `@/lib/format`. BIR ops sign-off may dictate a specific format (`PHP4,820.00` no space? `₱4,820.00` with peso symbol?) — keep the codemod's output identical to today's, then iterate when BIR rebuild lands.
4. Naming bikeshed: `formatDateAbsolute` vs `formatDateLocale` vs `formatCalendarDate`. Pick whatever reads least like the existing helpers to reduce confusion. Current proposal: `formatDateAbsolute`.

---

## 7. Acceptance gate

Sign-off needed on:

- Canonical-helper table in §2 — names, semantics, when-to-use
- The 6-batch split in Phase B — fine to merge / re-split during execution
- The "delete legacy module" terminal state — confirmed once Phase B completes

Once signed off, the codemod is mechanical. Until signed off, it's deferred for the same reason it's been deferred since the design-system doc was written: the two outputs differ and silent regression is real.

---

## Related docs

- [`.claude/rules/design-system.md`](../../.claude/rules/design-system.md) — "Formatting + status humanizer utils" section
- [`apps/frontend/CLAUDE.md`](../../apps/frontend/CLAUDE.md) — "Numbers, IDs, money" + `tabular-nums` conventions
- [`TODO.md`](../../TODO.md) Wave 4 section — historical record
