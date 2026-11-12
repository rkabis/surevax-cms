/** Run a PHI-safe, local-only AppSheet migration rehearsal. */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runLocalMigrationRehearsal } from '../modules/data_migration/rehearsal.js'

type Cli = {
  manifestPath: string
  appsheetPath?: string
  appsheetSnapshotDirectory?: string
  appsheetSnapshotSha256?: string
  outputPath: string
  cutoffDate?: string
}

function readCli(argv: string[]): Cli {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || !value)
      throw new Error(
        'usage: migration:rehearse --manifest <path> --out <path> [--appsheet <path>] [--cutoff YYYY-MM-DD]',
      )
    values.set(key, value)
  }
  const manifestPath = values.get('--manifest')
  const outputPath = values.get('--out')
  if (!manifestPath || !outputPath) throw new Error('both --manifest and --out are required')
  return {
    manifestPath,
    outputPath,
    appsheetPath: values.get('--appsheet'),
    appsheetSnapshotDirectory: values.get('--appsheet-snapshot-dir'),
    appsheetSnapshotSha256: values.get('--appsheet-snapshot-sha'),
    cutoffDate: values.get('--cutoff'),
  }
}

const cli = readCli(process.argv.slice(2))
const result = await runLocalMigrationRehearsal({
  manifestPath: cli.manifestPath,
  appsheetPath: cli.appsheetPath,
  appsheetSnapshotDirectory: cli.appsheetSnapshotDirectory,
  appsheetSnapshotSha256: cli.appsheetSnapshotSha256,
  cutoffDate: cli.cutoffDate,
})
await mkdir(path.dirname(cli.outputPath), { recursive: true })
await writeFile(cli.outputPath, `${JSON.stringify(result.report, null, 2)}\n`, 'utf8')
console.log(
  JSON.stringify({
    outputPath: cli.outputPath,
    queueCounts: result.report.queueCounts,
    readyForDatabaseWrite: false,
  }),
)
