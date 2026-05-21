import { readFileSync } from 'node:fs'
import type { LegacyPrismaClient, NewPrismaClient } from '../clients'
import { log, warn } from '../logger'
import { parseExceptionCounts, rowCountVerdict } from './helpers'

interface Counter {
  count: (args?: unknown) => Promise<number>
}

/** [校验标签, 旧库 delegate, 新库 delegate, 异常清单中的表名] */
type Pair = [string, Counter, Counter, string]

export interface RowCountReport {
  label: string
  status: 'ok' | 'mismatch' | 'info'
  detail: string
}

/**
 * 行数校验。A 类表严格判定；B 类表（caseMaterials/orders/paymentTransactions/textContentRecords）
 * 因拆并行/合成行只做 info 展示，由运维结合 detail 判断。
 */
export async function verifyRowCounts(
  legacy: LegacyPrismaClient,
  next: NewPrismaClient,
  exceptionsCsvPath: string,
): Promise<RowCountReport[]> {
  let skipped: Map<string, number>
  try {
    skipped = parseExceptionCounts(readFileSync(exceptionsCsvPath, 'utf8'))
  } catch {
    warn(`[verify] 未找到异常清单 ${exceptionsCsvPath}，跳过数按 0 计`)
    skipped = new Map()
  }

  const L = legacy as any
  const N = next as any

  // A 类：严格判定
  const strictPairs: Pair[] = [
    ['system_configs', L.systemConfigs, N.systemConfigs, 'systemConfigs'],
    ['users', L.users, N.users, 'users'],
    ['oss_files', L.ossFiles, N.ossFiles, 'ossFiles'],
    ['asr_tasks', L.asrTasks, N.asrTasks, 'asrTasks'],
    ['asr_records', L.asrRecords, N.asrRecords, 'asrRecords'],
    ['doc_recognition_records', L.docRecognitionRecords, N.docRecognitionRecords, 'docRecognitionRecords'],
    ['image_recognition_records', L.imageRecognitionRecords, N.imageRecognitionRecords, 'imageRecognitionRecords'],
    ['cases', L.cases, N.cases, 'cases'],
    ['user_memberships', L.userMemberships, N.userMemberships, 'userMemberships'],
    ['membership_upgrade_records', L.membershipUpgradeRecords, N.membershipUpgradeRecords, 'membershipUpgradeRecords'],
    ['point_records', L.pointRecords, N.pointRecords, 'pointRecords'],
    ['point_consumption_records', L.pointConsumptionRecords, N.pointConsumptionRecords, 'pointConsumptionRecords'],
    ['user_benefits', L.userBenefits, N.userBenefits, 'userBenefits'],
    ['redemption_codes', L.redemptionCodes, N.redemptionCodes, 'redemptionCodes'],
    ['redemption_records', L.redemptionRecords, N.redemptionRecords, 'redemptionRecords'],
  ]

  const reports: RowCountReport[] = []
  for (const [label, oldD, newD, exTable] of strictPairs) {
    const oc = await oldD.count()
    const nc = await newD.count()
    const v = rowCountVerdict(oc, nc, skipped.get(exTable) ?? 0)
    reports.push({ label, status: v.status, detail: v.detail })
  }

  // case_sessions / B 类：info 展示（衍生行 / 拆并 / 合成导致行数不严格相等）
  const caseSessionsOld = await L.caseSessions.count()
  const caseSessionsNew = await N.caseSessions.count()
  reports.push({
    label: 'case_sessions（含衍生 legacy 会话）',
    status: 'info',
    detail: `旧 ${caseSessionsOld} / 新 ${caseSessionsNew}（新 = 旧迁移 + 为无 sessionId 的历史分析衍生的 legacy 会话）`,
  })
  // case_analyses 分流：真·分析留 case_analyses，文书生成 → documentDrafts 自由文书，当事人提取记录丢弃
  const analysesOld = await L.caseAnalyses.count()
  const analysesNew = await N.caseAnalyses.count()
  const freeformNew = await N.documentDrafts.count({ where: { mode: 'freeform' } })
  const partyOld = await L.caseAnalyses.count({ where: { analysisType: { in: ['plaintiff', 'defendant'] } } })
  const analysesDiff = analysesOld - analysesNew - freeformNew - partyOld
  reports.push({
    label: 'case_analyses（分流：真分析 / 文书 / 当事人）',
    status: analysesDiff === 0 ? 'ok' : 'info',
    detail: `旧 ${analysesOld} = 新 case_analyses ${analysesNew} + 文书自由稿 ${freeformNew} + 当事人记录(丢弃) ${partyOld}`
      + (analysesDiff === 0 ? '' : `，差额 ${analysesDiff}（外键失配跳过，见异常清单）`),
  })
  const caseMaterialsOld = await L.caseMaterials.count()
  const caseMaterialsNew = await N.caseMaterials.count()
  const derivedContentMaterials = await N.caseMaterials.count({ where: { type: 1, name: '案件描述' } })
  reports.push({
    label: 'case_materials（B 类）',
    status: 'info',
    detail: `旧 ${caseMaterialsOld} / 新 ${caseMaterialsNew}（= 旧迁移 + 派生「案件描述」材料 ${derivedContentMaterials}；跳过 type=5 视频）`,
  })
  const textNew = await N.textContentRecords.count()
  const textTypeOneOld = await L.caseMaterials.count({ where: { type: 1 } })
  reports.push({
    label: 'text_content_records（B 类衍生）',
    status: 'info',
    detail: `新 ${textNew}（≈ 旧 type=1 材料 ${textTypeOneOld} + 派生「案件描述」${derivedContentMaterials}）`,
  })
  const ordersOld = await L.paymentOrders.count()
  const ordersNew = await N.orders.count()
  reports.push({
    label: 'orders（B 类）',
    status: 'info',
    detail: `旧 payment_orders ${ordersOld} / 新 orders ${ordersNew}`,
  })
  const txOld = await L.paymentTransactions.count()
  const txNew = await N.paymentTransactions.count()
  reports.push({
    label: 'payment_transactions（B 类，含合成行）',
    status: 'info',
    detail: `旧 ${txOld} / 新 ${txNew}（新 = 旧迁移 + 合成补充）`,
  })

  log('--- 行数校验 ---')
  for (const r of reports) {
    const line = `[${r.status.toUpperCase()}] ${r.label} — ${r.detail}`
    if (r.status === 'mismatch') warn(line)
    else log(line)
  }
  return reports
}
