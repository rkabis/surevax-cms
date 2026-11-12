# API contract codegen — design note

**Status:** approved (Phase 0 decision, 2026-06-12)
**Goal:** kill the schema↔Zod↔frontend field-parity drift bug class
(`.claude/rules/gotchas.md` "Schema ↔ Zod ↔ frontend field parity" — 4 of 10
PRs in one review batch) by generating the frontend's request/response types
from the backend's route Zod, enforced by a CI drift gate.

## Decision

**Mechanism (a): per-module `contract.ts` + in-repo Zod→TS printer.** No new
dependencies, no AST extraction, no contract framework.

Rejected alternatives:

- **(b) ts-morph/AST extraction** — inline schemas call runtime helpers
  (`prefixedDisplayIdSchema('TXN')`, `catalogCodeSchema`); static analysis
  can't resolve them without evaluation. Fragile against refactors.
- **(c) contract libs (ts-rest / zodios / oRPC)** — fail the dependency gate
  (most are <1M downloads) and violate rule 8 by wrapping routing and/or
  React Query. zod-to-ts (types only) also fails the downloads gate and is
  replaceable by ~250 lines we control.

## Shape

### 1. Per-module `contract.ts` (backend)

`apps/backend/src/modules/<module>/contract.ts` value-exports:

- the module's request Zod schemas (moved verbatim from `routes.ts` — the
  schemas themselves do not change);
- **new** response Zod schemas describing the ACTUAL wire shape per endpoint
  (bare array vs `{data, ...}` envelope — never normalized; `numeric(12,2)`
  columns are `z.string()`);
- an endpoint manifest via `defineContract`:

```ts
export const contract = defineContract('scheduled-orders', {
  list: {
    method: 'GET',
    path: '/api/scheduled-orders',
    query: listQuerySchema,
    response: listResponseSchema,
  },
  administer: {
    method: 'POST',
    path: '/api/scheduled-orders/:id/administer',
    body: administerBodySchema,
    response: administerResponseSchema,
  },
})
```

`routes.ts` imports its schemas from `./contract.js`. Same package → plain
relative value import; the tsx `@surevax/shared` runtime-import gotcha is not
in play. The module-local Zod stays the runtime source of truth.

### 2. Honesty mechanism (backend typecheck)

A response schema is only worth having if it can't silently lie. Each route
asserts its payload against the contract at the `res.json` callsite:

```ts
res.json(result satisfies ScheduledOrdersListResponse) // z.infer<typeof contract.list.response>
```

(or types the `db.ts` return value as the inferred response type). Where the
payload carries raw `Date` objects that `res.json` will serialize, wrap it in
`wire(...)` from `src/contracts/wire.ts` — a pure type-level `Jsonify<T>` cast
(Date→string, recursively) that models exactly what JSON.stringify does, so the
assertion stays honest without rewriting db.ts mappings. Backend `tsc` now
fails when implementation and contract diverge. Caveat: `satisfies` cannot flag
payload fields MISSING from the contract (excess properties pass structural
subtyping) — author response schemas from the db.ts projection, not from the
old frontend types. Where a `db.ts`
return type is too dynamic for `satisfies` (raw `sql` projections typed
manually), the hand-written row type IS the thing being checked — keep the
`satisfies` at the route layer regardless.

### 3. Generator + printer (in-repo, no deps)

- `apps/backend/src/contracts/registry.ts` — imports every module contract
  into one array. Adding a module = one import + one array entry.
- `apps/backend/src/contracts/printer.ts` — walks Zod v3 `_def` and prints a
  TS type literal. Supported: object, string, number, boolean, null, literal,
  enum, nativeEnum, array, tuple, union, discriminatedUnion, record, nullable,
  optional, default, effects, unknown/any, date (prints `string` — JSON), lazy
  is unsupported (throw).
  - **Requests print the INPUT side** (`z.input`) — that is what the client
    sends. `validate()` replaces `req.body` with the parsed OUTPUT, so the two
    differ on transforms/defaults (e.g. `positiveMoneySchema` input is
    `string | number`; `.default()` fields are optional on input).
  - **Responses print the OUTPUT side and ban `ZodEffects`** — a transform's
    output type is not introspectable at runtime, so the generator throws if a
    response schema contains one. Response schemas must be plain.
- `apps/backend/src/contracts/generate.ts` — emits one file per module to
  `apps/frontend/src/api/contracts/<feature>.gen.ts` (checked in; frontend
  builds never need a running backend). Output is deterministic (manifest
  order, stable formatting) and prettier-formatted. Each file exports:
  - named request/response types (`export type ScheduledOrdersListResponse = …`)
  - an `endpoints` const: `{ list: { method: 'GET', path: '/api/scheduled-orders' }, … }`
  - a `// GENERATED FILE — do not edit. Run pnpm gen:contracts.` header.

No typed-fetch wrapper in the spine: feature `api.ts` files keep their
hand-written React Query hooks and `apiFetch` calls, importing types from the
`.gen.ts` file instead of declaring them. Frontend-only view types stay local.

### 4. CI drift gate

- Root script: `pnpm gen:contracts` → `pnpm --filter @surevax/backend gen:contracts`.
- Gate (in `pnpm agent:check` and `ci.yml`):
  `pnpm gen:contracts && git diff --exit-code apps/frontend/src/api/contracts`.
- Failure mode it catches: someone edits a backend contract (or a module's
  schemas) without regenerating, or hand-edits a `.gen.ts` file.

## Drift coverage map (what kills the bug class)

| Drift pair                       | Caught by                                           |
| -------------------------------- | --------------------------------------------------- |
| DB schema ↔ db.ts projection     | existing Drizzle typing (unchanged)                 |
| db.ts/route ↔ contract response  | `satisfies` assertion → backend `tsc`               |
| contract ↔ generated types       | CI drift gate (regen + `git diff --exit-code`)      |
| generated types ↔ feature api.ts | frontend `tsc` (api.ts imports the generated types) |

## Rules for contract authors (fan-out units)

1. Response schema = the ACTUAL `res.json` payload. Bare array stays
   `z.array(row)`; envelopes stay envelopes. Verify with curl, not vibes.
2. Every `numeric` column crosses as `z.string()`.
3. No transforms/refines in response schemas (generator throws).
4. Request schemas move verbatim — do not "improve" validation in the same PR.
5. Error envelopes (`{ error, code }`) are NOT modeled per-endpoint in v1;
   `ApiError` in `apiFetch` already owns that path.
6. Pilot/canonical module: `scheduled_orders` ↔ `features/scheduled-orders`.

## Rollout

1. **Spine (one PR to main):** defineContract + printer + generator +
   registry + root script + CI gate + pilot module end-to-end + a
   prove-the-gate-fails test (inject drift, observe red).
2. **Fan-out:** one unit per module/feature pair (~13), patches consolidated
   into one landing PR.
3. Endpoints without a frontend consumer still get contracts (cheap, and the
   manifest doubles as endpoint inventory).
