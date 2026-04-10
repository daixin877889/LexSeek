/**
 * 材料上下文中间件测试
 *
 * 覆盖 caseMaterialContext.middleware.ts 的核心逻辑
 *
 * **Feature: workflow-middleware-coverage**
 * **Validates: Requirements WF.3, WF.4**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock langchain
vi.mock('langchain', () => ({
    createMiddleware: vi.fn((config: any) => config),
    HumanMessage: class HumanMessage {
        content: string
        response_metadata: any
        constructor(opts: any) {
            this.content = opts.content
            this.response_metadata = opts.response_metadata
        }
        _getType() { return 'human' }
    },
}))

vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: vi.fn().mockResolvedValue([]),
}))

vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    getSourceId: vi.fn((m: any) => m.id),
    getMaterialContextService: vi.fn().mockResolvedValue({ mode: 'full', totalTokens: 100 }),
    buildMaterialContextMessage: vi.fn().mockReturnValue('全量材料上下文'),
    buildIncrementalMaterialMessage: vi.fn().mockReturnValue('增量材料上下文'),
}))

vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

import { caseMaterialContextMiddleware } from '~~/server/services/workflow/middleware/caseMaterialContext.middleware'
import { getMaterialsByCaseIdService } from '~~/server/services/material/material.service'
import { getMaterialContextService } from '~~/server/services/material/materialPipeline.service'

describe('caseMaterialContextMiddleware 测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应返回包含 beforeAgent hook 的中间件配置', () => {
        const middleware = caseMaterialContextMiddleware(1, 1)

        expect(middleware).toHaveProperty('name', 'CaseMaterialContextMiddleware')
        expect(middleware.beforeAgent).toHaveProperty('hook')
    })

    describe('beforeAgent hook', () => {
        it('无材料时应跳过注入', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValue([])

            const middleware = caseMaterialContextMiddleware(1, 1)
            const state = { messages: [], _injectedSourceIds: [] }

            const result = await middleware.beforeAgent.hook(state)
            expect(result).toBeUndefined()
        })

        it('首次有材料时应全量注入', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValue([
                { id: 1, name: '材料1' } as any,
            ])

            const middleware = caseMaterialContextMiddleware(1, 1)
            const systemMsg = { _getType: () => 'system', content: 'system' }
            const state = { messages: [systemMsg], _injectedSourceIds: [] }

            const result = await middleware.beforeAgent.hook(state)
            expect(result).toBeDefined()
            expect(result?._injectedSourceIds).toEqual([1])
            // 消息应在 system 之后插入
            expect(state.messages.length).toBe(2)
        })

        it('增量材料时应只注入新材料', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValue([
                { id: 1, name: '材料1' } as any,
                { id: 2, name: '材料2' } as any,
            ])

            const middleware = caseMaterialContextMiddleware(1, 1)
            const userMsg = { _getType: () => 'human', content: '用户输入' }
            const state = { messages: [userMsg], _injectedSourceIds: [1] }

            const result = await middleware.beforeAgent.hook(state)
            expect(result).toBeDefined()
            expect(result?._injectedSourceIds).toEqual([1, 2])
        })

        it('无新材料变更时应跳过', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValue([
                { id: 1, name: '材料1' } as any,
            ])

            const middleware = caseMaterialContextMiddleware(1, 1)
            const state = { messages: [], _injectedSourceIds: [1] }

            const result = await middleware.beforeAgent.hook(state)
            expect(result).toBeUndefined()
        })

        it('context mode 为 empty 时应跳过注入', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValue([
                { id: 1, name: '材料1' } as any,
            ])
            vi.mocked(getMaterialContextService).mockResolvedValue({
                mode: 'empty',
                totalTokens: 0,
            } as any)

            const middleware = caseMaterialContextMiddleware(1, 1)
            const state = { messages: [], _injectedSourceIds: [] }

            const result = await middleware.beforeAgent.hook(state)
            expect(result).toBeUndefined()
        })

        it('异常时应捕获错误并继续', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockRejectedValue(new Error('数据库异常'))

            const middleware = caseMaterialContextMiddleware(1, 1)
            const state = { messages: [], _injectedSourceIds: [] }

            // 不应抛出错误
            await expect(middleware.beforeAgent.hook(state)).resolves.not.toThrow()
        })
    })
})
