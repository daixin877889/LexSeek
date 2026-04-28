/**
 * 案件材料检索工作流工具
 *
 * 工作流工具层 - 调用 materialPipeline 服务层的检索逻辑
 * 支持三种检索模式：语义搜索、精确检索、组合检索
 * Requirements: 12.2.1-12.2.4
 */

import { z } from 'zod'
import { searchMaterialsByCaseOrDraftService } from '~~/server/services/material/materialPipeline.service'
import { truncateToolResults } from '~~/server/services/workflow/context/toolResultTruncator'
import { createSimpleTool, type ToolDefinition } from './types'

/** k 参数上限，超过一律 clamp 到该值，避免模型因超限报错 */
const MAX_K = 10

/** 参数 schema（唯一数据源） */
const schema = z.object({
    query: z.string().optional().describe('语义查询内容，用于搜索相关的材料片段'),
    sourceId: z.number().optional().describe('材料 sourceId，精确检索或限定语义搜索范围到指定材料'),
    draftId: z.number().optional().describe('文书 draft ID（文书生成场景传入）'),
    k: z.number().optional().default(5).describe(`返回结果数量，默认为 5，最多 ${MAX_K} 条（超过 ${MAX_K} 按 ${MAX_K} 处理）`),
})

/** 工具定义（单一数据源） */
export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'search_case_materials',
    description: `检索当前案件或文书 draft 的材料内容。四种模式：(1) 传 query 做语义搜索；(2) 传 sourceId 精确返回该材料全文；(3) query + sourceId 限定范围语义搜索；(4) 不传 query 也不传 sourceId 时，返回前 k 份材料的完整内容（默认 5 份，最多 ${MAX_K} 份），用于快速浏览本次会话可见的全部材料概览。返回内容包含材料片段及来源信息。`,
    schema,
}

export const createTool = createSimpleTool(
    toolDefinition,
    async (input, ctx) => {
        const { userId, caseId, draftId: ctxDraftId } = ctx
        const { query, sourceId, draftId: inputDraftId, k = 5 } = input

        // input 中的 draftId 覆盖 context 中的 draftId
        const effectiveDraftId = inputDraftId ?? ctxDraftId

        // 模型传入的 k 值 clamp 到 [1, MAX_K]，避免因超限报错
        const safeK = Math.min(Math.max(1, Math.floor(k)), MAX_K)

        logger.info('执行材料检索工作流工具', { userId, caseId, draftId: effectiveDraftId, query, sourceId, k: safeK })

        if (caseId == null && !effectiveDraftId) {
            throw new Error('search_case_materials 需要 caseId 或 draftId')
        }

        // 合并检索：同时传 caseId/draftId 由服务层 OR 查询 + 天然去重
        const results = await searchMaterialsByCaseOrDraftService(
            userId,
            { caseId: caseId ?? null, draftId: effectiveDraftId ?? null },
            { query, sourceId, k: safeK },
        )

        if (results.length === 0) return { error: '未找到指定材料' }

        logger.info('材料检索完成', { caseId, draftId: effectiveDraftId, resultCount: results.length })
        return truncateToolResults(results)
    },
    { errorLabel: '材料检索' },
)
