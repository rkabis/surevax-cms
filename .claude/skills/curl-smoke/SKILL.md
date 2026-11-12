---
name: curl-smoke
description: Canonical end-to-end curl verification recipe against the seeded dev stack — login + cookie jar, CSRF and tenant headers, per-worktree port resolution, list-envelope checks, and the runtime bug classes typecheck cannot catch (query-key drift, data-shape assumptions, silent-empty projections). Use before committing any feature that touches the DB or an API response shape, and as the post-integration step of every orchestrate-pilot wave.
---

# Curl Smoke — verify against the real stack before commit

Typecheck + build pass clean on entire classes of real bugs: TanStack Query
key string drift, seed data-shape assumptions, RLS silent-empty reads,
list-envelope mismatches, and runtime SQL (e.g. Drizzle unqualified
correlation). A 2-minute curl smoke catches what the type system can't.
Measured: every orchestration wave that ran the smoke caught ≥1 real bug the
diff-only verify missed.

## 0. Preconditions

```bash
# Worktree must be bootstrapped (creates .env with this worktree's port + DB)
test -f apps/backend/.env || pnpm run setup
PORT=$(grep '^PORT=' apps/backend/.env | cut -d= -f2)
# Stack up (or `pnpm dev` in background)
curl -s "http://localhost:$PORT/api/health" | head -c 200
```

If `apps/backend/.env` is missing and Docker isn't available, fall back to
typecheck/build only — and say so in the report; don't pretend the smoke ran.

## 1. Login — cookie jar + CSRF header

```bash
JAR=/tmp/smoke-cookies.txt
curl -s -c "$JAR" -X POST "http://localhost:$PORT/api/auth/login" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: fetch' \
  -H 'X-Tenant-Slug: SVX' \
  -d '{"email":"admin@surevax.com","password":"TestPass123!"}' | jq '.user.email'
```

- `X-Requested-With: fetch` is required on EVERY state-changing request
  (CSRF middleware → 403 `CSRF_REQUIRED` without it). GETs don't need it.
- `X-Tenant-Slug: SVX` covers pre-auth tenant resolution; post-login the JWT
  claim carries it.
- Other personas: `platform@surevax.com` (POST `/api/operator/login`),
  `branch-main@surevax.com` (Branch kiosk role). All `TestPass123!`.

## 2. Endpoint smokes

```bash
# GET — list shape check FIRST: bare array vs envelope
curl -s -b "$JAR" "http://localhost:$PORT/api/<resource>" | jq 'type'
# "array"  → frontend must consume bare; "object" → check which envelope
# Envelope endpoints: /api/patients {data,nextCursor} · /api/inventory
# {data,summary} · /api/transactions {data,stats,dayStats} · /api/services
# {data} · /api/scheduled-orders {data,stats} · /api/encounters {data}

# POST — realistic payload, assert 2xx + observable side-effect
curl -s -b "$JAR" -X POST "http://localhost:$PORT/api/<resource>" \
  -H 'Content-Type: application/json' -H 'X-Requested-With: fetch' \
  -d '<realistic payload>' | jq '{displayId, status}'
```

Assertion rules:

- **The smoke must include a case where the output is non-empty.** A
  silent-empty bug (RLS filtering everything, projection collapsing to 0
  rows) looks identical to "no work needed" otherwise.
- For money fields, remember `numeric` serializes as a **string** —
  `jq '.netAmount | type'` should be `"string"`.
- 404 on a row you just seeded usually means a bare `db` read outside
  `withTenantTx` (RLS returns 0 rows), not a missing row.
- 23514 / 409 on inserts → check the D2 branch invariant or negative-inventory
  CHECK before assuming a bug.

## 3. Greps typecheck can't do

```bash
# TanStack Query key rename — keys are strings, drift is cross-feature silent
grep -rn "queryKey.*<old-key>" apps/frontend/src
# Stale references after a rename/removal (docs included)
grep -rn "<removed-symbol>" --include="*.ts" --include="*.tsx" --include="*.md" .
```

## 4. When a worker/wave runs this

Embed the exact copy-paste commands (with the unit's real endpoint + payload)
in the prompt — workers execute what's in front of them, not descriptions.
Default orchestration workers to typecheck/build only (CI owns the DB gates);
the COORDINATOR runs this smoke once on the integrated result.
