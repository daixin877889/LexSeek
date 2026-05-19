import type { LegacyPrismaClient, NewPrismaClient } from '../clients'
import { log, warn } from '../logger'

export interface AggregateReport {
  label: string
  status: 'ok' | 'mismatch'
  detail: string
}

/** 关键业务聚合值新旧一致性（设计文档 §13 校验 4） */
export async function verifyAggregates(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
): Promise<AggregateReport[]> {
  const L = legacy as any
  const N = next as any
  const reports: AggregateReport[] = []

  // 1. 订单总金额（旧 payment_orders.amount 之和 vs 新 orders.amount 之和）
  const oldAmount = await L.paymentOrders.aggregate({ _sum: { amount: true } })
  const newAmount = await N.orders.aggregate({ _sum: { amount: true } })
  const oa = Number(oldAmount._sum.amount ?? 0)
  const na = Number(newAmount._sum.amount ?? 0)
  reports.push({
    label: '订单总金额',
    status: oa === na ? 'ok' : 'mismatch',
    detail: `旧 ${oa} / 新 ${na}（若有订单因 productId 无法确定被跳过则会不等，对照异常清单）`,
  })

  // 2. 积分剩余总量（point_records.remaining 之和）
  const oldRemain = await L.pointRecords.aggregate({ _sum: { remaining: true } })
  const newRemain = await N.pointRecords.aggregate({ _sum: { remaining: true } })
  const or = Number(oldRemain._sum.remaining ?? 0)
  const nr = Number(newRemain._sum.remaining ?? 0)
  reports.push({
    label: '积分剩余总量',
    status: or === nr ? 'ok' : 'mismatch',
    detail: `旧 ${or} / 新 ${nr}`,
  })

  // 3. 案件分析记录总数（新 ≤ 旧；差额为 analysisType 无匹配节点而跳过的）
  const oldAnalyses = await L.caseAnalyses.count()
  const newAnalyses = await N.caseAnalyses.count()
  reports.push({
    label: '案件分析记录数',
    status: oldAnalyses >= newAnalyses ? 'ok' : 'mismatch',
    detail: `旧 ${oldAnalyses} / 新 ${newAnalyses}（新 ≤ 旧；差额为分流到 documentDrafts 的文书与丢弃的当事人记录，详见行数校验）`,
  })

  log('--- 业务聚合校验 ---')
  for (const r of reports) {
    const line = `[${r.status.toUpperCase()}] ${r.label} — ${r.detail}`
    if (r.status === 'mismatch') warn(line)
    else log(line)
  }
  return reports
}
