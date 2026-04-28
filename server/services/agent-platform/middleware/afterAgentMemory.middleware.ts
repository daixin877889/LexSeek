/**
 * afterAgentMemory 中间件
 *
 * 当 LLM 自觉调用 write/update_case_memory 总次数 < 3 时，
 * 启动异步任务调 caseMemoryExtract 节点兜底提取关键事实。
 *
 * fire-and-forget 异步：不阻塞 agent 响应；失败仅 log。
 *
 * 参考：server/agents/case-module/middleware/analysisResultPersistence.middleware.ts
 */
import { createMiddleware } from 'langchain'
import { countToolCalls } from './utils/countToolCalls'
import { runMemoryExtractionService } from '~~/server/services/memory/memoryExtraction.service'

export interface AfterAgentMemoryCtx {
    caseId: number
    sessionId: string
    userId: number
}

const SKIP_THRESHOLD = 3

export const afterAgentMemoryMiddleware = (ctx: AfterAgentMemoryCtx) => createMiddleware({
    name: 'afterAgentMemory',
    afterAgent: {
        hook: async (state: any, _runtime: any) => {
            try {
                const writeCount = countToolCalls(state.messages, [
                    'write_case_memory',
                    'update_case_memory',
                ])

                if (writeCount >= SKIP_THRESHOLD) {
                    logger.debug('afterAgentMemory 跳过（LLM 自觉率达标）', {
                        caseId: ctx.caseId, sessionId: ctx.sessionId, writeCount,
                    })
                    return
                }

                // fire-and-forget：不阻塞响应返回
                void runMemoryExtractionService({
                    caseId: ctx.caseId,
                    sessionId: ctx.sessionId,
                    messages: state.messages,
                }).catch(e => logger.warn('afterAgentMemory extraction failed', {
                    caseId: ctx.caseId, sessionId: ctx.sessionId, error: e,
                }))
            } catch (e) {
                // 中间件本身的异常静默；不影响主响应
                logger.warn('afterAgentMemory handler 异常', {
                    caseId: ctx.caseId, sessionId: ctx.sessionId, error: e,
                })
            }
        },
    },
})
