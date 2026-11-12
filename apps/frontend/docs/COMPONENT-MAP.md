# COMPONENT-MAP.md — clinical concept → shadcn primitive

When generating a feature, find the closest concept here and use the
listed primitive(s). If a concept is missing, add it.

| Clinical concept                | Primitive(s)                                                     | Variant / pattern                                                                   |
| ------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Patient identity card           | `Card` + `Avatar`                                                | Header has `eyebrow` "Patient" + name h1 + ID mono                                  |
| Worklist row                    | `TableRow` (or list `<li>`)                                      | `data-severity` + `stripe`                                                          |
| Triage status                   | `Badge`                                                          | variant: `overdue \| due \| ok \| info`                                             |
| Severity dot                    | `<span className="dot" data-severity=...>`                       | for compact lists / sidebars                                                        |
| Patient detail panel            | `Sheet` (side=right, w=420)                                      | Pattern #6                                                                          |
| Multi-dose protocol timeline    | Custom `<ol>` w/ `data-state="done\|current\|pending\|overdue"`  | Render with shadcn `Separator`                                                      |
| Day-0 intake wizard             | `Card` + `Button` + step rail (`<ol>`)                           | Pattern #5                                                                          |
| Atomic commit summary           | `Card` + numbered `<ol>` + primary `Button`                      | Pattern #3                                                                          |
| Cashier cart                    | `Table`                                                          | Right-side `Sheet` for tender                                                       |
| Payment method picker           | `Tabs` (segmented variant)                                       | List of methods                                                                     |
| Tender input                    | `Input` (large, `font-mono tabular-nums`, `inputMode="decimal"`) | Pair with computed `Change` field                                                   |
| Cash-quick add                  | `Button variant="outline" size="sm"`                             | "+₱500", "+₱1,000", "Exact"                                                         |
| Brand + lot picker (administer) | `BrandLotPicker` (`@/components/forms`)                          | Radiogroup of brands: house brand first, then earliest expiry; shows price + recall |
| Discount picker (Senior/PWD)    | `Button variant="outline" size="sm"`                             | Toggle, set `data-state="on"`                                                       |
| Filter (severity)               | `Tabs` segmented (counts inline)                                 | Pattern #2                                                                          |
| Free-text filter                | `Input` with leading search icon                                 | Slash key (`/`) shortcut                                                            |
| Bulk actions                    | inline `Button`s above the table                                 | Selected count via shadcn `Checkbox`                                                |
| Confirm dose / reverse payment  | `AlertDialog`                                                    | Title in 1 sentence, body explains side-effects                                     |
| Authorize physician             | `Combobox` + `Badge variant="outline"` for status                | "teleconsult" / "in-person"                                                         |
| Schedule preview                | `<DoseStrip>` from `@/components/clinical`                       | Labeled nodes (`md`), tooltip detail; Pattern #13                                   |
| Audit log                       | `Table` (compact) or `<ol>`                                      | Mono timestamps; one-line entries                                                   |
| Top KPIs                        | One `Card`, divided                                              | Pattern #10                                                                         |
| KPI cell                        | `<div>` inside KPI Card                                          | Three-layer: eyebrow + 2xl value (mono) + subtitle; Pattern #18                     |
| Page header                     | `<div className="flex justify-between">` + `<h1>` + `<p>`        | Subtitle carries live stats; actions right-aligned; Pattern #11                     |
| Roster row (dashboard)          | `TableRow` + `Avatar` + `Badge`                                  | Wait time, allergy badges, CTA button; Pattern #12                                  |
| PEP dose progress               | `<DoseStrip>` from `@/components/clinical`                       | Connected nodes, triage states; Pattern #13                                         |
| Receipt block                   | `<pre className="font-mono">` inside `Card`                      | Dashed border, monospace; Pattern #14                                               |
| Cold-chain unit card            | `Card` in 2×2 grid                                               | Fridge ID avatar, temp in mono, status badge; Pattern #15                           |
| Shift quick-actions menu        | `DropdownMenu` from page-head actions                            | Print EOD, Close drawer, End shift; Pattern #16                                     |
| Patient detail tab bar          | Horizontal `<button>` row with bottom border                     | 2px primary accent, inline counts; Pattern #17                                      |
| AppShell sidebar                | `<nav>` with group labels + session card                         | Light bg, inset-shadow active indicator; Pattern #19                                |
| Command palette (⌘K)            | `CommandDialog` + `CommandInput` + groups                        | Navigate, Admin, Actions groups; Pattern #7                                         |
| Sticky table column header      | `<TableHeader className="sticky top-0 bg-card z-10">`            | Pattern #20 — required on every list page                                           |
| Empty state (no rows)           | `<div>` + lucide icon + muted copy                               | h-8 w-8 muted/30 icon, mb-2; Pattern #21                                            |
| Sticky save footer (form)       | `<footer className="border-t bg-card">` sibling of scroll body   | Pattern #22 — for any one-page form > viewport                                      |
| Disabled stub CTA               | `<Tooltip>` over `<span tabIndex={0}>` over disabled `<Button>`  | Pattern #23 — "Coming soon" for unwired actions                                     |

## Standard imports cheat-sheet

```tsx
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
```

(`Combobox`, `Sonner`, and `Progress` are not yet installed.
Add via `pnpm dlx shadcn@latest add <name>` when you first need them.
`Table`, `Tabs`, `Alert`, `ScrollArea`, `Checkbox`, `DropdownMenu`,
`Select`, `Toast`, and `Tooltip` are already installed in
`src/components/ui/`.)

## Adding a new variant — example

`Badge` ships `default | secondary | destructive | outline` plus the
clinical extensions `overdue | due | ok | info`. To add a new variant
(say a brand-flavored `accent`), edit
[`src/components/ui/badge.tsx`](../src/components/ui/badge.tsx)
in place — don't fork the file:

```tsx
const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',
        overdue: 'border-triage-overdue/35 bg-triage-overdue-soft text-triage-overdue',
        due: 'border-triage-due/40 bg-triage-due-soft text-triage-due',
        ok: 'border-triage-ok/35 bg-triage-ok-soft text-triage-ok',
        info: 'border-triage-info/35 bg-triage-info-soft text-triage-info',
        // ─── add new variants here ───
      },
    },
    defaultVariants: { variant: 'default' },
  },
)
```

That's it. Now `<Badge variant="overdue">` works everywhere with no
additional setup.
