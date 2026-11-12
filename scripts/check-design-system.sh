#!/usr/bin/env bash
# scripts/check-design-system.sh — design-system primitive enforcement
#
# Blocks hand-rolled markup that should go through the canonical
# primitives in apps/frontend/src/components/layout/. The audit
# (2026-05-16) found 22 hand-rolled detail rails, 22 inline page
# heads, 22 inline KPI strips, etc. The primitives shipped in PRs
# #290-297; this script keeps drift from re-introducing them.
#
# Each rule has:
#   - a forbidden pattern (regex)
#   - the file(s) allowed to use it (the primitive itself)
#   - a fix message pointing to the canonical primitive
#
# Exit codes: 0 = clean, 1 = violations found.
#
# Companion to scripts/check-tailwind-tokens.sh — that script polices
# Tailwind tokens, this one polices component primitives.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 - "$ROOT" <<'PYEOF'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
target = root / 'apps' / 'frontend' / 'src'

if not target.is_dir():
    print(f"check-design-system: {target} not found — nothing to check", file=sys.stderr)
    sys.exit(0)


# Each rule is (name, pattern, allowlist-relative-paths, fix-message).
# `pattern` is a compiled regex matched against file contents (DOTALL),
# OR a string key naming a special-cased programmatic check.
# `allowlist` is a set of paths (relative to repo root) where the
# pattern is permitted — typically the primitive that *defines* the
# canonical markup.


def find_card_content_p0_with_table(text: str):
    """Yield (start, snippet) for every `<CardContent className="p-0">`
    whose body contains a `<Table>` or `<table>` element. The regex
    `<CardContent p-0>...<Table>` fails when JSX conditionals
    (loading/error/empty) sit between the opener and the table — this
    walks character-by-character to find the matching closer."""
    open_re = re.compile(r'<CardContent\s+className="p-0[^"]*">')
    for m in open_re.finditer(text):
        # Find the matching </CardContent> by tracking nested CardContent.
        depth = 1
        i = m.end()
        n = len(text)
        while i < n and depth > 0:
            next_open = text.find('<CardContent', i)
            next_close = text.find('</CardContent>', i)
            if next_close == -1:
                break
            if next_open != -1 and next_open < next_close:
                depth += 1
                i = next_open + len('<CardContent')
            else:
                depth -= 1
                i = next_close + len('</CardContent>')
        body = text[m.end() : i]
        if '<Table' in body or '<table' in body:
            yield m.start(), m.group(0)


def find_card_like_div_with_table(text: str):
    """Yield (start, snippet) for every `<div>` whose className mimics a
    Card visual (`rounded-(md|lg|xl)` + `border` + `overflow-hidden`,
    or `bg-card` + rounded) AND whose body contains a `<Table>` or
    `<table>`. These are TableCard impostors — divs that look like a
    rounded card around a table but bypass the primitive.

    Walks to the matching `</div>` so the rule fires even when filter
    tabs / headers / etc. sit between the wrapper and the table."""
    open_re = re.compile(
        r'<div\s+className="[^"]*"\s*>',
    )
    classname_re = re.compile(r'<div\s+className="([^"]+)"')
    for m in open_re.finditer(text):
        cls = classname_re.match(text, m.start())
        if not cls:
            continue
        classes = cls.group(1)
        # Must combine "rounded-{md|lg|xl}" with "overflow-hidden" AND
        # either "border" or "bg-card" — the canonical TableCard look.
        if not re.search(r'\brounded-(?:md|lg|xl)\b', classes):
            continue
        if 'overflow-hidden' not in classes:
            continue
        if not (re.search(r'\bborder\b', classes) or 'bg-card' in classes):
            continue
        # Walk to matching </div>
        depth = 1
        i = m.end()
        n = len(text)
        while i < n and depth > 0:
            next_open = text.find('<div', i)
            next_close = text.find('</div>', i)
            if next_close == -1:
                break
            if next_open != -1 and next_open < next_close:
                depth += 1
                i = next_open + 4
            else:
                depth -= 1
                i = next_close + 6
        body = text[m.end() : i]
        if '<Table' in body or '<table' in body:
            yield m.start(), m.group(0)


RULES = [
    {
        'name': 'detail-sheet',
        # Multi-line: <SheetContent ... side="right" ...> in any form.
        # Detect both `side="right"` on the same line as `<SheetContent`
        # and on a separate attribute line.
        'pattern': re.compile(
            r'<SheetContent\b[^>]*\bside="right"',
            re.DOTALL,
        ),
        'allowlist': {
            'apps/frontend/src/components/layout/DetailSheet.tsx',
            # AppShell uses Sheet side="left" for mobile nav, never matched
            # by this pattern — but listing it for clarity.
        },
        'fix': (
            'Use <DetailSheet> from @/components/layout instead of\n'
            '  hand-rolled <SheetContent side="right"...>. Three width\n'
            '  presets: narrow / standard / wide. See PATTERNS.md Pattern 6.'
        ),
    },
    {
        'name': 'table-card-card-pattern',
        # `<CardContent className="p-0">` wrapping a `<Table>` or `<table>`
        # anywhere inside its body — handled programmatically (see
        # find_card_content_p0_with_table) because JSX conditionals
        # between the opener and the table break regex matching.
        #
        # The 2026-05-16 audit caught the direct `<Card><CardContent
        # p-0><Table>` shape but missed the four variants where loading
        # skeletons / error blocks / empty states sat between the
        # CardContent and the Table: TransactionsPage, PatientDetail,
        # TransactionsCreatePage, InventoryPage.
        'pattern': 'card-content-p0-with-table',
        'allowlist': {
            # TransactionsCreatePage is a cashier flow with stacked Cards
            # whose visual rhythm depends on the Card frames around each
            # section. Removing one Card breaks the alignment with the
            # patient-search Card above. Already exempted from the
            # page-header-h1 rule for the same reason (custom cashier
            # layout). Intentional override.
            'apps/frontend/src/features/transactions/TransactionsCreatePage.tsx',
        },
        'fix': (
            'Use <TableCard> from @/components/layout instead of\n'
            '  <Card>…<CardContent className="p-0">…<Table>. Lift any\n'
            '  CardHeader title to a sibling <div> above the TableCard;\n'
            '  loading/error/empty states render inline before it.\n'
            '  See PATTERNS.md Pattern 25.'
        ),
    },
    {
        'name': 'table-card-div-pattern',
        # `<div>` whose className mimics a Card visual (rounded +
        # overflow-hidden + border or bg-card) wrapping a `<Table>` or
        # `<table>` anywhere in its body. Handled programmatically (see
        # find_card_like_div_with_table) so it fires even when filter
        # tabs / headers / loading states sit between the wrapper and
        # the table.
        #
        # The original 2026-05-16 rule used a strict regex requiring the
        # table to follow the div immediately — three offenders slipped
        # past (PatientList, ClaimDetail, StandingOrdersPage).
        'pattern': 'card-like-div-with-table',
        'allowlist': {
            # StandingOrdersPage uses the rounded-card div as a
            # "tabs + table" composite container — the filter Tabs
            # sit inside the card border as a header, then the table
            # below. Migrating to TableCard would split tabs above
            # (PageToolbar) and table below (TableCard), losing the
            # visual association between tabs and table. The page is
            # rendered inside a ScrollArea so a top-level PageToolbar
            # doesn't fit the layout. Intentional override pending a
            # future refactor.
            'apps/frontend/src/features/standing-orders/StandingOrdersPage.tsx',
        },
        'fix': (
            'Use <TableCard> from @/components/layout instead of a\n'
            '  hand-rolled <div className="...rounded-... border\n'
            '  overflow-hidden..."> around a table. The visual treatment\n'
            '  is identical and consistent across the app.\n'
            '  See PATTERNS.md Pattern 25.'
        ),
    },
    {
        'name': 'list-empty-icon',
        # The Pattern 21 empty-state icon classes outside ListEmpty.tsx.
        # Multi-line check: icon classes appearing alongside a sibling
        # `<p className="text-sm text-muted-foreground">No ...` line.
        'pattern': re.compile(
            r'<[A-Z]\w+\s+className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2"[^>]*/>',
        ),
        'allowlist': {
            'apps/frontend/src/components/layout/ListEmpty.tsx',
            # EmptyState component (different surface, uses different markup)
            'apps/frontend/src/components/ui/empty-state.tsx',
            # attachment-list shares the ui/ namespace; can't cross boundaries
            'apps/frontend/src/components/ui/attachment-list.tsx',
            # AdverseEventsPage renders empty inside TableRow > TableCell
            # (Pattern 21 anti-pattern). Restructuring the table conditional
            # is out of scope — leave as documented exception.
            'apps/frontend/src/features/adverse-events/AdverseEventsPage.tsx',
            # TransactionsPage empty state has an interactive sub-hint
            # ("Search all dates" button) that ListEmpty can't host.
            'apps/frontend/src/features/transactions/TransactionsPage.tsx',
            # DaySummaryPage has a local EmptyState helper with py-8 density
            # (5 callers across day-summary sections). Intentional override.
            'apps/frontend/src/features/day-summary/DaySummaryPage.tsx',
        },
        'fix': (
            'Use <ListEmpty icon={Icon} message="..."/> from\n'
            '  @/components/layout instead of hand-rolling the\n'
            '  `h-8 w-8 text-muted-foreground/30 mx-auto mb-2` icon block.\n'
            '  See PATTERNS.md Pattern 21.'
        ),
    },
    {
        'name': 'page-header-h1',
        # A hand-rolled Pattern 11 page title — should only appear inside
        # PageHeader.tsx. Matches text-lg AND text-xl: the primitive moved to
        # `text-xl 2xl:text-2xl`, and while the regex still only knew about
        # `text-lg` it silently stopped catching new drift (found 2026-07-25 —
        # components/ComingSoon.tsx had shipped a bare `text-xl font-semibold`
        # h1 as the head for /reports, /settings and /cold-chain).
        'pattern': re.compile(
            r'<h1\s+className="text-(?:lg|xl)\s+(?:2xl:text-(?:xl|2xl)\s+)?font-semibold[^"]*"',
        ),
        'allowlist': {
            'apps/frontend/src/components/layout/PageHeader.tsx',
            # ComingSoon renders the page head for the three not-yet-built
            # routes; it is a page-head surface of its own, not list-page drift.
            'apps/frontend/src/components/ComingSoon.tsx',
            # PatientList is a dense list-and-detail component, not a
            # standalone page. Uses tighter button sizing than PageHeader
            # provides (h-7 px-2). Intentional override.
            'apps/frontend/src/features/patients/components/PatientList.tsx',
            # TransactionsCreatePage's h1 wraps a dynamic patient name in
            # the cashier flow — different shape than a list page head.
            'apps/frontend/src/features/transactions/TransactionsCreatePage.tsx',
            # BiteAssessmentDemo is a demo surface, not a routed page.
            'apps/frontend/src/features/encounters/components/BiteAssessmentDemo.tsx',
            # VitalsDemoPage is DEV-only (stripped from the prod route tree)
            # and already carries an inline eslint-disable for the same h1.
            # Surfaced by widening this regex to text-xl on 2026-07-25.
            'apps/frontend/src/features/encounters/VitalsDemoPage.tsx',
        },
        'fix': (
            'Use <PageHeader title="..."/> from @/components/layout\n'
            '  instead of hand-rolling <h1 className="text-lg font-semibold">.\n'
            '  See PATTERNS.md Pattern 11.'
        ),
    },
    {
        'name': 'sticky-table-header-bg',
        # Canonical sticky table header uses `bg-card` per PATTERNS.md Pattern 20
        # and apps/frontend/CLAUDE.md "Sticky table headers". Flag any <thead>
        # or <TableHeader> that combines `sticky` with `bg-muted` (in either
        # order). The 2026-05-16 audit found two competing patterns:
        # `bg-muted/40 text-xs uppercase` (5 admin pages) and `bg-muted/50`
        # (3 ops pages); both collapsed to `bg-card`.
        'pattern': re.compile(
            r'<(?:thead|TableHeader)\b[^>]*?\bclassName="(?=[^"]*sticky)(?=[^"]*bg-muted)[^"]*"',
        ),
        'allowlist': set(),
        'fix': (
            'Sticky table headers must use `bg-card z-10`, not\n'
            '  `bg-muted/40` or `bg-muted/50`. Canonical:\n'
            '    <thead className="sticky top-0 bg-card z-10">\n'
            '  See PATTERNS.md Pattern 20 and apps/frontend/CLAUDE.md\n'
            '  "Sticky table headers".'
        ),
    },
    {
        'name': 'page-toolbar-pattern',
        # The canonical PageToolbar wrapper — `px-4 sm:px-6 xl:px-8 2xl:px-10
        # py-3 border-b border-border flex items-center gap-3` — should only
        # appear inside PageToolbar.tsx. The `2xl:px-10` step is optional in
        # the regex so pre-ladder hand-rolls are still caught.
        'pattern': re.compile(
            r'<div\s+className="px-4\s+sm:px-6\s+xl:px-8\s+(?:2xl:px-10\s+)?py-3\s+border-b\s+border-border\s+flex\s+items-center',
        ),
        'allowlist': {
            'apps/frontend/src/components/layout/PageToolbar.tsx',
        },
        'fix': (
            'Use <PageToolbar> from @/components/layout instead of\n'
            '  hand-rolling `<div className="px-4 sm:px-6 xl:px-8 py-3\n'
            '  border-b border-border flex items-center ...">`.\n'
            '  See PATTERNS.md Pattern 25.'
        ),
    },
]


def line_of(text: str, offset: int) -> int:
    return text.count('\n', 0, offset) + 1


violations: list[tuple[str, str, int, str]] = []  # (rule_name, path, line, snippet)

for path in target.rglob('*'):
    if path.suffix not in {'.tsx', '.ts'}:
        continue
    rel = str(path.relative_to(root))
    text = path.read_text()
    for rule in RULES:
        if rel in rule['allowlist']:
            continue
        pattern = rule['pattern']
        if pattern == 'card-content-p0-with-table':
            matches = list(find_card_content_p0_with_table(text))
        elif pattern == 'card-like-div-with-table':
            matches = list(find_card_like_div_with_table(text))
        else:
            matches = [(m.start(), m.group(0)) for m in pattern.finditer(text)]
        for start, snippet in matches:
            # Trim multi-line snippet to first line for readability
            first_line = snippet.split('\n', 1)[0]
            if len(first_line) > 120:
                first_line = first_line[:117] + '…'
            violations.append((rule['name'], rel, line_of(text, start), first_line))

if not violations:
    print(
        f"check-design-system: clean (0 primitive violations in {target.relative_to(root)})"
    )
    sys.exit(0)

# Group violations by rule for a readable report
from collections import defaultdict
grouped: dict[str, list[tuple[str, int, str]]] = defaultdict(list)
for name, path, line, snippet in violations:
    grouped[name].append((path, line, snippet))

rules_by_name = {r['name']: r for r in RULES}

print(f"check-design-system: {len(violations)} primitive violation(s):\n", file=sys.stderr)
for name, items in grouped.items():
    rule = rules_by_name[name]
    print(f"  ── {name} ── {len(items)} occurrence(s)", file=sys.stderr)
    for path, line, snippet in items:
        print(f"  {path}:{line}  {snippet}", file=sys.stderr)
    print(f"  fix:\n  {rule['fix']}", file=sys.stderr)
    print(file=sys.stderr)

sys.exit(1)
PYEOF
