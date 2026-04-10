/**
 * 法律检索工作流工具
 *
 * 工作流工具层 - 调用 legal 服务层的查询逻辑
 * Requirements: 12.3.1-12.3.3
 */

import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { searchLaw } from '../../legal/searchLaw.tool'
import { truncateToolResults } from '../context/toolResultTruncator'
import type { ToolDefinition, ToolContext } from './types'

/** 参数 schema（唯一数据源） */
const schema = z.object({
    query: z.string().optional().describe('搜索关键词，用于语义搜索法律条文内容'),
    k: z.number().max(20).optional().default(5).describe('返回结果数量，最多 20 条'),
    legalType: z.enum(['law', 'regulation', 'judicial_interp', 'guideline']).optional().describe('法律类型：law（法律）、regulation（法规）、judicial_interp（司法解释）、guideline（指导性文件）'),
    legalName: z.string().optional().describe('法律名称，用于筛选特定法律的所有条文'),
    isEffective: z.boolean().optional().describe('是否有效，true 表示只返回有效条文，false 表示只返回无效条文'),
})

/** 工具定义（单一数据源） */
export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'search_law',
    description: '搜索法律条文内容，支持语义搜索和元数据筛选。用于查找相关的法律、法规、司法解释等法律条文内容。',
    schema,
}

/**
 * 创建法律检索工具
 *
 * @param context 工具上下文（包含 userId、caseId、sessionId）
 * @returns LangGraph 工具实例
 */
export function createTool(context: ToolContext) {
    return tool(
        async (input) => {
            logger.info('执行法律检索工作流工具', {
                userId: context.userId,
                caseId: context.caseId,
                query: input.query,
                k: input.k,
            })

            try {
                // 调用模块服务层的查询逻辑
                const results = await searchLaw({
                    query: input.query,
                    k: input.k || 5,
                    legalType: input.legalType,
                    legalName: input.legalName,
                    isEffective: input.isEffective,
                })

                // 格式化返回结果
                const formattedResults = results.map(item => ({
                    score: item.score,
                    content: item.content,
                    metadata: {
                        legal_name: item.metadata.legal_name,
                        document_number: item.metadata.document_number,
                        chapter_hierarchy: item.metadata.chapter_hierarchy,
                        publish_date: item.metadata.publish_date,
                        effective_date: item.metadata.effective_date,
                        invalid_date: item.metadata.invalid_date,
                    },
                }))

                logger.info('法律检索完成', {
                    caseId: context.caseId,
                    resultCount: results.length,
                })

                const truncated = truncateToolResults(formattedResults, { maxTokensPerItem: 8000 })
                return JSON.stringify(truncated)
            } catch (error) {
                logger.error('法律检索失败:', error)
                return JSON.stringify({
                    error: '法律检索失败',
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
