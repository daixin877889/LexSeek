import { z } from 'zod'
import { recallMemoryService } from '~~/server/services/memory/memory.service'
import { createSimpleTool, type ToolDefinition } from './types'

const schema = z.object({
    query: z.string().describe('检索关键词或问题'),
    kind: z.enum(['fact', 'preference', 'dialogue_note']).optional(),
    top_k: z.number().default(5),
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
