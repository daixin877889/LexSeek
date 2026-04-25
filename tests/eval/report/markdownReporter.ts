import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CaseResult, EvalReport, MetricResult } from './reportTypes'

interface Options {
  excerptAnswers: boolean
  excerptLength: number
}

const STATUS_TEXT: Record<string, string> = {
  pass: '[PASS]',
  fail: '[FAIL]',
  errored: '[ERR]',
}

export async function writeMarkdownReport(report: EvalReport, outDir: string, opts: Options): Promise<string> {
  const ts = report.runAt.slice(0, 16).replace(/[T:]/g, '-').replace(/-(\d{2})-(\d{2})$/, '-$1$2')
  const filename = `${ts}-context-governance.md`
  const filepath = join(outDir, filename)
  await writeFile(filepath, renderMarkdown(report, opts), 'utf-8')
  return filepath
}

function renderMarkdown(report: EvalReport, opts: Options): string {
  const lines: string[] = []
  const overall = report.summary.overallPass ? '[PASS]' : '[FAIL]'
  lines.push('# 上下文机制评测报告')
  lines.push('')
  lines.push(`- 跑批时间：${report.runAt}`)
  lines.push(`- Commit：${report.commit}`)
  lines.push(`- 总耗时：${(report.durationMs / 1000).toFixed(1)}s`)
  lines.push(`- **结论：${overall}**（CRITICAL 失败 ${report.summary.criticalFailures.length} 项）`)
  lines.push('')

  lines.push('## 分级摘要')
  lines.push('| 级别 | 总数 | 通过 | 未通过 |')
  lines.push('|---|---|---|---|')
  const critFail = report.summary.totalCritical - report.summary.passedCritical
  const warnFail = report.summary.totalWarn - report.summary.passedWarn
  lines.push(`| CRITICAL | ${report.summary.totalCritical} | ${report.summary.passedCritical} | ${critFail} ${critFail > 0 ? '[FAIL]' : ''} |`)
  lines.push(`| WARN | ${report.summary.totalWarn} | ${report.summary.passedWarn} | ${warnFail} ${warnFail > 0 ? '[WARN]' : ''} |`)
  lines.push('')

  if (report.summary.criticalFailures.length > 0) {
    lines.push('## CRITICAL 未通过项')
    for (const id of report.summary.criticalFailures) {
      lines.push(`- ${id}`)
    }
    lines.push('')
  }

  for (const [category, metrics] of Object.entries(report.metrics)) {
    if ((metrics as MetricResult[]).length === 0) continue
    lines.push(`## ${category} 指标`)
    lines.push('| 指标 | 值 | 阈值 | 级别 | 状态 |')
    lines.push('|---|---|---|---|---|')
    for (const m of metrics as MetricResult[]) {
      lines.push(`| ${m.name} | ${m.value} | ${m.threshold ?? '-'} | ${m.severity} | ${STATUS_TEXT[m.result]} |`)
    }
    lines.push('')
  }

  if (report.cases.length > 0) {
    lines.push('## 逐 case 摘要')
    lines.push('| ID | 组 | 提问 | 回答（节选）| 命中 | 工具 | 耗时 | 状态 |')
    lines.push('|---|---|---|---|---|---|---|---|')
    for (const c of report.cases) {
      lines.push(`| ${c.id} | ${c.group} | ${truncate(c.question, 30)} | ${excerpt(c.answer, opts)} | ${formatHits(c)} | ${c.toolCalls.join('+') || '-'} | ${(c.latencyMs / 1000).toFixed(1)}s | ${STATUS_TEXT[c.result]} |`)
    }
    lines.push('')
    lines.push('> 完整回答 / judge reasoning / trace 请打开 `viewer.html` 加载本 JSON 查看。')
  }

  return lines.join('\n')
}

function excerpt(s: string, opts: Options): string {
  if (!opts.excerptAnswers) return s.replace(/\|/g, '\\|')
  const trimmed = s.length > opts.excerptLength ? s.slice(0, opts.excerptLength) + '...' : s
  return trimmed.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '...' : s
}

function formatHits(c: CaseResult): string {
  if (c.factsHitRate === undefined) return '-'
  const total = c.mustHaveHits.length + c.mustHaveMisses.length
  return `${c.mustHaveHits.length}/${total}`
}
