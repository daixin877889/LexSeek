/**
 * afterAgentMemory 中间件测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.1 跳过逻辑 + 异步 fire-and-forget**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { afterAgentMemoryMiddleware } from '~~/server/services/agent-platform/middleware/afterAgentMemory.middleware'

vi.mock('~~/server/services/memory/memoryExtraction.service', () => ({
    runMemoryExtractionService: vi.fn(),
}))

import { runMemoryExtractionService } from '~~/server/services/memory/memoryExtraction.service'

describe('afterAgentMemoryMiddleware', () => {
    beforeEach(() => vi.clearAllMocks())

    it('write+update >= 3 次：跳过提取', async () => {
        const mw = afterAgentMemoryMiddleware({ caseId: 1, sessionId: 'sess-1', userId: 1 })
        const state = {
            messages: [
                new AIMessage({ content: '', tool_calls: [
                    { id: '1', name: 'write_case_memory', args: {} },
                    { id: '2', name: 'write_case_memory', args: {} },
                    { id: '3', name: 'update_case_memory', args: {} },
                ] }),
            ],
        }

        await (mw as any).afterAgent.hook(state, {})

        expect(runMemoryExtractionService).not.toHaveBeenCalled()
    })

    it('write+update < 3 次：异步触发提取', async () => {
        vi.mocked(runMemoryExtractionService).mockResolvedValueOnce(undefined)
        const mw = afterAgentMemoryMiddleware({ caseId: 1, sessionId: 'sess-1', userId: 1 })
        const state = {
            messages: [
                new AIMessage({ content: '', tool_calls: [
                    { id: '1', name: 'write_case_memory', args: {} },
                ] }),
            ],
        }

        await (mw as any).afterAgent.hook(state, {})

        await new Promise(r => setImmediate(r))
        expect(runMemoryExtractionService).toHaveBeenCalledTimes(1)
        expect(runMemoryExtractionService).toHaveBeenCalledWith({
            caseId: 1,
            sessionId: 'sess-1',
            messages: state.messages,
        })
    })

    it('提取任务抛错时静默吞（不抛给上层）', async () => {
        vi.mocked(runMemoryExtractionService).mockRejectedValueOnce(new Error('LLM down'))
        const mw = afterAgentMemoryMiddleware({ caseId: 1, sessionId: 'sess-1', userId: 1 })
        const state = { messages: [] }

        await expect((mw as any).afterAgent.hook(state, {})).resolves.toBeUndefined()
    })
})
