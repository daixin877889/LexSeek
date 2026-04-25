import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvalReport } from './reportTypes'

export async function writeJsonReport(report: EvalReport, outDir: string): Promise<string> {
  const ts = report.runAt.slice(0, 16).replace(/[T:]/g, '-').replace(/-(\d{2})-(\d{2})$/, '-$1$2')
  const filename = `${ts}-context-governance.json`
  const filepath = join(outDir, filename)
  await writeFile(filepath, JSON.stringify(report, null, 2), 'utf-8')
  return filepath
}
