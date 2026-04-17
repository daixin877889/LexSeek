/**
 * 文书草稿结果持久化中间件测试
 *
 * 用 mock 隔离 DAO 调用，验证 beforeAgent / afterAgent 各分支行为
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 全局变量
vi.stubGlobal('logger', { info: vi.fn(), error: vi.fn(), warn: vi.fn() })

// Mock DAO
vi.mock('~~/server/services/assistant/document/documentDraft.dao', () => ({
    updateDocumentDraftDAO: vi.fn().mockResolvedValue({}),
}))

// Mock langchain
vi.mock('langchain', () => ({
    createMiddleware: vi.fn((config) => config),
}))

import { draftResultPersistenceMiddleware } from '~~/server/services/workflow/middleware/draftResultPersistence.middleware'
import { updateDocumentDraftDAO } from '~~/server/services/assistant/document/documentDraft.dao'

describe('draftResultPersistenceMiddleware beforeAgent', () => {
    const options = { draftId: 10, sessionId: 'session-abc' }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    function getBeforeAgentHook() {
        const config = draftResultPersistenceMiddleware(options)
        return config.beforeAgent.hook
    }

    it('应该将 draft 状态置为 filling', async () => {
        const hook = getBeforeAgentHook()
        await hook({})

        expect(updateDocumentDraftDAO).toHaveBeenCalledWith(10, { status: 'filling' })
    })

    it('DAO 抛出异常时不应向上抛出', async () => {
        vi.mocked(updateDocumentDraftDAO).mockRejectedValueOnce(new Error('DB 失败'))

        const hook = getBeforeAgentHook()
        await expect(hook({})).resolves.toBeUndefined()
    })
})

describe('draftResultPersistenceMiddleware afterAgent', () => {
    const options = { draftId: 10, sessionId: 'session-abc' }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    function getAfterAgentHook() {
        const config = draftResultPersistenceMiddleware(options)
        return config.afterAgent.hook
    }

    it('有 structuredResponse 时应写入 values + suggestions 并置 ready', async () => {
        const hook = getAfterAgentHook()
        const state = {
            structuredResponse: {
                values: { 甲方: '张三', 乙方: '李四' },
                suggestions: { 甲方: '可填写全名' },
            },
        }

        await hook(state)

        expect(updateDocumentDraftDAO).toHaveBeenCalledWith(10, {
            values: { 甲方: '张三', 乙方: '李四' },
            metadata: { suggestions: { 甲方: '可填写全名' } },
            status: 'ready',
        })
    })

    it('有 structuredResponse 但无 suggestions 时 metadata 应为 undefined', async () => {
        const hook = getAfterAgentHook()
        const state = {
            structuredResponse: {
                values: { 甲方: '张三' },
            },
        }

        await hook(state)

        expect(updateDocumentDraftDAO).toHaveBeenCalledWith(10, {
            values: { 甲方: '张三' },
            metadata: undefined,
            status: 'ready',
        })
    })

    it('structuredResponse 为 undefined 时应置 failed', async () => {
        const hook = getAfterAgentHook()
        await hook({ structuredResponse: undefined })

        expect(updateDocumentDraftDAO).toHaveBeenCalledWith(10, { status: 'failed' })
    })

    it('structuredResponse 缺失（state 中没有该字段）时应置 failed', async () => {
        const hook = getAfterAgentHook()
        await hook({})

        expect(updateDocumentDraftDAO).toHaveBeenCalledWith(10, { status: 'failed' })
    })

    it('DAO 抛出异常时应尝试置 failed 且不向上抛出', async () => {
        vi.mocked(updateDocumentDraftDAO)
            .mockRejectedValueOnce(new Error('写入失败'))
            .mockResolvedValueOnce({} as any)

        const hook = getAfterAgentHook()
        const state = {
            structuredResponse: { values: { 甲方: '张三' } },
        }

        await expect(hook(state)).resolves.toBeUndefined()
        // 第二次调用应该是 failed 降级
        expect(updateDocumentDraftDAO).toHaveBeenCalledTimes(2)
        expect(updateDocumentDraftDAO).toHaveBeenLastCalledWith(10, { status: 'failed' })
    })
})
