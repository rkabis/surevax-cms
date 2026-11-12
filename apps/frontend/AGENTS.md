# AGENTS.md - SureVax Frontend

Follow the repo root `AGENTS.md` first. This file covers UI-specific rules for
`apps/frontend`.

## UI primitives

Use shadcn/ui and the local layout primitives before hand-rolled markup:

- Page heads: `PageHeader`
- Filter/search rows: `PageToolbar`
- Tables: `TableCard` plus shadcn `Table`
- KPI rows: `KpiStrip` and `KpiCell`
- Empty list states: `ListEmpty`
- Right-side record detail: `DetailSheet`
- Buttons, badges, dialogs, sheets, forms, inputs, selects, tabs, tooltips:
  use the existing shadcn components in `src/components/ui`

Extend existing primitives when a new variant is genuinely needed. Do not
create one-off button, badge, card, or sheet clones.

## Visual system

- Use token classes from `src/index.css`; do not use raw hex or oklch colors in
  components.
- Do not use arbitrary text-size classes like `text-[13px]`; use the configured
  text tokens.
- Use `font-mono tabular-nums` for IDs, dates, times, money, doses, and dense
  numeric table cells.
- Avoid decorative gradients, heavy shadows, emojis, and color-word UI copy.
- Actionable clinical rows use severity stripes and semantic badge variants:
  `overdue`, `due`, `ok`, `info`.

## Workflow patterns

- Worklists should answer "what needs attention now?" before generic CRUD.
- Record detail belongs in `DetailSheet`, not a modal.
- Multi-write actions should show commit effects before the final action.
- Long forms need a sticky save footer.
- Intentionally disabled CTAs should use the existing `ComingSoonButton` or the
  tooltip-over-disabled-button pattern.

## Canonical references

Before building or changing a screen, compare against similar existing screens:

- `src/features/scheduled-orders/ScheduledOrdersPage.tsx` for worklists
- `src/features/arrivals/ArrivalsPage.tsx` for wizard flows
- `src/features/transactions/TransactionsCreatePage.tsx` for cashier flows

Also consult `apps/frontend/docs/PATTERNS.md` and
`apps/frontend/docs/COMPONENT-MAP.md` when the expected primitive or layout is
unclear.

## Frontend checks

Run these for UI changes:

```bash
pnpm --filter @surevax/frontend typecheck
pnpm --filter @surevax/frontend build
bash scripts/check-tailwind-tokens.sh
bash scripts/check-design-system.sh
```
