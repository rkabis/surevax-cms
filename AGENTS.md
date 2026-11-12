# AGENTS.md - SureVax CMS v2.0

This file is the Codex entrypoint. It mirrors the high-signal project rules
from `CLAUDE.md` and `.claude/rules/*`; keep those files in sync when changing
architecture, workflow, or agent guidance.

## Project posture

SureVax CMS is an ABTC clinic management system for the Philippines. The repo
is development-only: no real clinical data, all deployed environments currently
run `NODE_ENV=development`, and production enablement is tracked in
`docs/ENVIRONMENTS.md`.

Current architecture:

- Monorepo with `packages/shared`, `apps/backend`, and `apps/frontend`
- Frontend: React, TypeScript, Vite, TanStack Query, React Hook Form, Zod,
  Tailwind, shadcn/ui
- Backend: Node.js, Express, Drizzle ORM, PostgreSQL with RLS
- Shared validation/types live in `@surevax/shared`

## First reads

Read only what is relevant to the task:

- `docs/ai-context/_INDEX.md` routes to the canonical context files.
- `docs/specs/surevax-cms-v2/requirements.md` is the active requirements
  baseline.
- `archive/` is historical only.
- For frontend work, also read `apps/frontend/AGENTS.md`.

## Non-negotiables

- Tenant isolation is database-first: tenant-scoped tables need `tenant_id`,
  RLS is the primary boundary, and `SET LOCAL` belongs inside
  `db.transaction()`.
- Zod schemas in `@surevax/shared` are the contract source. Do not duplicate
  validation across frontend and backend.
- Clinical and financial data use soft deletes and database audit triggers.
- Inventory is FEFO.
- Public API IDs are `display_id` strings. Internal bigint IDs must not leak to
  frontend types or responses.
- Use parameterized queries only. Never interpolate SQL strings.
- No `localStorage` or `sessionStorage` JWT auth for web sessions.
- No Vue, CRA, Redux, styled-components, axios, lodash, moment, Supabase,
  Firebase, Prisma, TypeORM, NestJS, or Vercel free-tier production hosting.

## Working locally

Use Node 22 and pnpm 9.15.0. The repository pins pnpm in `package.json` and
Node's major version in `.nvmrc`.

```bash
pnpm install --frozen-lockfile
pnpm run setup
pnpm dev
```

`pnpm run setup` creates per-worktree env files and a per-worktree database on the
shared local Postgres container. It is safe to rerun; use `pnpm run setup --force`
only when you intend to regenerate env files.

Useful checks:

```bash
pnpm agent:check
pnpm format:check
pnpm lint
pnpm --recursive typecheck
pnpm --recursive build
pnpm --filter @surevax/backend test
```

`@surevax/shared` must build before backend production builds because package
exports point at `dist/`.

## Editing discipline

- Prefer existing patterns and feature-module boundaries.
- Keep changes scoped. Do not refactor unrelated files.
- Search docs as well as code when renaming terminology, removing rules, or
  changing schema.
- Use conventional commit messages if committing.
- Never force-push to a PR with auto-merge armed.
- Do not commit directly to `main`.
- This repo may be in a dirty worktree. Do not revert changes you did not make.

## Verification expectations

For narrow code changes, run the nearest typecheck/test plus any affected
script. For frontend UI changes, run the token and design-system checks:

```bash
bash scripts/check-tailwind-tokens.sh
bash scripts/check-design-system.sh
```

For DB/API changes, prefer migration, seed, and backend tests when local
Postgres is available:

```bash
pnpm run setup
pnpm --filter @surevax/backend db:deploy
pnpm --filter @surevax/backend db:seed
pnpm --filter @surevax/backend test
```

If a required check cannot run, report the exact blocker.
