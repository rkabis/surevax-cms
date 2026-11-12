# Worker Prompt Template

Read this file when drafting worker prompts in Phase 1. Substitute every
`<placeholder>` with unit-specific values. Every numbered section is required.

---

## 0. Spec gate — read before writing any code

Read this entire prompt. State your implementation plan in two sentences.
If you find any ambiguity, missing column, conflicting constraint, or
assumption you cannot verify — STOP and report at the TOP of your final
message:

> `DEVIATION: <one-line summary>. Plan said <X>; I did <Y> because <Z>.`

Do not proceed past this step without a clear stated plan.

Also stop and report **BLOCKED** (not DEVIATION) if at any point you hit
a stuck state:

- A required file, column, or package is missing and outside this unit's scope
- A hook blocks your push after 2 attempts — do NOT bypass with `--no-verify`
- You've retried the same type error more than 3 times without progress
- You've spent more than 15 tool calls on a single sub-task without completing it

BLOCKED format (top of final message, above the PR line):
`BLOCKED: <one-line summary>. Stopped at: <step>. Partial work on remote: <yes/no>.`

---

## 1. Goal

One sentence: what this unit builds and why.

---

## 2. This unit's task

- **Title**: `<title>`
- **Branch**: `<pre-allocated branch name>`
- **Migration**: `<NNNN_slug.sql>` (or "none")
- **Supplemental SQL**: `<NNNN_slug.sql>` (or "none")
- **Files you own**: `<exact file list with insertion points>`

---

## 3. What you do NOT touch

`<explicit list of every other unit's owned files>`

---

## 4. Base branch

```
Base your branch on commit <coordinator HEAD SHA> — NOT origin/main.
  git fetch origin
  git checkout -b <branch-name> <coordinator HEAD SHA>
```

---

## 4b. Bootstrap push — do this before writing any code

```bash
git push -u origin <branch-name>
```

Creates a detectable remote ref at coordinator HEAD. No files changed yet
so no hooks fire.

## 4c. COMMIT + PUSH AFTER EACH FINDING (mandatory — read this twice)

This is the **single highest-leverage instruction in the template**. After
each individual finding/component is implemented:

1. `pnpm prettier --write <files-you-touched>` (or `pnpm prettier --write .`)
2. `git add <files>` (specific paths — never `git add -A`)
3. `git commit -m "fix(<scope>): <FINDING-ID> — <one-line>"`
4. `git push origin <branch-name>`

Do NOT batch all findings into one end-of-task commit. Background Sonnet
workers in this environment are reliably terminated mid-task at ~80–95k tokens
/ ~50–70 tool uses — the moment your worktree is reaped, **any uncommitted
work is lost**. A unit that committed 3 of 4 findings before termination is
salvageable (the coordinator picks up the open PR and adds the 4th); a unit
that completed all 4 but committed none is gone.

For feature work that builds layers (e.g. component + wiring), commit the
**standalone, compilable layer first** (typecheck-clean), then the wiring
layer — even a PR with just the standalone layer is useful.

---

## 5. Conventions

Read `.claude/rules/gotchas.md` and `.claude/rules/patterns.md`.

Mandatory reminders for every backend unit:

- **Inline Zod schemas** — no `@surevax/shared` value imports at backend runtime
- **`idSchema`** for route `:id` params — not `z.string().uuid()`
- **Tenant GUC** inside `db.transaction(async tx => { ... })` for every write
- **CSRF** `X-Requested-With: fetch` in every `apiFetch` state-changing call
- **`numeric` columns** serialize as strings — never assume JS number
- **JSONB columns** require `JSON.stringify(...)` before insert
- **Text PKs** via `randomId` / `yearId` / `childId` — never `defaultRandom()`
- **Tenant in WHERE** — PATCH/DELETE/single-row SELECT must include `tenant_id = ${tenantId}`
- **List response** is a bare array — `res.json(rows)`, not `{ data: rows }`
- **`format:check`** must pass before `gh pr create` — run `pnpm prettier --write .` first

---

## 5b. Cross-cutting validation (REQUIRED when adding migrations or DB triggers)

When the unit adds a trigger, constraint, or migration affecting existing rows
or sibling triggers, include this block in the worker prompt:

```
### Cross-cutting validation (BEFORE writing the migration)

This unit adds <X>. Check it against:
- <every active trigger touching the same tables>
- <every CHECK constraint on relevant columns>
- <every supplemental SQL that UPDATEs the table>

If your design conflicts with any, report DEVIATION: before implementing.
```

**Supplemental SQL with UPDATE/INSERT/DELETE on audited tables must set the
`app.current_tenant_id` GUC in a DO block** — the migration runner uses
`client.unsafe()` with no transaction wrapper, so the audit trigger raises
and crashes the boot otherwise:

```sql
DO $$
BEGIN
  PERFORM set_config(
    'app.current_tenant_id',
    COALESCE((SELECT tenant_id FROM <target_table> LIMIT 1), 'SVX'),
    true
  );
  UPDATE <target_table> SET ... WHERE ...;
END $$;
```

Verify whether a table is audited by checking the `AUDITED_TABLES` list in
`apps/backend/drizzle/0002_audit_and_redaction.sql` lines 175–220.

---

## 5c. Pre-extracted schema (REQUIRED when target tables are known)

Don't make the worker grep `schema.ts` (~70 KB). Paste the relevant columns
inline in the prompt:

```
### Schema reference (do NOT re-discover)
Target table `<table>`:
  id text PK, tenant_id text, ...
ID prefix: `<PREFIX>` (<year-scoped or random>).
```

Each saved schema lookup ≈ 5–10k tokens × N workers.

---

## 5d. Pre-extracted insertion table (REQUIRED for cross-cutting sweeps)

For mechanical sweeps (sticky headers, logger imports, button order), pass
exact insertion points so workers don't Read each file to find them:

```
### Insertion points (do NOT re-discover — apply directly)
| file              | line | replace        | with                                        |
|-------------------|------|----------------|---------------------------------------------|
| AdminUsersPage.tsx | 142 | <TableHeader>  | <TableHeader className="sticky top-0 ...">  |
| ...               | ...  | ...            | ...                                         |
```

Pre-extracting saves ~9× Tok/LoC vs. worker-discovered insertion points.

---

## 6. Verification recipe — LIGHT by default, CI is the DB gate

**Default (use this unless the coordinator's prompt explicitly says full E2E):**

```bash
PNPM=/opt/homebrew/bin/pnpm
$PNPM install >/dev/null 2>&1 || corepack pnpm install >/dev/null 2>&1
$PNPM --filter @surevax/backend typecheck
$PNPM --filter @surevax/frontend build        # if your unit touches the frontend
$PNPM --filter @surevax/frontend test         # ditto
$PNPM lint
```

Do NOT run `pnpm run setup` / Docker / `db:seed` / `pnpm --filter @surevax/backend test`
locally. GitHub CI runs the 98-test integration suite + a fresh-DB migrate on
every PR (jobs: `Migrations apply (Railway parity)` + `Backend integration tests`),
and `gh pr merge --auto --squash` gates the merge on them. Save the ~30–60k tokens.

After opening the PR, monitor CI and FIX failures until green:

```bash
gh pr checks <num>               # status of all jobs
gh pr view <num> --json statusCheckRollup --jq '.statusCheckRollup'
gh run view <run-id> --log-failed | grep -iE "error|FAIL|TS[0-9]" | head -30
```

Most CI failures are: prettier (run `pnpm prettier --write .`), TS in a touched
file, or a real DB-layer bug your typecheck-only path missed.

**Full E2E** (opt-in only when the coordinator's prompt explicitly says so —
typical case: the unit IS the migration spine and a fresh-seed must succeed
locally before the PR is opened):

```bash
PNPM=/opt/homebrew/bin/pnpm
$PNPM setup                       # destroys+migrates+seeds worktree DB
PORT=$(grep -E '^PORT=' apps/backend/.env | cut -d= -f2)
$PNPM dev & sleep 8
JAR=/tmp/auth-$$.txt
curl -s -c $JAR -X POST http://localhost:$PORT/api/auth/login \
  -H 'Content-Type: application/json' -H 'X-Requested-With: fetch' -H 'X-Tenant-Slug: SVX' \
  -d '{"email":"admin@surevax.com","password":"TestPass123!"}' | jq 'keys'
# (login response is {user}; auth is HTTP-only cookies via $JAR — NOT a Bearer token)
curl -s -b $JAR http://localhost:$PORT/api/<endpoint> -H 'X-Tenant-Slug: SVX' | jq .
$PNPM --filter @surevax/backend test 2>&1 | tail -5
```

---

## 7. Spec deviation rule

> If the spec cannot be implemented as written, **stop and report at the TOP
> of your final message**:
>
> `DEVIATION: <one-line summary>. Plan said <X>; I did <Y> because <Z>.`

---

## 8. Doc-surface self-check

Before `gh pr create`, run:

```bash
scripts/check-doc-surface.sh
```

If files in this unit's scope are flagged, update them in the same PR.
If outside scope, report as `DOC-DRIFT: <detail>` above the `PR:` line.

---

## 9. Parallelization (REQUIRED — concrete example below)

Batch independent tool calls in a single response — do NOT issue them
sequentially when outputs don't depend on each other.

Mandatory parallel batches (do these as ONE assistant turn with multiple
tool-use blocks, not N turns):

- `git status` + `git diff --stat` + `git log --oneline -5` — at commit time
- Reading 2+ files for the same audit (e.g. route + db + schema slice)
- `pnpm --filter @surevax/backend typecheck` + `pnpm --filter @surevax/frontend build` + `pnpm lint`
- Multiple `grep` lookups against different files for the same investigation

**Concrete example** (this is what "batched" looks like in your output —
the abstract rule alone has yielded 0% par% across 39 workers across two
audits; you must actually do this):

> When you're about to verify your PR before opening it, instead of:
>
> ```
> Turn 1: pnpm prettier --write .
> Turn 2: pnpm --filter @surevax/backend typecheck
> Turn 3: pnpm lint
> Turn 4: git status
> Turn 5: git diff --stat
> ```
>
> emit ONE turn with all five Bash tool calls as separate tool-use blocks.

Sequential is correct ONLY when call N's input is computed from call
N-1's output (e.g. `git push` then `gh pr create` — the PR creation
needs the push to land first). Default to parallel; ask "does this
call need the previous result?" — if no, batch it.

Zero parallelization was measured across 21 workers in 2026-05-19 and
again across 18 workers in 2026-05-28 — every sequential tool call
replays the full context prefix at output cost (~5× input).

---

## 10. Worker tail — every step mandatory

By the time you reach this section, per-finding commits + pushes from §4c
are already on the remote branch. The tail covers the final
verification/format pass + PR creation + auto-merge arming.

1. `simplify` (review the full diff: `git diff origin/main..HEAD`)
2. Verification recipe (§6 — light by default)
3. `scripts/check-doc-surface.sh` (§8) — fix in-scope flags; report
   out-of-scope as `DOC-DRIFT:`
4. Final format + lint pass:
   ```bash
   pnpm prettier --write .
   pnpm lint:fix
   ```
   **Mandatory.** CI runs `prettier --check`; the `pr-format-gate.sh` hook
   blocks pushes that don't pass. If this pass produced changes, make a
   final `style:` commit + push.
5. `gh pr create --base main --fill` (Conventional Commits already on each
   per-finding commit; PR body fills from them)
6. **Arm auto-merge** — mandatory, not optional:
   ```bash
   gh pr merge <num> --auto --squash
   ```
   The coordinator drives the BEHIND → update-branch loop; you only need to
   arm. If a CI job fails, fix it on the same branch (normal push — auto-merge
   stays armed; only **force-push** requires disarm-first).
7. End message with `DEVIATION:` / `DOC-DRIFT:` / `BLOCKED:` lines (if any)
   immediately above:
   ```
   PR: <url>
   ```
   The coordinator parses this line. **Do NOT end with "auto-merge armed.
   Done."** with no PR line — that reads as a silent stall.
