import { createHash } from 'node:crypto'
import { buildContextSegments } from '~~/server/services/workflow/context/moduleContextBuilder'
import { writeMemoryService } from '~~/server/services/memory/memory.service'
import { countTokensSync } from '~~/server/utils/tokenCounter'
import { prisma } from '~~/server/utils/db'
import type { MetricResult } from '../report/reportTypes'

/** 复用 stab-prompt-hash 调用结果，顺便采集 systemPromptTokens 供 cost 聚合用 */
export interface PromptHashResult {
  metric: MetricResult
  systemPromptTokens: number
}

/**
 * stab-prompt-hash —— 同案件同 agentName 两次调 buildContextSegments，
 * sha256(roleAndFlow + caseProfile + moduleSummaries) 应字节相等。
 *
 * dynamicContext 含 ⑤ 段动态召回，预期不稳定，不进 hash。
 *
 * 顺便用 4 段拼串走 tiktoken 算 systemPromptTokens（spec §3.2 原意），
 * 给 cost.systemPromptTokensAvg 用，避免 Task 14/15 重复跑一次 buildContextSegments。
 */
export async function checkPromptHashStability(
  caseId: number,
  agentName: string,
): Promise<PromptHashResult> {
  const fixedQuery = '__eval_stability_probe__'
  const a = await buildContextSegments({ caseId, agentName, userQuery: fixedQuery })
  const b = await buildContextSegments({ caseId, agentName, userQuery: fixedQuery })

  const concatHash = (s: typeof a) =>
    (s.roleAndFlow ?? '') + (s.caseProfile ?? '') + (s.moduleSummaries ?? '')
  const ha = createHash('sha256').update(concatHash(a)).digest('hex')
  const hb = createHash('sha256').update(concatHash(b)).digest('hex')

  // 4 段拼串走 tiktoken
  const fourSegs =
    (a.roleAndFlow ?? '') +
    (a.caseProfile ?? '') +
    (a.moduleSummaries ?? '') +
    (a.dynamicContext ?? '')
  const systemPromptTokens = countTokensSync(fourSegs)

  const metric: MetricResult = {
    name: 'stab-prompt-hash',
    value: ha === hb,
    threshold: 'sha256(seg ①②③) 两次相等',
    severity: 'CRITICAL',
    result: ha === hb ? 'pass' : 'fail',
    detail: ha === hb ? ha.slice(0, 16) : `mismatch ${ha.slice(0, 8)} vs ${hb.slice(0, 8)}`,
  }
  return { metric, systemPromptTokens }
}

/**
 * stab-switch-active-atomic —— 同 caseId 同 analysisType 应有且仅有一行 isActive=true；
 * 同 caseAnalysisId 的 case_analysis_embeddings.metadata.isActive 全部同步为 true。
 */
export async function checkSwitchActiveAtomic(caseId: number): Promise<MetricResult> {
  const analyses = await prisma.caseAnalyses.findMany({
    where: { caseId, deletedAt: null },
    select: { id: true, analysisType: true, isActive: true },
  })

  const byType = new Map<string, typeof analyses>()
  for (const a of analyses) {
    if (!byType.has(a.analysisType)) byType.set(a.analysisType, [])
    byType.get(a.analysisType)!.push(a)
  }

  const issues: string[] = []
  for (const [type, list] of byType) {
    const actives = list.filter(a => a.isActive)
    if (actives.length !== 1) {
      issues.push(`${type}: active=${actives.length}（期望 1）`)
      continue
    }
    const activeId = actives[0]!.id
    const embeddings = await prisma.$queryRawUnsafe<{ id: string; metadata: unknown }[]>(
      `SELECT id, metadata FROM case_analysis_embeddings WHERE metadata->>'caseAnalysisId' = $1`,
      activeId,
    )
    if (embeddings.length === 0) continue
    const allActive = embeddings.every(e => {
      const meta = e.metadata as Record<string, unknown> | null
      return meta?.isActive === true
    })
    if (!allActive) issues.push(`${type}: embedding metadata.isActive 不一致`)
  }

  return {
    name: 'stab-switch-active-atomic',
    value: issues.length === 0,
    threshold: '同 type isActive=1 + embeddings metadata 同步',
    severity: 'CRITICAL',
    result: issues.length === 0 ? 'pass' : 'fail',
    detail: issues.length === 0 ? 'ok' : issues.join('; '),
  }
}

/**
 * stab-old-data-graceful —— 旧数据兼容（fixture 中存在 summary IS NULL 的 legacy 分析时触发）：
 *   ① search_case_analysis 工具调用不抛异常
 *   ② moduleContextBuilder 渲染含 legacy 的案件不出现 null/undefined 字面量
 */
export async function checkOldDataGraceful(caseId: number): Promise<MetricResult> {
  const issues: string[] = []

  // 1. search_case_analysis tool —— 真实导出 createTool(context: ToolContext)
  try {
    const toolModule = await import(
      '~~/server/services/workflow/tools/search_case_analysis.tool'
    )
    const create = toolModule.createTool
    if (typeof create !== 'function') {
      issues.push('search_case_analysis.tool 未导出 createTool')
    }
    else {
      // ToolContext 真实字段：caseId / userId / sessionId / threadId 等；
      // 只用 caseId 即可（tool 内部仅检查 context.caseId）
      const tool = create({ caseId } as Parameters<typeof create>[0])
      try {
        await tool.invoke({
          query: 'legacy',
          include_all_versions: false,
          top_k: 5,
        })
      }
      catch (innerE) {
        const msg = innerE instanceof Error ? innerE.message : String(innerE)
        issues.push(`search_case_analysis.invoke 抛异常：${msg}`)
      }
    }
  }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    issues.push(`search_case_analysis.tool 模块加载失败：${msg}`)
  }

  // 2. moduleContextBuilder 渲染
  try {
    const segs = await buildContextSegments({
      caseId,
      agentName: 'init',
      userQuery: '__eval_legacy_probe__',
    })
    const concat = (segs.moduleSummaries ?? '') + (segs.caseProfile ?? '')
    if (concat.includes('null') || concat.includes('undefined')) {
      issues.push('moduleSummaries/caseProfile 含 null/undefined 字面量')
    }
  }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    issues.push(`buildContextSegments 抛异常：${msg}`)
  }

  return {
    name: 'stab-old-data-graceful',
    value: issues.length === 0,
    threshold: '工具不抛异常 + 段不含 null/undefined',
    severity: 'CRITICAL',
    result: issues.length === 0 ? 'pass' : 'fail',
    detail: issues.length === 0 ? 'ok' : issues.join('; '),
  }
}

/**
 * stab-version-chain —— 直接测 writeMemoryService 的版本链切换逻辑（spec §3.5 / §3.6）：
 *   ① 第 1 次写入 subjectKey=PROBE → active 唯一
 *   ② 第 2 次写入同 subjectKey → 旧条 invalidatedAt 被设置 + active 唯一指向新条
 *
 * 不依赖 LLM 抽取（旧实现把这个能力混在 ex-02 transcript 评测里，LLM 漏抽
 * 就 FAIL 误报 service 有 bug）。本探针清理探针记录后退出，不污染 fixture。
 */
export async function checkVersionChain(caseId: number): Promise<MetricResult> {
  const PROBE_KEY = '__eval_version_chain_probe__'
  const issues: string[] = []
  const writtenIds: string[] = []

  try {
    const r1 = await writeMemoryService({
      caseId,
      kind: 'fact',
      text: 'eval probe v1',
      subjectKey: PROBE_KEY,
      confidence: 0.9,
      source: 'manual',
    })
    writtenIds.push(r1.id)

    const actives1 = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM case_memories
        WHERE (metadata->>'caseId')::int = $1
          AND metadata->>'subjectKey' = $2
          AND (metadata->>'invalidatedAt') IS NULL`,
      caseId,
      PROBE_KEY,
    )
    if (actives1.length !== 1) {
      issues.push(`第 1 次写入后 active=${actives1.length}，期望 1`)
    }

    const r2 = await writeMemoryService({
      caseId,
      kind: 'fact',
      text: 'eval probe v2',
      subjectKey: PROBE_KEY,
      confidence: 0.9,
      source: 'manual',
    })
    writtenIds.push(r2.id)

    const actives2 = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM case_memories
        WHERE (metadata->>'caseId')::int = $1
          AND metadata->>'subjectKey' = $2
          AND (metadata->>'invalidatedAt') IS NULL`,
      caseId,
      PROBE_KEY,
    )
    if (actives2.length !== 1) {
      issues.push(`第 2 次写入后 active=${actives2.length}，期望 1`)
    } else if (actives2[0]!.id !== r2.id) {
      issues.push(`第 2 次写入后 active 不指向新记录`)
    }

    const oldStillActive = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM case_memories
        WHERE id = $1::uuid
          AND (metadata->>'invalidatedAt') IS NULL`,
      r1.id,
    )
    if (oldStillActive.length > 0) {
      issues.push(`第 1 条记录未被 invalidate`)
    }
  } finally {
    for (const id of writtenIds) {
      try {
        await prisma.$executeRawUnsafe(
          `DELETE FROM case_memories WHERE id = $1::uuid`,
          id,
        )
      } catch {
        // 清理失败不影响断言结果
      }
    }
  }

  return {
    name: 'stab-version-chain',
    value: issues.length === 0,
    threshold: '同 subjectKey 第 2 次写入后旧条 invalidate 且 active 唯一指向新条',
    severity: 'CRITICAL',
    result: issues.length === 0 ? 'pass' : 'fail',
    detail: issues.length === 0 ? 'ok' : issues.join('; '),
  }
}

/**
 * stab-profile-key-order —— buildCaseProfileJson 输出的 key 顺序应等于字典序排序后的顺序。
 * 由 runEval 在拿到 profile 对象（如解析 caseProfile 段中的 JSON）后调用。
 */
export function checkProfileKeyOrder(profile: Record<string, unknown>): MetricResult {
  const keys = Object.keys(profile)
  const sorted = [...keys].sort()
  const ok = JSON.stringify(keys) === JSON.stringify(sorted)
  return {
    name: 'stab-profile-key-order',
    value: ok,
    threshold: '字典序',
    severity: 'WARN',
    result: ok ? 'pass' : 'fail',
    detail: ok ? 'ok' : `keys=${keys.join(',')}`,
  }
}
