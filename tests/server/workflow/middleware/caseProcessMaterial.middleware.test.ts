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

// Mock SSE emitter，让我们能 spy 中间件实际发了哪些事件
const emitSpy = vi.fn().mockResolvedValue(undefined)
vi.mock('~~/server/services/agent-platform/sse/customEventEmitter', () => ({
    createCustomEventEmitter: vi.fn(() => emitSpy),
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

        it('全 ready 首次快照时整轮抑制 emit（不发 phase=start/progress/end）', async () => {
            // 模拟 ensureMaterialsReadyService 调一次 onProgress，传入全 ready 快照
            vi.mocked(ensureMaterialsReadyService).mockImplementation(
                async (_caseId, _userId, onProgress) => {
                    await onProgress?.([
                        { materialId: 1, name: '案件描述', status: 'ready' },
                    ])
                    return {
                        totalMaterials: 1,
                        alreadyEmbedded: 1,
                        newlyProcessed: 0,
                        embeddedMap: new Map([[1, true]]),
                        failed: [],
                        materials: [] as any,
                    } as any
                },
            )

            // 必须传 runId，否则 emit 本来就为 null（不走抑制路径）
            const middleware = caseProcessMaterialMiddleware(1, 1, 'run-abc', 'session-1')
            const state = { messages: [] }
            await middleware.beforeAgent.hook(state)

            // 抑制成功：emit 一次都不应被调用
            expect(emitSpy).not.toHaveBeenCalled()
        })

        it('首次有非 ready 项时正常发 phase=start，到达终态后发 phase=end', async () => {
            // 模拟 onProgress 被调两次：先 summarizing，再 ready
            vi.mocked(ensureMaterialsReadyService).mockImplementation(
                async (_caseId, _userId, onProgress) => {
                    await onProgress?.([
                        { materialId: 1, name: '案件描述', status: 'summarizing' },
                    ])
                    await onProgress?.([
                        { materialId: 1, name: '案件描述', status: 'ready' },
                    ])
                    return {
                        totalMaterials: 1,
                        alreadyEmbedded: 1,
                        newlyProcessed: 0,
                        embeddedMap: new Map([[1, true]]),
                        failed: [],
                        materials: [] as any,
                    } as any
                },
            )

            const middleware = caseProcessMaterialMiddleware(1, 1, 'run-xyz', 'session-2')
            const state = { messages: [] }
            await middleware.beforeAgent.hook(state)

            // 应至少有 phase=start 一次 + phase=end 一次（中间可能还有 progress）
            const phases = emitSpy.mock.calls.map(c => (c[0] as any).data.phase)
            expect(phases).toContain('start')
            expect(phases).toContain('end')
        })

        it('全 failed 不抑制（用户需要看到失败提示）', async () => {
            vi.mocked(ensureMaterialsReadyService).mockImplementation(
                async (_caseId, _userId, onProgress) => {
                    await onProgress?.([
                        { materialId: 1, name: '案件描述', status: 'failed' },
                    ])
                    return {
                        totalMaterials: 1,
                        alreadyEmbedded: 0,
                        newlyProcessed: 0,
                        embeddedMap: new Map(),
                        failed: [{ materialId: 1, name: '案件描述', error: 'x' }],
                        materials: [] as any,
                    } as any
                },
            )

            const middleware = caseProcessMaterialMiddleware(1, 1, 'run-failed', 'session-3')
            const state = { messages: [] }
            await middleware.beforeAgent.hook(state)

            const phases = emitSpy.mock.calls.map(c => (c[0] as any).data.phase)
            expect(phases).toContain('start')
            expect(phases).toContain('end')
        })
    })
})
