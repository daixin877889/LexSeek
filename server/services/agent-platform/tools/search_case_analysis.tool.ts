import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { retrieveWithReranking } from '~~/server/services/memory/retrieveWithReranking'
import type { ToolDefinition, ToolContext } from './types'

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

export function createTool(context: ToolContext) {
    return tool(
        async ({ query, analysis_type, include_all_versions, top_k }) => {
            if (!context.caseId) {
                return JSON.stringify({ error: '未绑定案件，无法检索分析产物' })
            }

            const metadataFilter: Record<string, string | number | boolean> = {
                caseId: context.caseId,
            }
            if (analysis_type) metadataFilter.analysisType = analysis_type
            if (!include_all_versions) metadataFilter.isActive = true

            try {
                const hits = await retrieveWithReranking({
                    tableName: 'case_analysis_embeddings',
                    query,
                    topK: top_k,
                    metadataFilter,
                    filterInvalidated: false,
                    enableVersionScoring: false,
                })

                return JSON.stringify(hits.map((h) => {
                    const meta = h.metadata as unknown as Record<string, unknown>
                    return {
                        id: h.id,
                        text: h.text,
                        score: Math.round(h.score * 1000) / 1000,
                        analysisType: meta.analysisType,
                        version: meta.version,
                    }
                }))
            } catch (error) {
                logger.error('分析产物检索失败:', error)
                return JSON.stringify({
                    error: '分析产物检索失败',
                    message: error instanceof Error ? error.message : '未知错误',
                })
            }
        },
        {
            name: toolDefinition.name,
            description: toolDefinition.description,
            schema: toolDefinition.schema,
        }
    )
}
