import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { writeMemoryService } from '../../memory/memory.service'
import { CaseStatus } from '#shared/types/case'
import type { ToolDefinition, ToolContext } from './types'

const schema = z.object({
    text: z.string().describe('记忆正文'),
    kind: z.enum(['fact', 'preference', 'dialogue_note']),
    subject_key: z.string().optional().describe('主题指纹，如 "plaintiff.address"；同主题新事实覆盖旧（版本链）'),
})

export const toolDefinition: ToolDefinition<typeof schema> = {
    name: 'write_case_memory',
    description: '把一条事实、用户偏好或对话要点写入当前案件的长期记忆。',
    schema,
}

export function createTool(context: ToolContext) {
    return tool(
        async ({ text, kind, subject_key }) => {
            if (!context.caseId) return JSON.stringify({ error: '未绑定案件，无法写入记忆' })

            try {
                const caseRecord = await prisma.cases.findUnique({
                    where: { id: context.caseId },
                    select: { status: true },
                })
                if (caseRecord?.status === CaseStatus.ARCHIVED) {
                    return JSON.stringify({ error: '案件已归档，不可写入新记忆' })
                }

                const { id } = await writeMemoryService({
                    caseId: context.caseId,
                    kind,
                    text,
                    subjectKey: subject_key,
                    source: 'manual',
                })
                return JSON.stringify({ id, ok: true })
            } catch (error) {
                logger.error('记忆写入失败:', error)
                return JSON.stringify({
                    error: '记忆写入失败',
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
