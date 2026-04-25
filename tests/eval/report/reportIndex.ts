/**
 * 维护 docs/eval-reports/index.json：扫描目录下所有 *.json 报告，
 * 提取摘要字段（runAt / commit / overallPass / criticalFailures）按 runAt 升序写入。
 * viewer.html 通过 fetch ./index.json 列出可加载的报告。
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvalReport } from './reportTypes'

export interface ReportIndexEntry {
  filename: string
  runAt: string
  commit: string
  overallPass: boolean
  criticalFailures: string[]
}

export interface ReportIndex {
  reports: ReportIndexEntry[]
}

export async function rebuildIndex(outDir: string): Promise<void> {
  const files = (await readdir(outDir)).filter(f => f.endsWith('.json') && f !== 'index.json')
  const entries: ReportIndexEntry[] = []
  for (const f of files) {
    try {
      const content = await readFile(join(outDir, f), 'utf-8')
      const r: EvalReport = JSON.parse(content)
      entries.push({
        filename: f,
        runAt: r.runAt,
        commit: r.commit,
        overallPass: r.summary.overallPass,
        criticalFailures: r.summary.criticalFailures,
      })
    } catch {
      // 跳过损坏 / 非 EvalReport 结构的 json
    }
  }
  entries.sort((a, b) => a.runAt.localeCompare(b.runAt))
  await writeFile(
    join(outDir, 'index.json'),
    JSON.stringify({ reports: entries } satisfies ReportIndex, null, 2),
    'utf-8',
  )
}
