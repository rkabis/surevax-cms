export const meta = {
  name: 'orchestrate-pilot',
  description:
    'Parallel unit implementation with mandatory adversarial gate-verify; returns patches for consolidated landing (NO per-unit PRs).',
  whenToUse:
    'A wave of independent, enumerable units (non-overlapping files) you would otherwise hand to /orchestrate. Land cross-cutting spine prereqs to main FIRST — worktree agents fork from main HEAD. Model tiering: the coordinator (planning, decomposition, patch integration) runs on the session model (Fable/Opus); impl agents are pinned to Sonnet, verify agents to Opus — do not override these to the session model.',
  phases: [
    {
      title: 'Implement',
      detail: 'one worktree-isolated agent per unit → returns a git diff patch',
      model: 'sonnet',
    },
    {
      title: 'Verify',
      detail: 'adversarial review of each patch against the recurring bug classes',
      model: 'opus',
    },
  ],
}

// ── How this differs from the prose /orchestrate skill ──────────────────────
// • Fan-out is deterministic JS (pipeline), not a protocol the model must drive
//   step-by-step → the ~50% silent-worker-failure mode cannot happen.
// • Each agent's return is SCHEMA-FORCED → no "done" with no evidence; the
//   runtime rejects a return missing the patch / file list / scope flag.
// • A unit cannot reach integration unverified — the verify stage runs per unit
//   and emits a structured pass/block verdict keyed to the five recurring
//   bug classes (envelope-drift, check-then-act, modeled-not-wired, authz,
//   seed-runtime) + a scope check.
// • NO per-unit PRs / auto-merge / rebase cascade. Agents return PATCHES;
//   the coordinator (main loop) applies the passing ones to ONE integration
//   branch and ships a single PR.
// • Agents do NOT build/test (no node_modules in fresh worktrees, and per the
//   static-deployment design verification belongs to the spine). The
//   coordinator runs `pnpm agent:check` + the DB gates + CI on the INTEGRATED
//   result — verifying the seam, not isolated slices.
// • MODEL TIERING — planning is expensive-model work, execution is not:
//     coordinator (main loop)  → session model (Fable/Opus): wave design,
//       unit decomposition, reading verdicts, patch integration, the PR.
//     impl agents              → model: 'sonnet' (pinned): they execute a
//       fully-specified unit; coordinator-tier tokens here are pure waste.
//     verify agents            → model: 'opus' (pinned): adversarial judgment
//       against the bug classes — needs depth, not the top tier.
//   Keep the pins; without them every agent inherits the session model and a
//   6-unit wave bills ~12 worker runs at Fable output rates.
//
// ── Invocation ──────────────────────────────────────────────────────────────
//   Workflow({ name: 'orchestrate-pilot', args: {
//     baseRef: 'main',
//     units: [
//       { id: 'U1', title: '…', instructions: '…', allowedFiles: ['apps/.../x.ts'] },
//       …
//     ],
//   }})
// Returns: { summary, passed: [{unit, filesTouched, summary, patch}], blocked: [...] }
// The coordinator then: git checkout -b integration/<wave>; apply each passing
// patch; run agent:check + gates + tests on the static deployment; open ONE PR.

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['unitId', 'filesTouched', 'patch', 'summary', 'deviations', 'scopeRespected'],
  properties: {
    unitId: { type: 'string' },
    filesTouched: { type: 'array', items: { type: 'string' } },
    patch: {
      type: 'string',
      description: 'Unified git diff of ALL changes: `git add -A && git --no-pager diff --cached`',
    },
    summary: { type: 'string', description: '1-2 sentences on what was implemented' },
    deviations: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Anything done differently from the instructions, or files touched outside scope; [] if none',
    },
    scopeRespected: {
      type: 'boolean',
      description: 'true iff the patch touches ONLY the allowed files',
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['unitId', 'scopeRespected', 'findings', 'verdict', 'rationale'],
  properties: {
    unitId: { type: 'string' },
    scopeRespected: {
      type: 'boolean',
      description: 'true iff the diff touches only allowed files',
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bugClass', 'severity', 'file', 'detail'],
        properties: {
          bugClass: {
            type: 'string',
            enum: [
              'envelope-drift',
              'check-then-act',
              'modeled-not-wired',
              'authz',
              'seed-runtime',
              'scope',
              'other',
            ],
          },
          severity: { type: 'string', enum: ['block', 'warn'] },
          file: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
    verdict: { type: 'string', enum: ['pass', 'block'] },
    rationale: { type: 'string' },
  },
}

function implPrompt(unit, baseRef) {
  const allowed = (unit.allowedFiles || []).map((f) => '  - ' + f).join('\n')
  return `You are implementing ONE unit of a parallel wave, in an isolated git worktree forked from ${baseRef}.

UNIT ${unit.id} — ${unit.title}

INSTRUCTIONS
${unit.instructions}

SCOPE — you may create/modify ONLY these files:
${allowed || '  (none specified — treat ANY file change as in-scope but list every file in filesTouched)'}
Touching any other file is a scope violation: set scopeRespected=false and name the file in deviations.

GUARDRAILS — do NOT introduce any of the recurring bug classes:
- List endpoints: keep the EXISTING response shape. Bare-array endpoints stay bare arrays; {data,...} envelope endpoints stay envelopes. Never flip a shape.
- Any check-then-insert / check-then-update needs a DB unique constraint or a FOR UPDATE lock — never a bare read-then-write (idempotency, inventory, cash drawer, tokens).
- If you add a schema flag/column that implies runtime behaviour, wire its enforcing code IN THIS UNIT (no "follow-on PR").
- A new /api/admin/* or /api/audit mount MUST carry requireRole(...).
- Backend DB writes go through withTenantTx / withSystemTx / withPlatformTx — never bare db.insert/update/delete/execute/transaction.

DO NOT run pnpm build / agent:check / tests. The coordinator runs full verification on the INTEGRATED result. Your job is a correct edit + an honest patch.

When finished, produce the patch:
  git add -A
  git --no-pager diff --cached
Return: patch (that exact diff), filesTouched, a 1-2 sentence summary, deviations ([] if none), and scopeRespected.`
}

function verifyPrompt(unit, impl) {
  return `Adversarially review ONE unit's diff BEFORE it is integrated. Assume it is wrong until the diff proves otherwise.

UNIT ${unit.id} — ${unit.title}
ALLOWED FILES: ${(unit.allowedFiles || []).join(', ') || '(unspecified)'}
IMPLEMENTER SUMMARY: ${impl.summary}
IMPLEMENTER DEVIATIONS: ${JSON.stringify(impl.deviations || [])}
IMPLEMENTER scopeRespected: ${impl.scopeRespected}

DIFF:
\`\`\`diff
${impl.patch}
\`\`\`

Report a finding for each issue you can substantiate from the diff text:
- envelope-drift: a list endpoint whose shape (bare array vs {data} envelope) is changed or mismatches the frontend consumer.
- check-then-act: a read-then-write with no DB constraint / FOR UPDATE lock.
- modeled-not-wired: a new schema flag/column with NO enforcing code in this diff.
- authz: a new /api/admin/* or /api/audit mount without requireRole; a bare db write outside the tx helpers.
- seed-runtime: a change that makes the seed populate one representation while runtime reads another.
- scope: the diff touches a file NOT in the allowed list (recompute independently; do not trust the implementer's flag).

verdict='block' if ANY finding is severity 'block' OR scope is violated; otherwise 'pass'.
Set scopeRespected from YOUR own reading of the diff's file headers. Review the diff text only — do not run anything.`
}

// ── Run ──────────────────────────────────────────────────────────────────────
// `args` should arrive as a parsed object, but tolerate a JSON-string too
// (some invocation paths pass it stringified).
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch {
    input = {}
  }
}
const baseRef = (input && input.baseRef) || 'main'
const units = (input && input.units) || []

if (!units.length) {
  log('orchestrate-pilot: no units supplied (args.units is empty) — nothing to do.')
  return { summary: '0 units', passed: [], blocked: [] }
}

log(
  `orchestrate-pilot: ${units.length} unit(s), base=${baseRef}. Implement → adversarial verify → return patches (no PRs).`,
)

const results = await pipeline(
  units,
  (unit) =>
    agent(implPrompt(unit, baseRef), {
      label: `impl:${unit.id}`,
      phase: 'Implement',
      isolation: 'worktree',
      schema: IMPL_SCHEMA,
      model: 'sonnet', // execution tier — see MODEL TIERING above
    }),
  (impl, unit) => {
    if (!impl) return null
    return agent(verifyPrompt(unit, impl), {
      label: `verify:${unit.id}`,
      phase: 'Verify',
      schema: VERDICT_SCHEMA,
      model: 'opus', // judgment tier — see MODEL TIERING above
    }).then((verdict) => ({ unitId: unit.id, impl, verdict }))
  },
)

const clean = results.filter(Boolean)
const passed = clean.filter(
  (r) =>
    r.verdict && r.verdict.verdict === 'pass' && r.verdict.scopeRespected && r.impl.scopeRespected,
)
const blocked = clean.filter((r) => !passed.includes(r))
const dropped = units.length - clean.length // impl agent errored or was skipped

log(
  `orchestrate-pilot: ${passed.length} passed · ${blocked.length} blocked · ${dropped} dropped (impl error/skip). ` +
    `Coordinator: apply passed patches to one integration branch, run agent:check + gates + tests, ship ONE PR.`,
)

return {
  baseRef,
  summary: `${passed.length}/${units.length} passed verify`,
  passed: passed.map((r) => ({
    unit: r.unitId,
    filesTouched: r.impl.filesTouched,
    summary: r.impl.summary,
    patch: r.impl.patch,
  })),
  blocked: blocked.map((r) => ({
    unit: r.unitId,
    reason: r.verdict ? r.verdict.rationale : 'implement agent failed or was skipped',
    findings: r.verdict ? r.verdict.findings : [],
  })),
}
