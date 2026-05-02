/**
 * 合同审查总览生成
 *
 * 接收所有风险点，调用 LLM 生成分档要点（highlights）和总评（overall），
 * 返回 ContractOverview 结构。
 *
 * - 0 条风险时直接返回默认，不调 LLM（省 token）
 * - 提示词从 DB 节点 `contractReviewSummarize` 的 system prompt 加载（运营可在后台热更新）
 * - LLM 返回不符合 schema 时抛错，调用方决定降级策略
 */
import { z } from 'zod'
import type { Risk, ContractOverview, Stance } from '#shared/types/contract'
import { renderContent } from '~~/server/services/node/prompt.service'
import { invokeNodeJson, warnUnreplacedTemplateVars } from './utils/llmInvokeJson'

// 宽进策略：LLM 超长 / 超多条目时自动截断，而不是让整个 summarize 直接失败
// 降级为"本合同识别到 N 条风险"兜底（用户看不到真正的 AI 总评）。
// 配合 prompt 里的字数上限提示，实际很少真的超限。
const highlightItem = z.object({
    text: z.string().max(200).transform(s => s.slice(0, 60)),
    riskId: z.string().optional().default(''),
})
const OverviewResponse = z.object({
    highlights: z.object({
        high: z.array(highlightItem).max(10).transform(arr => arr.slice(0, 5)),
        medium: z.array(highlightItem).max(10).transform(arr => arr.slice(0, 5)),
        low: z.array(highlightItem).max(10).transform(arr => arr.slice(0, 5)),
    }).partial().transform(h => ({
        high: h.high ?? [],
        medium: h.medium ?? [],
        low: h.low ?? [],
    })),
    overall: z.string().max(300).transform(s => s.slice(0, 120)),
})

const NODE_NAME = 'contractReviewSummarize'

export async function summarizeOverview(
    risks: Risk[],
    stance: Stance,
    contractType: string | null,
): Promise<ContractOverview> {
    if (risks.length === 0) {
        return {
            highlights: { high: [], medium: [], low: [] },
            overall: '本合同未识别到明显风险。',
        }
    }

    const data = await invokeNodeJson({
        nodeName: NODE_NAME,
        temperature: 0.3, // 略放松，让总评自然
        schema: OverviewResponse,
        buildPrompt: (template) => renderPromptTemplate(template, risks, stance, contractType),
        errorPrefix: 'summarizeOverview',
        logContext: { riskCount: risks.length, stance, contractType },
    })

    // UX-S2：LLM 可能返回空 riskId 或编造不存在的 riskId，前端点击要点时
    // emit focusRisk('') 静默失效。这里在服务端做"riskId 必须在 risks 里存在"
    // 的过滤：未命中的条目保留 text 但 riskId 设为空字符串，前端 OverviewPanel
    // 会据此置不可点样式（见对应 UI 修改）。
    const validIds = new Set(risks.map(r => String(r.id)))
    const cleanHighlights = (arr: typeof data.highlights.high) =>
        arr.map(item => ({
            text: item.text,
            riskId: validIds.has(String(item.riskId)) ? item.riskId : '',
        }))
    const cleaned: ContractOverview = {
        overall: data.overall,
        highlights: {
            high: cleanHighlights(data.highlights.high),
            medium: cleanHighlights(data.highlights.medium),
            low: cleanHighlights(data.highlights.low),
        },
    }

    // 诊断：统计 LLM 返回的无效 riskId 数量（≥1 说明 prompt 质量或模型能力需要关注）
    const allItems = [
        ...data.highlights.high,
        ...data.highlights.medium,
        ...data.highlights.low,
    ]
    const invalidCount = allItems.filter(i => !validIds.has(String(i.riskId))).length
    if (invalidCount > 0) {
        logger.warn('summarizeOverview: LLM 返回的 riskId 部分无效，已清空这些条目的 riskId', {
            invalidCount, totalCount: allItems.length,
        })
    }

    return cleaned
}

/**
 * 渲染 DB 模板：替换 {{stance}} / {{stanceLabel}} / {{contractType}} / {{riskList}} 占位符
 *
 * riskList 是长文本（每条 risk 一行），不适合直接放在模板的 variables 字段里——
 * variables 是 JSON 数组只做字段名声明；实际值在调用处拼接好再 renderContent。
 *
 * stanceLabel 是 stance 的中文标签（甲方/乙方/中立第三方），LLM 直接读中文比读英文 enum 准确。
 */
function renderPromptTemplate(
    template: string,
    risks: Risk[],
    stance: Stance,
    contractType: string | null,
): string {
    const riskList = risks
        .map(r => `${r.level.toUpperCase()} · ${r.id} · ${r.category} · ${r.problem}`)
        .join('\n')
    const stanceLabel = stance === 'partyA' ? '甲方' : stance === 'partyB' ? '乙方' : '中立第三方'
    const rendered = renderContent(template, {
        stance,
        stanceLabel,
        contractType: contractType ?? '合同',
        riskList,
    })
    warnUnreplacedTemplateVars(rendered, 'summarizeOverview')
    return rendered
}
