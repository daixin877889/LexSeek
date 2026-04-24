import type { CachedPrompt } from '#shared/types/prompt'
import { getMaterialListWithSummariesService } from '../../material/materialPipeline.service'
import { recallMemoryService } from '../../memory/memory.service'

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
  caseId: number
  agentName: string
  userQuery: string
  roleAndFlowTemplate?: string
}

/**
 * 构建 5 段式 prompt 的 2-5 段。
 * caseProfile JSON 字段字典序序列化，保证 cache 命中字节级稳定。
 */
export async function buildContextSegments(params: Params): Promise<ContextSegments> {
  const { caseId, agentName, userQuery, roleAndFlowTemplate } = params

  const [caseRecord, activeAnalyses, materials, memoryHits] = await Promise.all([
    prisma.cases.findUnique({
      where: { id: caseId },
      select: {
        id: true, title: true, caseTypeId: true, status: true,
        plaintiff: true, defendant: true, summary: true,
        courtName: true,
        firstInstanceCaseNo: true, secondInstanceCaseNo: true,
        firstInstanceJudge: true, secondInstanceJudge: true,
      },
    }),
    prisma.caseAnalyses.findMany({
      where: { caseId, isActive: true, deletedAt: null, NOT: { analysisType: agentName } },
      select: { analysisType: true, summary: true },
      orderBy: { analysisType: 'asc' },
    }),
    getMaterialListWithSummariesService(caseId).catch(() => []),
    recallMemoryService({ caseId, query: userQuery, topK: 5 }).catch(() => []),
  ])

  if (!caseRecord) {
    return { roleAndFlow: '', caseProfile: '', moduleSummaries: '', dynamicContext: '' }
  }

  // ② 角色+流程
  const roleAndFlow = roleAndFlowTemplate ?? ''

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
    status: caseRecord.status,
    summary: caseRecord.summary ?? '',
    title: caseRecord.title,
  }
  const caseProfile = `## 案件档案\n\`\`\`json\n${JSON.stringify(profile, Object.keys(profile).sort(), 2)}\n\`\`\``

  // ④ 已完成模块摘要（只塞 summary，不塞全文；全文由 search_case_analysis 工具按需召回）
  let moduleSummaries = ''
  if (activeAnalyses.length > 0) {
    const lines = ['## 已完成分析模块（全文请调用 search_case_analysis 工具）']
    for (const a of activeAnalyses) {
      if (!a.summary) continue // 无摘要的旧版本跳过（Q4.3 B 旧数据不补）
      lines.push(`### ${a.analysisType}\n${a.summary}`)
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
    dynLines.push('\n## 案件材料清单（全文请调用 search_case_materials 工具）')
    for (const mat of materials) {
      const typeLabel = ({ 1: '文本', 2: '文档', 3: '图片', 4: '音频' } as const)[mat.type as 1|2|3|4] ?? '其它'
      dynLines.push(`- **${mat.name}**（${typeLabel}）— ${mat.summary ?? '（摘要生成中）'}`)
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
