import { z } from 'zod'
import { retrieveWithReranking } from '~~/server/services/memory/retrieveWithReranking'
import { createSimpleTool, type ToolDefinition } from './types'
import { INIT_ANALYSIS_MODULES } from '#shared/types/initAnalysis'

/**
 * 分析模块名权威源：复用 shared/types/initAnalysis.ts 的 INIT_ANALYSIS_MODULES。
 * 新增 / 重命名模块只需改 INIT_ANALYSIS_MODULES，本工具自动跟进，无须维护副本。
 *
 * 历史踩坑：早期 description 写了 risk_assessment / claim_analysis / fact_review 等
 * 库里不存在的 type，LLM 跟着瞎写导致 0 命中。现在改为枚举强约束 + description 中
 * 自动列出真实可选值。
 */
const VALID_ANALYSIS_TYPES = INIT_ANALYSIS_MODULES.map(m => m.name) as [string, ...string[]]
const ANALYSIS_TYPE_HINT = INIT_ANALYSIS_MODULES.map(m => `${m.name}（${m.title}）`).join('、')

// query 改为 optional + 运行时检查：避免 LLM 漏传 query 时 zod 校验直接抛错
// 导致 LangGraph 在 superstep 聚合多个并行工具失败为 AggregateError，无法 retry。
// 现在 schema 校验通过后由处理函数返回结构化 error，LLM 看到后可重试并补 query。
const schema = z.object({
    query: z.string().optional().describe('检索关键词或问题（必填，缺失会返回错误提示让 LLM 补全）'),
    analysis_type: z.enum(VALID_ANALYSIS_TYPES).optional()
        .describe(`限定分析模块类型，仅接受以下值：${VALID_ANALYSIS_TYPES.join(' / ')}。不传则跨所有模块检索。`),
    include_all_versions: z.boolean().default(false)
        .describe('是否返回非生效版本（对比历史版本时用）'),
    top_k: z.coerce.number().default(5),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'search_case_analysis',
    description: `检索当前案件已完成的分析报告片段（默认只返回生效版本）。当需要引用某个模块的具体分析细节时调用。`
        + ` analysis_type 仅接受以下固定值：${ANALYSIS_TYPE_HINT}。`
        + ` 不要传其它值（如 risk_assessment / fact_review / claim_analysis 等），否则会被拒绝。`
        + ` 不确定属于哪个模块时直接省略 analysis_type，跨模块检索由召回排序决定。`,
    schema,
}

export const createTool = createSimpleTool(
    toolDefinition,
    async ({ query, analysis_type, include_all_versions, top_k }, ctx) => {
        if (!ctx.caseId) return { error: '未绑定案件，无法检索分析产物' }
        // query 缺失或空白：返回结构化 error 让 LLM 重试（不抛 schema 校验错）
        if (!query || !query.trim()) {
            return { error: '缺少 query 参数：请提供检索关键词或问题，例如 "原告诉讼请求" 或 "违约金条款"' }
        }

        const metadataFilter: Record<string, string | number | boolean> = { caseId: ctx.caseId }
        if (analysis_type) metadataFilter.analysisType = analysis_type
        if (!include_all_versions) metadataFilter.isActive = true

        const hits = await retrieveWithReranking({
            tableName: 'case_analysis_embeddings',
            query,
            topK: top_k,
            metadataFilter,
            filterInvalidated: false,
            enableVersionScoring: false,
        })

        return hits.map((h) => {
            const meta = h.metadata as unknown as Record<string, unknown>
            return {
                id: h.id,
                text: h.text,
                score: Math.round(h.score * 1000) / 1000,
                analysisType: meta.analysisType,
                version: meta.version,
            }
        })
    },
    { errorLabel: '分析产物检索' },
)
