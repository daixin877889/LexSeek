/**
 * 案件材料检索工作流工具
 *
 * 工作流工具层 - 调用 material 服务层的查询逻辑
 * Requirements: 12.2.1-12.2.4
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { searchCaseMaterials } from '../../material/materialSearch.tool'
import type { ToolDefinition, ToolContext } from './types'

/** 参数 schema（唯一数据源） */
const schema = z.object({
    query: z.string().describe('查询内容，用于搜索相关的材料片段'),
    k: z.number().optional().default(5).describe('返回结果数量，默认为 5'),
})

/** 工具定义（单一数据源） */
export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'search_case_materials',
    description: '检索当前案件的材料内容，用于查找与分析相关的材料片段。仅在当前案件的材料范围内搜索，返回最相关的材料内容片段及来源信息。',
    schema,
}

/**
 * 创建案件材料检索工具
 *
 * @param context 工具上下文（包含 userId、caseId、sessionId）
 * @returns LangGraph 工具实例
 */
export function createTool(context: ToolContext) {
    const { userId, caseId } = context

    return tool(
        async (input) => {
            const { query, k = 5 } = input

            logger.info('执行材料检索工作流工具', {
                userId,
                caseId,
                query,
                k,
            })

            try {
                // 调用模块服务层的查询逻辑
                const results = await searchCaseMaterials(userId, caseId, query, k)

                // 格式化返回结果
                const formattedResults = results.map((result, index) => ({
                    index: index + 1,
                    content: result.content,
                    source: {
                        sourceId: result.sourceId,
                        sourceName: result.sourceName,
                        chunkIndex: result.chunkIndex,
                    },
                    relevanceScore: Number(result.score.toFixed(4)),
                }))

                logger.info('材料检索完成', {
                    caseId,
                    resultCount: results.length,
                })

                return JSON.stringify(formattedResults)
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
