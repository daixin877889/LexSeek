/**
 * 案件材料检索工作流工具
 *
 * 工作流工具层 - 调用 materialPipeline 服务层的检索逻辑
 * 支持三种检索模式：语义搜索、精确检索、组合检索
 * Requirements: 12.2.1-12.2.4
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { searchMaterialsService, searchMaterialsByDraftService } from '../../material/materialPipeline.service'
import type { ToolDefinition, ToolContext } from './types'
import { truncateToolResults } from '../context/toolResultTruncator'

/** 参数 schema（唯一数据源） */
const schema = z.object({
    query: z.string().optional().describe('语义查询内容，用于搜索相关的材料片段'),
    sourceId: z.number().optional().describe('材料 sourceId，精确检索或限定语义搜索范围到指定材料'),
    draftId: z.number().optional().describe('文书 draft ID（文书生成场景传入）'),
    k: z.number().max(20).optional().default(5).describe('返回结果数量，默认为 5，最多 20 条'),
}).refine(
    data => data.query || data.sourceId,
    { message: '至少需要提供 query 或 sourceId' }
)

/** 工具定义（单一数据源） */
export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'search_case_materials',
    description: '检索当前案件或文书 draft 的材料内容。支持语义搜索（传 query）、精确检索（传 sourceId）、或组合检索。返回最相关的材料内容片段及来源信息。',
    schema,
}

/**
 * 创建案件材料检索工具
 *
 * @param context 工具上下文（包含 userId、caseId、draftId、sessionId）
 * @returns LangGraph 工具实例
 */
export function createTool(context: ToolContext) {
    const { userId, caseId, draftId: ctxDraftId } = context

    return tool(
        async (input) => {
            const { query, sourceId, draftId: inputDraftId, k = 5 } = input

            // input 中的 draftId 覆盖 context 中的 draftId
            const effectiveDraftId = inputDraftId ?? ctxDraftId

            logger.info('执行材料检索工作流工具', { userId, caseId, draftId: effectiveDraftId, query, sourceId, k })

            try {
                // 两者都无时抛错
                if (caseId == null && !effectiveDraftId) {
                    throw new Error('search_case_materials 工具需要 caseId 或 draftId，当前上下文均缺失')
                }

                // 分流：优先使用 draftId，其次使用 caseId
                const results = effectiveDraftId
                    ? await searchMaterialsByDraftService(userId, effectiveDraftId, { query, sourceId, k })
                    : await searchMaterialsService(userId, caseId!, { query, sourceId, k })

                if (results.length === 0) {
                    return JSON.stringify({ error: '未找到指定材料' })
                }

                logger.info('材料检索完成', { caseId, draftId: effectiveDraftId, resultCount: results.length })

                const truncated = truncateToolResults(results)
                return JSON.stringify(truncated)
            } catch (error) {
                logger.error('材料检索失败:', error)
                return JSON.stringify({
                    error: '材料检索失败',
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
