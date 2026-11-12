/**
 * Wire-shape helper for contract `satisfies` assertions.
 *
 * `res.json` serializes via JSON.stringify, which converts Date → ISO string
 * (Date.prototype.toJSON === toISOString). Contract response schemas model the
 * WIRE (string), but db.ts often returns raw Drizzle rows with Date fields.
 * `wire(x)` re-types the payload to its JSON-serialized shape so
 * `res.json(wire(x) satisfies XResponse)` checks field names, nullability and
 * numeric-as-string truthfully without forcing .toISOString() rewrites in
 * every db.ts mapping.
 *
 * It is a pure type-level cast — the runtime conversion is performed by
 * res.json itself, identically.
 */
export type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T

export function wire<T>(value: T): Jsonify<T> {
  return value as Jsonify<T>
}
