import { z } from 'zod'
import { recallMemoryService } from '~~/server/services/memory/memory.service'
import { createSimpleTool, type ToolDefinition } from './types'

// query 改为 optional + 运行时检查：LLM 漏传 query 时不要让 zod 校验抛错（会被
// LangGraph 序列化吞掉根因，串通其他并行工具失败聚合为 AggregateError 无法 retry）。
// 现在改为返回结构化 error，LLM 看到提示后能补 query 重试。
const schema = z.object({
    query: z.string().optional().describe('检索关键词或问题（必填，缺失会返回错误提示让 LLM 补全）'),
    kind: z.enum(['fact', 'preference', 'dialogue_note']).optional(),
    top_k: z.coerce.number().default(5),
    include_history: z.boolean().default(false)
        .describe('是否放开已失效记忆（仅在用户明确问"之前/历史/曾经/当初"等时序追溯问题时设为 true）'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'search_case_memory',
    description: '语义检索当前案件的长期记忆（事实/偏好/对话要点）。当需要回忆之前讨论过的内容、用户偏好、或已抽取的事实时调用。',
    schema,
}

export const createTool = createSimpleTool(
    toolDefinition,
    async ({ query, kind, top_k, include_history }, ctx) => {
        if (!ctx.caseId) return { error: '未绑定案件，无法检索记忆' }
        if (!query || !query.trim()) {
            return { error: '缺少 query 参数：请提供检索关键词或问题，例如 "原告身份信息" 或 "之前讨论过的违约金"' }
        }

        // 注：search 是只读操作，ARCHIVED 案件允许召回历史记忆作为参考（spec §0.5）
        const hits = await recallMemoryService({
            caseId: ctx.caseId,
            query,
            kind,
            topK: top_k,
            includeInvalidated: include_history,
        })
        return hits.map((h) => ({
            id: h.id,
            text: h.text,
            score: h.score.toFixed(3),
            kind: h.metadata.kind,
            createdAt: h.metadata.createdAt,
        }))
    },
    { errorLabel: '记忆检索' },
)
