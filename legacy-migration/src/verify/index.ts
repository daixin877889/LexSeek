import { writeFileSync } from 'node:fs'
import type { LegacyPrismaClient, NewPrismaClient } from '../clients'
import { log } from '../logger'
import { verifyAggregates } from './aggregates'
import { verifyReferences } from './references'
import { verifyRowCounts } from './rowCounts'
import { verifySamples } from './samples'

/** 跑全部四类校验，汇总报告并落盘 */
export async function runVerify(legacy: LegacyPrismaClient, next: NewPrismaClient): Promise<void> {
  log('===== 迁移后数据校验开始 =====')
  const rowCounts = await verifyRowCounts(legacy, next, 'legacy-migration/reports/exceptions.csv')
  const aggregates = await verifyAggregates(legacy, next)
  const samples = await verifySamples(legacy, next)
  const references = await verifyReferences(next)

  const all = [
    ...rowCounts.map(r => ({ ...r, group: '行数' })),
    ...aggregates.map(r => ({ ...r, group: '聚合' })),
    ...samples.map(r => ({ ...r, group: '抽样' })),
    ...references.map(r => ({ ...r, group: '引用' })),
  ]
  const problems = all.filter(r => r.status === 'mismatch' || r.status === 'warn')

  const reportPath = 'legacy-migration/reports/verify.json'
  writeFileSync(reportPath, JSON.stringify(all, null, 2), 'utf8')
  log(`===== 校验完成：${all.length} 项，${problems.length} 项需关注，报告见 ${reportPath} =====`)
  if (problems.length > 0) {
    log('需关注项：')
    for (const p of problems) log(`  [${p.group}] ${p.label} — ${p.detail}`)
  }
}
