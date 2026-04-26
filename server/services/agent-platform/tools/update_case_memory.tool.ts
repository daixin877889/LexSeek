import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { updateMemoryService } from '~~/server/services/memory/memory.service'
import { CaseStatus } from '#shared/types/case'
import type { ToolDefinition, ToolContext } from './types'

const schema = z.object({
    id: z.string().uuid(),
    text: z.string().optional(),
    invalidate: z.boolean().default(false),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'update_case_memory',
    description: '更新一条已有记忆的文本，或将其标记为失效（软删除）。',
    schema,
}

export function createTool(context: ToolContext) {
    return tool(
        async ({ id, text, invalidate }) => {
            if (!context.caseId) return JSON.stringify({ error: '未绑定案件，无法修改记忆' })

            try {
                const caseRecord = await prisma.cases.findUnique({
                    where: { id: context.caseId },
                    select: { status: true },
                })
                if (caseRecord?.status === CaseStatus.ARCHIVED) {
                    return JSON.stringify({ error: '案件已归档，不可修改记忆' })
                }

                await updateMemoryService(id, { text, invalidate })
                return JSON.stringify({ ok: true })
            } catch (error) {
                logger.error('记忆更新失败:', error)
                return JSON.stringify({
                    error: '记忆更新失败',
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
