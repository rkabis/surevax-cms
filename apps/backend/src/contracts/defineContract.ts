import type { ZodTypeAny } from 'zod'

/**
 * API contract scaffolding — see docs/specs/api-contract-codegen.md.
 *
 * Each backend module declares a `contract.ts` that value-exports its route
 * Zod schemas plus a `defineContract(...)` manifest. `routes.ts` imports the
 * schemas from the contract (same package — the tsx `@surevax/shared`
 * runtime-import gotcha is not in play), and the generator
 * (`src/contracts/generate.ts`) emits frontend types from the manifest.
 *
 * Contract files must stay side-effect free: import only `zod` and pure
 * shared utils (e.g. `displayId.ts`). Never import `db.ts`, `routes.ts`, or
 * anything that touches `env.ts` — the generator runs without a configured
 * environment.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type EndpointDef = {
  method: HttpMethod
  /** Express-style mount path as the frontend calls it, e.g. '/api/scheduled-orders/:id'. */
  path: string
  /** Path-param schemas, printed from the input side. */
  params?: Record<string, ZodTypeAny>
  /** Query-string schema (z.object), printed from the input side. */
  query?: ZodTypeAny
  /** Request-body schema, printed from the input side (what the client sends). */
  body?: ZodTypeAny
  /**
   * Response schema — the ACTUAL `res.json` payload shape (bare array vs
   * envelope, numeric-as-string). Printed from the output side; transforms
   * (`ZodEffects`) are rejected by the generator because their output type is
   * not introspectable.
   */
  response: ZodTypeAny
}

export type ContractDef<E extends Record<string, EndpointDef> = Record<string, EndpointDef>> = {
  /** kebab-case feature name; emits apps/frontend/src/api/contracts/<feature>.gen.ts */
  feature: string
  endpoints: E
}

export function defineContract<E extends Record<string, EndpointDef>>(
  feature: string,
  endpoints: E,
): ContractDef<E> {
  if (!/^[a-z][a-z0-9-]*$/.test(feature)) {
    throw new Error(`contract feature must be kebab-case, got '${feature}'`)
  }
  return { feature, endpoints }
}
