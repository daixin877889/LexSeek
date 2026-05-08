/**
 * 材料预处理中间件测试
 *
 * 覆盖 caseProcessMaterial.middleware.ts
 *
 * **Feature: workflow-middleware-coverage**
 * **Validates: Requirements WF.5**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock langchain
vi.mock('langchain', () => ({
    createMiddleware: vi.fn((config: any) => config),
}))

vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    ensureMaterialsReadyService: vi.fn().mockResolvedValue({
        totalMaterials: 5,
        alreadyEmbedded: 3,
        newlyProcessed: 2,
        failed: [],
    }),
}))

const mockLoggerFns = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}
vi.stubGlobal('logger', mockLoggerFns)

import { caseProcessMaterialMiddleware } from '~~/server/services/workflow/middleware/caseProcessMaterial.middleware'
import { ensureMaterialsReadyService } from '~~/server/services/material/materialPipeline.service'

describe('caseProcessMaterialMiddleware 测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应返回包含 beforeAgent hook 的中间件配置', () => {
        const middleware = caseProcessMaterialMiddleware(1, 1)

        expect(middleware).toHaveProperty('name', 'CaseProcessMaterialMiddleware')
        expect(middleware.beforeAgent).toHaveProperty('hook')
    })

    describe('beforeAgent hook', () => {
        it('成功处理材料应调用 ensureMaterialsReadyService', async () => {
            const middleware = caseProcessMaterialMiddleware(1, 1)
            const state = { messages: [] }

            await middleware.beforeAgent.hook(state)

            expect(ensureMaterialsReadyService).toHaveBeenCalledWith(1, 1)
        })

        it('部分材料处理失败时不应抛出错误', async () => {
            vi.mocked(ensureMaterialsReadyService).mockResolvedValue({
                totalMaterials: 5,
                alreadyEmbedded: 3,
                newlyProcessed: 1,
                failed: [{ id: 4, error: '处理失败' }],
            } as any)

            const middleware = caseProcessMaterialMiddleware(1, 1)
            const state = { messages: [] }

            // 不应抛出错误
            await middleware.beforeAgent.hook(state)
            expect(ensureMaterialsReadyService).toHaveBeenCalled()
        })

        it('异常时应捕获错误并继续执行', async () => {
            vi.mocked(ensureMaterialsReadyService).mockRejectedValue(new Error('预处理异常'))

            const middleware = caseProcessMaterialMiddleware(1, 1)
            const state = { messages: [] }

            // 不应抛出错误
            await expect(middleware.beforeAgent.hook(state)).resolves.not.toThrow()
        })
    })
})
