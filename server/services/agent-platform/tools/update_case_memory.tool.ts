import { z } from 'zod'
import { updateMemoryService } from '~~/server/services/memory/memory.service'
import { CaseStatus } from '#shared/types/case'
import { createSimpleTool, type ToolDefinition } from './types'

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

export const createTool = createSimpleTool(
    toolDefinition,
    async ({ id, text, invalidate }, ctx) => {
        if (!ctx.caseId) return { error: '未绑定案件，无法修改记忆' }

        const caseRecord = await prisma.cases.findUnique({
            where: { id: ctx.caseId },
            select: { status: true },
        })
        if (caseRecord?.status === CaseStatus.ARCHIVED) {
            return { error: '案件已归档，不可修改记忆' }
        }

        await updateMemoryService(id, { text, invalidate }, { expectedCaseId: ctx.caseId, userId: ctx.userId })
        return { ok: true }
    },
    { errorLabel: '记忆更新' },
)
