/**
 * 案件记忆异步提取服务
 *
 * 由 afterAgentMemory 中间件触发：当 LLM 主动调用 write/update_case_memory
 * 次数 < 3 时，本服务异步从对话历史中萃取关键事实并补写。
 *
 * 失败静默：以 logger.warn 记录，不抛给上层（防止 fire-and-forget
 * 的 .catch 走错路径）。
 */
import { z } from 'zod'
import { logger } from '#shared/utils/logger'
import { invokeNodeJson } from '~~/server/services/agent-platform/tools/invokeNodeJson'
import { writeMemoryService } from './memory.service'
import { findActiveMemoryBySubjectDAO } from './memory.dao'
import { calcSimilarity } from '~~/server/agents/contract/utils/textSimilarity'
import type { BaseMessage } from '@langchain/core/messages'

const memoryExtractSchema = z.object({
    memories: z.array(z.object({
        text: z.string().min(1),
        kind: z.enum(['fact', 'event', 'decision', 'note']),
        subject_key: z.string().optional(),
    })),
})

export interface MemoryExtractionParams {
    caseId: number
    sessionId: string
    messages: BaseMessage[] | Array<{ role: string; content: string }>
}

const SIMILARITY_THRESHOLD = 0.9

export async function runMemoryExtractionService(params: MemoryExtractionParams): Promise<void> {
    const { caseId, sessionId, messages } = params

    try {
        // 仅取最近 20 条对话节省 prompt
        const recentMessages = messages.slice(-20)

        const result = await invokeNodeJson({
            nodeName: 'caseMemoryExtract',
            temperature: 0.3,
            schema: memoryExtractSchema,
            buildPrompt: template => template
                .replace('{{messages}}', JSON.stringify(recentMessages))
                .replace('{{caseId}}', String(caseId)),
            errorPrefix: 'caseMemoryExtract',
            logContext: { caseId, sessionId },
        })

        for (const m of result.memories) {
            // 软去重：同 subjectKey 已有 active 记忆且文本相似 → 跳过
            if (m.subject_key) {
                const existing = await findActiveMemoryBySubjectDAO(caseId, m.subject_key)
                if (existing && calcSimilarity(existing.text, m.text) > SIMILARITY_THRESHOLD) {
                    logger.debug('memoryExtraction 跳过相似条目', { caseId, subjectKey: m.subject_key })
                    continue
                }
            }

            await writeMemoryService({
                caseId,
                kind: m.kind,
                text: m.text,
                subjectKey: m.subject_key,
                source: 'auto_extract',
            })
        }

        logger.info('memoryExtraction 完成', { caseId, sessionId, candidates: result.memories.length })
    } catch (e) {
        logger.warn('memoryExtraction 失败，afterAgent 静默跳过', {
            caseId,
            sessionId,
            error: e instanceof Error ? e.message : String(e),
        })
    }
}
