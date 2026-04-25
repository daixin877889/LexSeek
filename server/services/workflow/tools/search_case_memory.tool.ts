import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { recallMemoryService } from '../../memory/memory.service'
import { isCaseReadOnly } from '#shared/types/case'
import type { ToolDefinition, ToolContext } from './types'

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

export function createTool(context: ToolContext) {
    return tool(
        async ({ query, kind, top_k, include_history }) => {
            if (!context.caseId) return JSON.stringify({ error: '未绑定案件，无法检索记忆' })

            try {
                // ARCHIVED 案件只读：search 是读操作，允许召回历史记忆作为参考（spec §0.5）
                const caseRecord = await prisma.cases.findUnique({
                    where: { id: context.caseId },
                    select: { status: true },
                })
                if (caseRecord && isCaseReadOnly(caseRecord.status)) {
                    logger.debug('search_case_memory invoked on ARCHIVED case (read allowed)', {
                        caseId: context.caseId,
                    })
                }

                const hits = await recallMemoryService({
                    caseId: context.caseId,
                    query,
                    kind,
                    topK: top_k,
                    includeInvalidated: include_history,
                })
                return JSON.stringify(hits.map((h) => ({
                    id: h.id,
                    text: h.text,
                    score: h.score.toFixed(3),
                    kind: h.metadata.kind,
                    createdAt: h.metadata.createdAt,
                })))
            } catch (error) {
                logger.error('记忆检索失败:', error)
                return JSON.stringify({
                    error: '记忆检索失败',
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
