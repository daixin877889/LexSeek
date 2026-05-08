/**
 * 法律检索工作流工具
 *
 * 工作流工具层 - 调用 legal 服务层的查询逻辑
 * Requirements: 12.3.1-12.3.3
 */

import { z } from 'zod'
import { searchLaw } from '~~/server/services/legal/searchLaw.tool'
import { truncateToolResults } from '~~/server/services/workflow/context/toolResultTruncator'
import { createSimpleTool, type ToolDefinition } from './types'

const schema = z.object({
    query: z.string().optional().describe('搜索关键词，用于语义搜索法律条文内容'),
    // LLM 偶尔会把数字当字符串回传，coerce 自动转 number 增强鲁棒性
    k: z.coerce.number().max(20).optional().default(5).describe('返回结果数量，最多 20 条'),
    legalType: z.enum(['law', 'regulation', 'judicial_interp', 'guideline']).optional().describe('法律类型：law（法律）、regulation（法规）、judicial_interp（司法解释）、guideline（指导性文件）'),
    legalName: z.string().optional().describe('法律名称，用于筛选特定法律的所有条文'),
    isEffective: z.boolean().optional().describe('是否有效，true 表示只返回有效条文，false 表示只返回无效条文'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'search_law',
    description: '搜索法律条文内容，支持语义搜索和元数据筛选。用于查找相关的法律、法规、司法解释等法律条文内容。',
    schema,
}

export const createTool = createSimpleTool(
    toolDefinition,
    async (input, ctx) => {
        logger.info('执行法律检索工作流工具', {
            userId: ctx.userId,
            caseId: ctx.caseId,
            query: input.query,
            k: input.k,
        })

        const results = await searchLaw({
            query: input.query,
            k: input.k || 5,
            legalType: input.legalType,
            legalName: input.legalName,
            isEffective: input.isEffective,
        })

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

        logger.info('法律检索完成', { caseId: ctx.caseId, resultCount: results.length })
        return truncateToolResults(formattedResults, { maxTokensPerItem: 8000 })
    },
    { errorLabel: '法律检索' },
)
