import { z, type ZodTypeAny } from 'zod'

/**
 * Zod v3 → TypeScript type-literal printer for contract codegen.
 *
 * Covers the schema subset the codebase actually uses. Unsupported nodes
 * throw with a path so the contract author finds the offending field fast.
 *
 * Modes:
 * - 'input'  — what the client sends (request bodies/queries/params). Prints
 *   the input side of transforms/pipelines; `.default()` fields are optional.
 * - 'output' — what the server returns (responses). `ZodEffects` is rejected:
 *   a transform's output type is not introspectable at runtime, so response
 *   schemas must be transform-free (docs/specs/api-contract-codegen.md).
 */
export type PrintMode = 'input' | 'output'

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Contracts may consume a Zod schema exported by @surevax/shared. pnpm can
 * load that schema from a second physical Zod module, so `instanceof` is not
 * a reliable discriminator even when both copies are the same Zod version.
 * `_def.typeName` is the stable Zod v3 node tag and keeps shared schemas
 * printable without cloning their validation rules into the backend.
 */
function isZod(schema: ZodTypeAny, typeName: string): boolean {
  return (schema._def as { typeName?: string }).typeName === typeName
}

type CrossCopyZod = {
  unwrap: () => ZodTypeAny
  removeDefault: () => ZodTypeAny
  innerType: () => ZodTypeAny
  value: unknown
  options: unknown
  enum: Record<string, string | number>
  element: ZodTypeAny
  items: ZodTypeAny[]
  keySchema: ZodTypeAny
  valueSchema: ZodTypeAny
  shape: Record<string, ZodTypeAny>
}

function node(schema: ZodTypeAny): CrossCopyZod {
  return schema as unknown as CrossCopyZod
}

/**
 * Whether an object property should print with `?`. Handles wrapper nesting in
 * any order (e.g. `.optional().nullable()` = Nullable(Optional(T))).
 * - input mode: anything that parses `undefined` is optional on the wire-in
 *   side (Optional anywhere, or a Default that fills it).
 * - output mode: only a true Optional wrapper survives to the output type; a
 *   Default fills undefined, making the key required.
 */
function isOptionalProperty(schema: ZodTypeAny, mode: PrintMode): boolean {
  if (mode === 'input') return schema.isOptional()
  let current = schema
  for (;;) {
    if (isZod(current, z.ZodFirstPartyTypeKind.ZodOptional)) return true
    if (isZod(current, z.ZodFirstPartyTypeKind.ZodDefault)) return false
    if (
      isZod(current, z.ZodFirstPartyTypeKind.ZodNullable) ||
      isZod(current, z.ZodFirstPartyTypeKind.ZodBranded) ||
      isZod(current, z.ZodFirstPartyTypeKind.ZodReadonly)
    ) {
      current = node(current).unwrap()
      continue
    }
    return false
  }
}

function literalToTs(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  throw new Error(`unsupported literal value: ${String(value)}`)
}

/** Peel wrappers that affect property optionality, tracking the flag. */
function unwrapForProperty(
  schema: ZodTypeAny,
  mode: PrintMode,
): { schema: ZodTypeAny; optional: boolean } {
  let current = schema
  let optional = false
  for (;;) {
    if (isZod(current, z.ZodFirstPartyTypeKind.ZodOptional)) {
      optional = true
      current = node(current).unwrap()
    } else if (isZod(current, z.ZodFirstPartyTypeKind.ZodDefault)) {
      // Defaulted fields are optional on the wire-in side but always present
      // after parsing (output side).
      if (mode === 'input') optional = true
      current = node(current).removeDefault()
    } else if (isZod(current, z.ZodFirstPartyTypeKind.ZodEffects) && mode === 'input') {
      current = node(current).innerType()
    } else if (isZod(current, z.ZodFirstPartyTypeKind.ZodBranded)) {
      current = node(current).unwrap()
    } else if (isZod(current, z.ZodFirstPartyTypeKind.ZodReadonly)) {
      current = node(current).unwrap()
    } else {
      return { schema: current, optional }
    }
  }
}

export function printType(schema: ZodTypeAny, mode: PrintMode, path = '$'): string {
  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodString)) return 'string'
  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodNumber)) return 'number'
  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodBoolean)) return 'boolean'
  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodNull)) return 'null'
  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodUndefined)) return 'undefined'
  if (
    isZod(schema, z.ZodFirstPartyTypeKind.ZodAny) ||
    isZod(schema, z.ZodFirstPartyTypeKind.ZodUnknown)
  )
    return 'unknown'
  // JSON has no Date — dates cross the wire as ISO strings both directions.
  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodDate)) return 'string'

  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodLiteral)) return literalToTs(node(schema).value)

  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodEnum)) {
    const values = node(schema).options as string[]
    return values.map((v) => JSON.stringify(v)).join(' | ')
  }

  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodNativeEnum)) {
    const enumObj = node(schema).enum
    // Numeric enums put reverse mappings in Object.entries — keep entries whose
    // key is not itself a reverse-mapped numeric value.
    const values = Object.entries(enumObj)
      .filter(([key]) => typeof enumObj[key] !== 'undefined' && Number.isNaN(Number(key)))
      .map(([, v]) => v)
    return values.map((v) => literalToTs(v)).join(' | ')
  }

  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodNullable)) {
    return `${printType(node(schema).unwrap(), mode, path)} | null`
  }

  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodOptional)) {
    return `${printType(node(schema).unwrap(), mode, path)} | undefined`
  }

  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodDefault)) {
    return printType(node(schema).removeDefault(), mode, path)
  }

  if (
    isZod(schema, z.ZodFirstPartyTypeKind.ZodBranded) ||
    isZod(schema, z.ZodFirstPartyTypeKind.ZodReadonly)
  ) {
    return printType(node(schema).unwrap(), mode, path)
  }

  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodEffects)) {
    if (mode === 'output') {
      throw new Error(
        `${path}: ZodEffects (transform/refine) is not allowed in response schemas — ` +
          'the output type is not introspectable. Use a plain schema.',
      )
    }
    return printType(node(schema).innerType(), mode, path)
  }

  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodPipeline)) {
    const def = schema._def
    return mode === 'input'
      ? printType(def.in as ZodTypeAny, mode, path)
      : printType(def.out as ZodTypeAny, mode, path)
  }

  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodArray)) {
    const element = node(schema).element
    const inner = printType(element, mode, `${path}[]`)
    // Parenthesize unions so `A | B[]` can't happen.
    return inner.includes('|') || inner.includes('&') ? `(${inner})[]` : `${inner}[]`
  }

  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodTuple)) {
    const items = node(schema).items
    return `[${items.map((item, i) => printType(item, mode, `${path}[${i}]`)).join(', ')}]`
  }

  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodRecord)) {
    const key = printType(node(schema).keySchema, mode, `${path}{key}`)
    const value = printType(node(schema).valueSchema, mode, `${path}{value}`)
    return `Record<${key}, ${value}>`
  }

  if (
    isZod(schema, z.ZodFirstPartyTypeKind.ZodUnion) ||
    isZod(schema, z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion)
  ) {
    const options = node(schema).options as ZodTypeAny[]
    return options.map((o, i) => printType(o, mode, `${path}|${i}`)).join(' | ')
  }

  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodIntersection)) {
    const def = schema._def
    const left = printType(def.left as ZodTypeAny, mode, `${path}&L`)
    const right = printType(def.right as ZodTypeAny, mode, `${path}&R`)
    return `${left} & ${right}`
  }

  if (isZod(schema, z.ZodFirstPartyTypeKind.ZodObject)) {
    const shape = node(schema).shape
    const entries = Object.entries(shape)
    if (entries.length === 0) return 'Record<string, never>'
    const props = entries.map(([key, value]) => {
      const optional = isOptionalProperty(value, mode)
      const { schema: peeled } = unwrapForProperty(value, mode)
      const keyTs = IDENT_RE.test(key) ? key : JSON.stringify(key)
      return `${keyTs}${optional ? '?' : ''}: ${printType(peeled, mode, `${path}.${key}`)}`
    })
    return `{ ${props.join('; ')} }`
  }

  const typeName = (schema._def as { typeName?: string }).typeName ?? schema.constructor.name
  throw new Error(`${path}: unsupported Zod node '${typeName}' in contract codegen`)
}
