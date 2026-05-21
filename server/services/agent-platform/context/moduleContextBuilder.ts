import { SystemMessage } from '@langchain/core/messages'
import dayjs from 'dayjs'
import { CaseMaterialTypeText, type CaseMaterialType } from '#shared/types/case'
import { MaterialStatus } from '#shared/types/material'
import type { CachedPrompt } from '#shared/types/prompt'
import { getMaterialListWithSummariesService, getSourceId } from '~~/server/services/material/materialPipeline.service'
import { recallMemoryService } from '~~/server/services/memory/memory.service'
import { cachedPromptToAnthropicContent, cachedPromptToPlainText } from '~~/server/services/node/chatModelFactory'

/**
 * LLM 提示词专用状态文案，与 shared/types/material.ts 的 MaterialStatusText 区分：
 * UI 用"处理中/已完成/处理失败"，LLM 提示词用"识别中/已识别/识别失败"贴合
 * OCR/ASR 业务概念，让 LLM 一眼看出"哪些材料还查不了全文"。
 */
const STATUS_LABEL_MAP: Record<MaterialStatus, string> = {
  [MaterialStatus.PENDING]: '待识别',
  [MaterialStatus.PROCESSING]: '识别中',
  [MaterialStatus.COMPLETED]: '已识别',
  [MaterialStatus.FAILED]: '识别失败',
}

/**
 * 按材料 status 与 summary 渲染材料行尾的描述文字。
 * - COMPLETED + summary 非空：直接返回 summary
 * - COMPLETED + summary 空：返回"（摘要生成中）"
 * - PROCESSING / PENDING / FAILED：返回对应状态提示，告诉 LLM 暂不可查全文
 */
function renderMaterialSummary(status: MaterialStatus, summary: string | null): string {
  if (summary) return summary
  switch (status) {
    case MaterialStatus.COMPLETED: return '（摘要生成中）'
    case MaterialStatus.PROCESSING: return '（识别中，待识别完成后可查全文）'
    case MaterialStatus.PENDING: return '（待识别，上传中或排队中）'
    case MaterialStatus.FAILED: return '（识别失败，可联系客服重新处理）'
  }
}

export interface ContextSegments {
  /** 角色 + 流程规范（来自 NodeConfig） */
  roleAndFlow: string
  /** 案件档案 JSON（可缓存 1h） */
  caseProfile: string
  /** 已完成模块摘要（可缓存 5m） */
  moduleSummaries: string
  /** 召回记忆 + 材料清单（动态，不缓存） */
  dynamicContext: string
}

interface Params {
  caseId: number | null
  agentName: string
  userQuery: string
  roleAndFlowTemplate?: string
}

/**
 * 构建 5 段式 prompt 的 2-5 段。
 * caseProfile JSON 字段字典序序列化，保证 cache 命中字节级稳定。
 *
 * caseId === null 表示无案件上下文（如 assistantAgent 等通用助手场景）：
 * - 跳过案件档案 / 模块摘要 / 材料清单 / 记忆召回查询
 * - 仅返回 roleAndFlow 段（仍走 cache，统一架构）
 */
export async function buildContextSegments(params: Params): Promise<ContextSegments> {
  const { caseId, agentName, userQuery, roleAndFlowTemplate } = params

  if (caseId === null) {
    return {
      roleAndFlow: roleAndFlowTemplate ?? '',
      caseProfile: '',
      moduleSummaries: '',
      dynamicContext: '',
    }
  }

  // 空 query 短路 recallMemoryService：中断恢复 / 重连时 userQuery 为 ''，
  // 对空串调 embedQuery + BM25 + vector + rerank 全跑一遍是浪费且召回必然空
  const memoryRecall = userQuery.trim().length === 0
    ? Promise.resolve([])
    : recallMemoryService({ caseId, query: userQuery, topK: 5 }).catch(() => [])

  const [caseRecord, activeAnalyses, materials, memoryHits] = await Promise.all([
    prisma.cases.findUnique({
      where: { id: caseId },
      select: {
        id: true, title: true, caseTypeId: true, status: true,
        plaintiff: true, defendant: true, summary: true,
        courtName: true,
        firstInstanceCaseNo: true, secondInstanceCaseNo: true,
        firstInstanceJudge: true, secondInstanceJudge: true,
        stance: true,
      },
    }),
    prisma.caseAnalyses.findMany({
      where: { caseId, isActive: true, deletedAt: null, NOT: { analysisType: agentName } },
      select: {
        analysisType: true,
        summary: true,
        version: true,
        updatedAt: true,
        analysisResult: true,
      },
      orderBy: { analysisType: 'asc' },
    }),
    getMaterialListWithSummariesService(caseId).catch(() => []),
    memoryRecall,
  ])

  if (!caseRecord) {
    return { roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '' }
  }

  // ② 角色+流程（追加立场使用说明，让分析子代理按 caseProfile.stance 切换视角）
  const stanceGuide = `\n\n## 立场约束\n请以案件档案中 \`stance\` 字段作为分析视角：\`plaintiff\`=站在原告角度论证主张并反驳被告抗辩；\`defendant\`=站在被告角度组织抗辩并反驳原告主张；\`neutral\`=客观中立同时分析双方立场。`
  const roleAndFlow = (roleAndFlowTemplate ?? '') + stanceGuide

  // ③ 案件档案（字段字典序 → 稳定 cache）
  const profile = {
    caseId: caseRecord.id,
    caseTypeId: caseRecord.caseTypeId,
    courtName: caseRecord.courtName ?? '',
    defendant: (caseRecord.defendant as string[] | null) ?? [],
    firstInstanceCaseNo: caseRecord.firstInstanceCaseNo ?? '',
    firstInstanceJudge: caseRecord.firstInstanceJudge ?? '',
    plaintiff: (caseRecord.plaintiff as string[] | null) ?? [],
    secondInstanceCaseNo: caseRecord.secondInstanceCaseNo ?? '',
    secondInstanceJudge: caseRecord.secondInstanceJudge ?? '',
    stance: caseRecord.stance ?? 'plaintiff',
    status: caseRecord.status,
    summary: caseRecord.summary ?? '',
    title: caseRecord.title,
  }
  const caseProfile = `## 案件档案\n\`\`\`json\n${JSON.stringify(profile, Object.keys(profile).sort(), 2)}\n\`\`\``

  // ④ 已分析模块（当前激活版本）
  // - 不再因 summary 缺失整条跳过；summary 为 null 时降级用 analysisResult 前 500 字 + 标识
  // - 段头加 search_case_analysis 工具查询条件提示，让 LLM 知道工具参数怎么填
  let moduleSummaries = ''
  if (activeAnalyses.length > 0) {
    const lines = ['## 已分析模块（当前激活版本，全文请调用 search_case_analysis 工具，参数 analysis_type 填模块名 + query 填问题关键词）']
    for (const a of activeAnalyses) {
      const updatedAtStr = dayjs(a.updatedAt).format('YYYY-MM-DD HH:mm:ss')
      const header = `### ${a.analysisType}（v${a.version}，更新于 ${updatedAtStr}）`

      if (a.summary) {
        lines.push(`${header}\n${a.summary}`)
      }
      else if (a.analysisResult) {
        const excerpt = a.analysisResult.slice(0, 500)
        const tail = a.analysisResult.length > 500 ? '...' : ''
        lines.push(`${header}\n（暂无独立摘要，正文节选）\n${excerpt}${tail}`)
      }
      else {
        lines.push(`${header}\n（暂无内容）`)
      }
    }
    moduleSummaries = lines.length > 1 ? lines.join('\n\n') : ''
  }

  // ⑤ 动态：召回记忆 + 材料清单
  const dynLines: string[] = []
  if (memoryHits.length > 0) {
    dynLines.push('## 相关案件记忆')
    for (const m of memoryHits) dynLines.push(`- ${m.text}`)
  }
  if (materials.length > 0) {
    dynLines.push('\n## 案件材料清单（全文请调用 search_case_materials 工具，参数 sourceId 填下面括号中的值精确取该材料；或参数 query 填关键词跨材料搜索）')
    for (const mat of materials) {
      const typeLabel = CaseMaterialTypeText[mat.type as CaseMaterialType]
      const statusLabel = STATUS_LABEL_MAP[mat.status as MaterialStatus]
      const sourceId = getSourceId(mat)
      const summaryText = renderMaterialSummary(mat.status as MaterialStatus, mat.summary)
      dynLines.push(`- **${mat.name}**（${typeLabel}，sourceId=${sourceId ?? '未生成'}）— ${statusLabel} — ${summaryText}`)
    }
  }
  const dynamicContext = dynLines.join('\n')

  return { roleAndFlow, caseProfile, moduleSummaries, dynamicContext }
}

/**
 * 把 4 段映射为 CachedPrompt（Anthropic 两断点：1h + 5m）。
 */
export function toCachedPrompt(segs: ContextSegments): CachedPrompt {
  const out: CachedPrompt = []
  if (segs.roleAndFlow) out.push({ text: segs.roleAndFlow, cache: { ttl: '1h' } })
  if (segs.caseProfile) out.push({ text: segs.caseProfile, cache: { ttl: '1h' } })
  if (segs.moduleSummaries) out.push({ text: segs.moduleSummaries, cache: { ttl: '5m' } })
  if (segs.dynamicContext) out.push({ text: segs.dynamicContext })
  return out
}

export interface BuiltSystemPrompt {
  /** 5 段式上下文原始数据 */
  segments: ContextSegments
  /** 包装好的 SystemMessage（Anthropic 走 content blocks 保留 cache_control，其它走纯文本） */
  systemMessage: SystemMessage
  /** safetyTrim 中间件 token 计数用的纯文本拼接 */
  plainText: string
}

/**
 * 主 Agent caseMain（runtime.ts）/ caseModule（moduleAgent）/ documentMain
 * （documentMainAgent）已于 2026-05-05 改造为 SystemMessage 仅含 roleAndFlow
 * + caseContextSyncMiddleware 注入 4+2 段 HumanMessage 模式。三者通过 caseId=null
 * 退化路径仅复用本函数的"按 SDK 分流构造 SystemMessage（Anthropic 自动加 1h
 * cache_control）"能力。
 *
 * 当前使用本函数完整 5 段式拼装的调用方：
 * - subAgentToolFactory（ask_*_expert 子 Agent）
 * - runAnalysisSubAgent（案件分析子 Agent）
 * - contractReviewMainAgent（合同审查主 Agent，本次改造非目标范围 spec §2.2）
 * - assistantAgent（通用问答主 Agent，caseId 永远 null，本次改造非目标）
 *
 * 一站式构建 agent 的 SystemMessage：
 * buildContextSegments → toCachedPrompt → 按 sdkType 分流（anthropic content blocks
 * / plain text） → SystemMessage。
 */
export async function buildSystemPromptForAgent(
  modelSdkType: string,
  params: Params,
): Promise<BuiltSystemPrompt> {
  const segments = await buildContextSegments(params)
  const cached = toCachedPrompt(segments)
  const plainText = cachedPromptToPlainText(cached)
  const content = modelSdkType === 'anthropic'
    ? cachedPromptToAnthropicContent(cached)
    : plainText
  return {
    segments,
    systemMessage: new SystemMessage({ content: content as any }),
    plainText,
  }
}
