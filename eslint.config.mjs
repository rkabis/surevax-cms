// Flat config — applies to the whole monorepo.
// Conservative baseline: typescript-eslint recommended (not strict-type-checked)
// + react-hooks rules for the frontend. Stricter rules can ratchet in via
// follow-up PRs without changing the gate.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'apps/backend/drizzle/**',
      'pnpm-lock.yaml',
      // Agent worktrees live under .claude/worktrees/ — exclude them so ESLint
      // doesn't glob into stale/missing worktree checkouts on developer machines.
      '.claude/**',
      // Some environments stage agent worktrees under sibling directories
      // (.claire, .codex, .cursor). Ignore any nested `worktrees/` directory
      // anywhere in the repo as a catch-all.
      '**/worktrees/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // Project-wide softening: unused-vars warns instead of errors, and
      // leading-underscore vars are allowed (already used widely).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // `any` is used sparingly at ORM/middleware seams; we'll ratchet in a
      // follow-up. For now, `warn` so it stays visible without blocking CI.
      '@typescript-eslint/no-explicit-any': 'warn',
      // ts-eslint banned the empty-object-type rule but the codebase has a
      // few `{}` aliases that are intentional. Allow them.
      '@typescript-eslint/no-empty-object-type': 'off',
      // Express request augmentation requires `declare global { namespace
      // Express { ... } }`. Allow this canonical pattern.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  },
  // Frontend-only: react-hooks rules.
  {
    files: ['apps/frontend/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Frontend-only: design-system primitive enforcement.
  // Companion to scripts/check-design-system.sh — that script catches
  // pattern shapes that span multiple lines; these rules catch the
  // single-element JSX shapes more precisely via AST inspection.
  // Primitives that legitimately use the forbidden markup (e.g.,
  // DetailSheet.tsx uses <SheetContent side="right">) are exempted via
  // the files override below.
  {
    // `src/shared/**` was consolidated into src/lib + src/components +
    // src/hooks (1cdf833), so that glob had been matching nothing and
    // src/components/** — the AppShell and the ComingSoon page head — was
    // out of the rules' reach entirely (found 2026-07-25).
    files: [
      'apps/frontend/src/features/**/*.{ts,tsx}',
      'apps/frontend/src/components/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // <SheetContent side="right">: must use <DetailSheet>
          selector:
            'JSXOpeningElement[name.name="SheetContent"]:has(JSXAttribute[name.name="side"][value.value="right"])',
          message:
            'Use <DetailSheet> from @/components/layout instead of <SheetContent side="right">. Three width presets: narrow / standard / wide. See PATTERNS.md Pattern 6.',
        },
        {
          // <h1 className="text-lg font-semibold ..."> with the
          // canonical page-title classes: must use <PageHeader>
          selector:
            'JSXOpeningElement[name.name="h1"] > JSXAttribute[name.name="className"] > Literal[value=/\\btext-(lg|xl)\\b.*\\bfont-semibold\\b/]',
          message:
            'Use <PageHeader> from @/components/layout instead of hand-rolling <h1 className="text-lg font-semibold">. See PATTERNS.md Pattern 11.',
        },
        {
          // <SheetContent ...> (any side / no side) outside the
          // primitive is suspect — every detail rail goes through
          // DetailSheet. Sheet-side="left" (mobile nav in AppShell)
          // is the only legitimate other use; it's exempted via the
          // files override below.
          selector:
            'JSXOpeningElement[name.name="SheetContent"]:not(:has(JSXAttribute[name.name="side"][value.value="left"]))',
          message:
            'Use <DetailSheet> from @/components/layout instead of <SheetContent>. Side="left" mobile-nav drawer is the only exception (allowed in AppShell.tsx).',
        },
        {
          // Hand-rolled KPI components shadow the canonical <KpiCell>
          // primitive. The 2026-05-16 round-2 audit found a local
          // `KpiCard` in StandingOrdersPage diverging from PATTERNS.md
          // Pattern 18 (text-xl vs text-2xl, p-4 vs p-3, no ruled
          // dividers). Forbid the name pattern outright so the
          // primitive can't be quietly re-forked.
          selector: 'FunctionDeclaration[id.name=/^Kpi(Card|Tile|Box|Stat|Metric)$/]',
          message:
            'Hand-rolled KPI component detected. Use <KpiCell> inside <KpiStrip> from @/components/layout. See PATTERNS.md Patterns 10 and 18.',
        },
        {
          // Same rule for `const KpiCard = (...) => ...` arrow/function
          // expression form.
          selector:
            'VariableDeclarator[id.name=/^Kpi(Card|Tile|Box|Stat|Metric)$/]:matches([init.type="ArrowFunctionExpression"], [init.type="FunctionExpression"])',
          message:
            'Hand-rolled KPI component detected. Use <KpiCell> inside <KpiStrip> from @/components/layout. See PATTERNS.md Patterns 10 and 18.',
        },
      ],
    },
  },
  // Design-system primitives are allowed to use the forbidden markup
  // (that's their job — they encapsulate it). Exempt the primitive
  // files specifically. Documented per-file exceptions (kept in sync
  // with scripts/check-design-system.sh allowlist):
  //
  //   PatientList — dense list-and-detail layout with custom button
  //     sizing that PageHeader doesn't accommodate.
  //   TransactionsCreatePage — cashier flow whose h1 wraps a dynamic
  //     patient name; different shape than a list page head.
  //   BiteAssessmentDemo — demo surface, not a routed page.
  //   AppShell — hosts the mobile-nav <SheetContent side="left">,
  //     which is a different use case from the detail-rail.
  {
    files: [
      'apps/frontend/src/components/layout/**/*.{ts,tsx}',
      // Was 'src/shared/components/AppShell.tsx' — a path that no longer
      // exists, so this exemption had been dead since the src/shared merge.
      'apps/frontend/src/components/AppShell.tsx',
      // ComingSoon owns the page head for the three unbuilt routes.
      'apps/frontend/src/components/ComingSoon.tsx',
      'apps/frontend/src/features/patients/components/PatientList.tsx',
      'apps/frontend/src/features/transactions/TransactionsCreatePage.tsx',
      'apps/frontend/src/features/encounters/components/BiteAssessmentDemo.tsx',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // Tests + scripts: relaxed.
  {
    files: ['apps/backend/tests/**/*.ts', 'scripts/**/*'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
