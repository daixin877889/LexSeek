import { z } from 'zod'
import { writeMemoryService } from '~~/server/services/memory/memory.service'
import { CaseStatus } from '#shared/types/case'
import { createSimpleTool, type ToolDefinition } from './types'

const schema = z.object({
    text: z.string().describe('记忆正文'),
    kind: z.enum(['fact', 'event', 'decision', 'note', 'preference', 'dialogue_note'])
        .describe('类型：fact 客观事实 / event 事件 / decision 决策 / note 笔记 / preference 用户偏好（旧）/ dialogue_note 对话要点（旧）'),
    subject_key: z.string().optional().describe('主题指纹，如 "plaintiff.address" / "trend.prediction"；同主题新事实覆盖旧（版本链）'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'write_case_memory',
    description: '把一条事实、事件、决策或笔记写入当前案件的长期记忆。',
    schema,
}

export const createTool = createSimpleTool(
    toolDefinition,
    async ({ text, kind, subject_key }, ctx) => {
        if (!ctx.caseId) return { error: '未绑定案件，无法写入记忆' }

        const caseRecord = await prisma.cases.findUnique({
            where: { id: ctx.caseId },
            select: { status: true },
        })
        if (caseRecord?.status === CaseStatus.ARCHIVED) {
            return { error: '案件已归档，不可写入新记忆' }
        }

        const { id } = await writeMemoryService({
            caseId: ctx.caseId,
            kind,
            text,
            subjectKey: subject_key,
            source: 'manual',
        })
        return { id, ok: true }
    },
    { errorLabel: '记忆写入' },
)
