import type { LegacyPrismaClient, NewPrismaClient } from '../clients'
import { log, warn } from '../logger'

export interface SampleReport {
  label: string
  status: 'ok' | 'mismatch'
  detail: string
}

/** 在 [1, maxId] 内取 n 个随机 id */
function pickIds(maxId: number, n: number): number[] {
  const ids = new Set<number>()
  while (ids.size < Math.min(n, maxId)) {
    ids.add(1 + Math.floor(Math.random() * maxId))
  }
  return [...ids]
}

/**
 * 抽样内容校验（设计文档 §13 校验 3）：对 users / cases 抽样，
 * 逐字段比对旧→新关键字段是否符合转换规则。
 */
export async function verifySamples(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
  sampleSize = 20,
): Promise<SampleReport[]> {
  const L = legacy as any
  const N = next as any
  const reports: SampleReport[] = []

  // users：phone / name 直拷应一致
  const userMax = (await L.users.aggregate({ _max: { id: true } }))._max.id ?? 0
  let userMismatch = 0
  for (const id of pickIds(userMax, sampleSize)) {
    const o = await L.users.findUnique({ where: { id } })
    if (!o) continue
    const n = await N.users.findUnique({ where: { id } })
    if (!n || n.phone !== o.phone || n.name !== o.name) userMismatch++
  }
  reports.push({
    label: `users 抽样（${sampleSize} 条）`,
    status: userMismatch === 0 ? 'ok' : 'mismatch',
    detail: userMismatch === 0 ? 'phone/name 全部一致' : `${userMismatch} 条不一致`,
  })

  // cases：title 直拷一致、stance 应为默认 'plaintiff'
  const caseMax = (await L.cases.aggregate({ _max: { id: true } }))._max.id ?? 0
  let caseMismatch = 0
  for (const id of pickIds(caseMax, sampleSize)) {
    const o = await L.cases.findUnique({ where: { id } })
    if (!o) continue
    const n = await N.cases.findUnique({ where: { id } })
    // 旧 case 可能因 caseTypeId 无法重映射被跳过——新库无此行属正常，不计 mismatch
    if (n && (n.title !== o.title || n.stance !== 'plaintiff')) caseMismatch++
  }
  reports.push({
    label: `cases 抽样（${sampleSize} 条）`,
    status: caseMismatch === 0 ? 'ok' : 'mismatch',
    detail: caseMismatch === 0 ? 'title 一致、stance 为默认值' : `${caseMismatch} 条不一致`,
  })

  log('--- 抽样内容校验 ---')
  for (const r of reports) {
    const line = `[${r.status.toUpperCase()}] ${r.label} — ${r.detail}`
    if (r.status === 'mismatch') warn(line)
    else log(line)
  }
  return reports
}
