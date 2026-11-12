/**
 * Contract codegen entry point — `pnpm gen:contracts` (root) runs this via tsx.
 *
 * Emits one `apps/frontend/src/api/contracts/<feature>.gen.ts` per contract in
 * the registry: named request/response types printed from the contract's Zod
 * schemas, plus an `endpoints` const (method + path). Output is checked in;
 * `scripts/check-contract-drift.sh` regenerates in CI and fails on diff.
 *
 * See docs/specs/api-contract-codegen.md.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ContractDef, EndpointDef } from './defineContract.js'
import { printType } from './printer.js'
import { contracts } from './registry.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../../..')
const OUT_DIR = path.resolve(REPO_ROOT, 'apps/frontend/src/api/contracts')

function pascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function camelCase(kebab: string): string {
  const pascal = pascalCase(kebab)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

function emitContract(contract: ContractDef): string {
  const featurePascal = pascalCase(contract.feature)
  const lines: string[] = [
    '// GENERATED FILE — do not edit.',
    `// Source: apps/backend/src/modules — contract '${contract.feature}'.`,
    '// Regenerate with `pnpm gen:contracts`; CI fails on drift.',
    '',
  ]

  const manifestEntries: string[] = []

  for (const [key, endpoint] of Object.entries(contract.endpoints) as Array<
    [string, EndpointDef]
  >) {
    const base = `${featurePascal}${pascalCase(key.replace(/_/g, '-'))}`
    const where = `${contract.feature}.${key}`

    if (endpoint.params) {
      for (const [paramName, paramSchema] of Object.entries(endpoint.params)) {
        lines.push(
          `export type ${base}${pascalCase(paramName)}Param = ${printType(paramSchema, 'input', `${where}.params.${paramName}`)}`,
          '',
        )
      }
    }
    if (endpoint.query) {
      lines.push(
        `export type ${base}Query = ${printType(endpoint.query, 'input', `${where}.query`)}`,
        '',
      )
    }
    if (endpoint.body) {
      lines.push(
        `export type ${base}Body = ${printType(endpoint.body, 'input', `${where}.body`)}`,
        '',
      )
    }
    lines.push(
      `export type ${base}Response = ${printType(endpoint.response, 'output', `${where}.response`)}`,
      '',
    )

    manifestEntries.push(`  ${key}: { method: '${endpoint.method}', path: '${endpoint.path}' },`)
  }

  lines.push(
    `export const ${camelCase(contract.feature)}Endpoints = {`,
    ...manifestEntries,
    '} as const',
    '',
  )

  return lines.join('\n')
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  const seenFeatures = new Set<string>()
  const emittedFiles = new Set<string>()

  for (const contract of contracts) {
    if (seenFeatures.has(contract.feature)) {
      throw new Error(`duplicate contract feature '${contract.feature}' in registry`)
    }
    seenFeatures.add(contract.feature)

    const fileName = `${contract.feature}.gen.ts`
    writeFileSync(path.join(OUT_DIR, fileName), emitContract(contract))
    emittedFiles.add(fileName)
  }

  // Remove orphaned .gen.ts files (renamed/deleted contracts).
  for (const existing of readdirSync(OUT_DIR)) {
    if (existing.endsWith('.gen.ts') && !emittedFiles.has(existing)) {
      rmSync(path.join(OUT_DIR, existing))
      console.log(`gen:contracts removed orphan ${existing}`)
    }
  }

  // Normalize formatting so format:check and the drift gate agree byte-for-byte.
  execSync('pnpm exec prettier --write apps/frontend/src/api/contracts', {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })

  console.log(`gen:contracts emitted ${emittedFiles.size} contract file(s) to ${OUT_DIR}`)
}

main()
