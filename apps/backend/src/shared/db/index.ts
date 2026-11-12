import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

// Coerce Postgres bigint (OID 20) to JS Number at the driver layer.
// Safe to 2^53 ≈ 9 quadrillion — well past clinic-scale row counts.
// All bigserial PK / bigint FK columns in schema.ts use `mode: 'number'`
// so Drizzle's TypeScript types stay aligned with this runtime coercion.
const client = postgres(process.env['DATABASE_URL']!, {
  // H1: explicit pool sizing. postgres-js defaults to max:10 with no
  // idle_timeout / max_lifetime — stale connections survive SIGTERM cycles
  // and stack against Railway's default max_connections=100. Migration
  // runner sets max:1 separately (`migrate.ts`).
  max: 10,
  idle_timeout: 30, // seconds — recycle idle connections
  max_lifetime: 1800, // seconds — recycle connections after 30 min
  connect_timeout: 10, // seconds — fail fast if DB unreachable
  types: {
    int8: {
      to: 20,
      from: [20],
      serialize: (x: number | bigint) => x.toString(),
      parse: (x: string) => Number(x),
    },
  },
})

export const db = drizzle(client, { schema })
