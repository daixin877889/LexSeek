import { z } from 'zod'
import { retrieveWithReranking } from '~~/server/services/memory/retrieveWithReranking'
import { createSimpleTool, type ToolDefinition } from './types'

const schema = z.object({
    query: z.string().describe('检索关键词或问题'),
    analysis_type: z.string().optional().describe('限定分析模块类型，如 "risk_assessment" / "claim_analysis"'),
    include_all_versions: z.boolean().default(false)
        .describe('是否返回非生效版本（对比历史版本时用）'),
    top_k: z.number().default(5),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'search_case_analysis',
    description: '检索当前案件已完成的分析报告片段（诉请分析、风险评估等模块的正文）。默认只返回生效版本。当需要引用某个模块的具体分析细节时调用。analysis_type 可选值如：risk_assessment、claim_analysis、evidence_analysis、defense_strategy 等，具体以当前案件已完成的模块名为准。',
    schema,
}

export const createTool = createSimpleTool(
    toolDefinition,
    async ({ query, analysis_type, include_all_versions, top_k }, ctx) => {
        if (!ctx.caseId) return { error: '未绑定案件，无法检索分析产物' }

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
