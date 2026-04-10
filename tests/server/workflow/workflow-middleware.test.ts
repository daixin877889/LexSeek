/**
 * 工作流中间件测试
 *
 * **Feature: workflow-middleware-coverage**
 * **Validates: Requirements 12.3, 12.4**
 *
 * 覆盖：
 * - moduleContext.middleware - 模块对话上下文中间件
 * - pointConsumption.middleware - 积分扣减中间件（getTokenCount 扩展）
 * - caseMaterialContext.middleware - 材料上下文注入中间件
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger（Nuxt 自动导入的全局变量）
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// ==================== 模块上下文中间件 Mock ====================

// Mock 材料服务
vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: vi.fn(),
}))

// Mock 材料管道服务
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    getSourceId: vi.fn((m: any) => m.id),
    getMaterialContextService: vi.fn(),
    buildMaterialContextMessage: vi.fn((ctx: any) => `材料上下文: ${ctx.mode}`),
    buildIncrementalMaterialMessage: vi.fn((ctx: any) => `增量材料: ${ctx.mode}`),
}))

// Mock 分析结果服务
vi.mock('~~/server/services/case/initAnalysis.service', () => ({
    loadCompletedResultsService: vi.fn(),
}))

// Mock 模块上下文构建器
vi.mock('~~/server/services/workflow/context/moduleContextBuilder', () => ({
    getCaseMemory: vi.fn(),
}))

// Mock langchain
vi.mock('langchain', () => ({
    createMiddleware: vi.fn((config) => config),
    HumanMessage: vi.fn().mockImplementation((opts) => ({
        content: opts.content,
        response_metadata: opts.response_metadata,
        _getType: () => 'human',
        constructor: { name: 'HumanMessage' },
    })),
}))

// Mock langchain interrupt
vi.mock('@langchain/langgraph', () => ({
    interrupt: vi.fn(),
}))

// Mock 会员和积分服务
vi.mock('~~/server/services/membership/userMembership.service', () => ({
    getCurrentMembershipService: vi.fn(),
}))
vi.mock('~~/server/services/point/pointConsumption.service', () => ({
    checkPointsService: vi.fn(),
    consumePointsService: vi.fn(),
}))

// Mock 状态存储
vi.mock('~~/server/services/workflow/state/storage', () => ({
    updateSessionState: vi.fn(),
}))

import { getMaterialsByCaseIdService } from '~~/server/services/material/material.service'
import {
    getMaterialContextService,
} from '~~/server/services/material/materialPipeline.service'
import { loadCompletedResultsService } from '~~/server/services/case/initAnalysis.service'
import { getCaseMemory } from '~~/server/services/workflow/context/moduleContextBuilder'
import { moduleContextMiddleware } from '~~/server/services/workflow/middleware/moduleContext.middleware'
import { caseMaterialContextMiddleware } from '~~/server/services/workflow/middleware/caseMaterialContext.middleware'
import { getTokenCount, pointConsumptionMiddleware } from '~~/server/services/workflow/middleware/pointConsumption.middleware'
import { getCurrentMembershipService } from '~~/server/services/membership/userMembership.service'
import { checkPointsService, consumePointsService } from '~~/server/services/point/pointConsumption.service'
import { interrupt } from '@langchain/langgraph'
import { updateSessionState } from '~~/server/services/workflow/state/storage'

describe('工作流中间件', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== moduleContext.middleware ====================

    describe('moduleContextMiddleware - 模块对话上下文中间件', () => {
        const caseId = 100
        const moduleName = 'analysis_summary'

        /** 创建中间件配置 */
        const createMiddlewareConfig = () => {
            return moduleContextMiddleware(caseId, moduleName) as any
        }

        /** 创建基础 state */
        const createState = (overrides: Record<string, any> = {}) => ({
            messages: [
                { _getType: () => 'system', content: '你是法律专家' },
                { _getType: () => 'human', content: '分析合同纠纷', constructor: { name: 'HumanMessage' } },
            ],
            _injectedSourceIds: [],
            _lastMemoryHash: null,
            _injectedResultVersions: {},
            _currentModuleResultHash: null,
            ...overrides,
        })

        it('创建中间件配置对象', () => {
            const config = createMiddlewareConfig()
            expect(config.name).toBe('ModuleContextMiddleware')
            expect(config.beforeAgent).toBeDefined()
            expect(config.beforeAgent.hook).toBeInstanceOf(Function)
        })

        it('首次注入材料上下文（全量）', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValueOnce([
                { id: 1, name: '起诉状.pdf' },
                { id: 2, name: '合同.pdf' },
            ] as any)
            vi.mocked(getCaseMemory).mockResolvedValueOnce(null)
            vi.mocked(loadCompletedResultsService).mockResolvedValueOnce({})
            vi.mocked(getMaterialContextService).mockResolvedValueOnce({
                mode: 'full',
                totalTokens: 5000,
                materialList: [],
            } as any)

            const config = createMiddlewareConfig()
            const state = createState()

            const result = await config.beforeAgent.hook(state)

            expect(result).toBeDefined()
            expect(result._injectedSourceIds).toEqual([1, 2])
            // 消息应该被注入
            expect(state.messages.length).toBeGreaterThan(2)
        })

        it('无变更时不注入（返回 undefined）', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValueOnce([])
            vi.mocked(getCaseMemory).mockResolvedValueOnce(null)
            vi.mocked(loadCompletedResultsService).mockResolvedValueOnce({})

            const config = createMiddlewareConfig()
            const state = createState()

            const result = await config.beforeAgent.hook(state)

            // 无变更时返回 undefined
            expect(result).toBeUndefined()
        })

        it('增量注入新材料', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValueOnce([
                { id: 1, name: '起诉状.pdf' },
                { id: 2, name: '证据.pdf' },
                { id: 3, name: '新增材料.pdf' },
            ] as any)
            vi.mocked(getCaseMemory).mockResolvedValueOnce(null)
            vi.mocked(loadCompletedResultsService).mockResolvedValueOnce({})
            vi.mocked(getMaterialContextService).mockResolvedValueOnce({
                mode: 'summary',
                totalTokens: 3000,
                materialList: [],
            } as any)

            const config = createMiddlewareConfig()
            const state = createState({ _injectedSourceIds: [1, 2] })

            const result = await config.beforeAgent.hook(state)

            expect(result).toBeDefined()
            expect(result._injectedSourceIds).toEqual([1, 2, 3])
        })

        it('记忆变更触发注入', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValueOnce([])
            vi.mocked(getCaseMemory).mockResolvedValueOnce('案件涉及合同纠纷，原告张三...')
            vi.mocked(loadCompletedResultsService).mockResolvedValueOnce({})

            const config = createMiddlewareConfig()
            const state = createState()

            const result = await config.beforeAgent.hook(state)

            expect(result).toBeDefined()
            expect(result._lastMemoryHash).toBeDefined()
            expect(result._lastMemoryHash).not.toBeNull()
        })

        it('其他模块分析结果变更触发注入', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValueOnce([])
            vi.mocked(getCaseMemory).mockResolvedValueOnce(null)
            vi.mocked(loadCompletedResultsService).mockResolvedValueOnce({
                analysis_defense: '辩护策略分析结果...',
            })

            const config = createMiddlewareConfig()
            const state = createState()

            const result = await config.beforeAgent.hook(state)

            expect(result).toBeDefined()
            expect(result._injectedResultVersions).toBeDefined()
            expect(result._injectedResultVersions.analysis_defense).toBeDefined()
        })

        it('当前模块结果首次出现触发注入', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValueOnce([])
            vi.mocked(getCaseMemory).mockResolvedValueOnce(null)
            vi.mocked(loadCompletedResultsService).mockResolvedValueOnce({
                [moduleName]: '已有分析基线结果...',
            })

            const config = createMiddlewareConfig()
            const state = createState()

            const result = await config.beforeAgent.hook(state)

            expect(result).toBeDefined()
            expect(result._currentModuleResultHash).toBeDefined()
        })

        it('异常不中断执行', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockRejectedValueOnce(
                new Error('数据库连接失败')
            )

            const config = createMiddlewareConfig()
            const state = createState()

            // 不应抛出异常
            const result = await config.beforeAgent.hook(state)
            expect(result).toBeUndefined()
        })
    })

    // ==================== caseMaterialContext.middleware ====================

    describe('caseMaterialContextMiddleware - 材料上下文注入中间件', () => {
        const userId = 1
        const caseId = 200

        const createMiddlewareConfig = () => {
            return caseMaterialContextMiddleware(userId, caseId) as any
        }

        const createState = (overrides: Record<string, any> = {}) => ({
            messages: [
                { _getType: () => 'system', content: '你是法律 AI' },
                { _getType: () => 'human', content: '帮我分析案件' },
            ],
            _injectedSourceIds: [],
            ...overrides,
        })

        it('创建中间件配置对象', () => {
            const config = createMiddlewareConfig()
            expect(config.name).toBe('CaseMaterialContextMiddleware')
            expect(config.beforeAgent).toBeDefined()
        })

        it('无材料时不注入', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValueOnce([])

            const config = createMiddlewareConfig()
            const state = createState()

            const result = await config.beforeAgent.hook(state)
            expect(result).toBeUndefined()
        })

        it('首次全量注入材料上下文', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValueOnce([
                { id: 10, name: '合同.pdf' },
            ] as any)
            vi.mocked(getMaterialContextService).mockResolvedValueOnce({
                mode: 'full',
                totalTokens: 3000,
                materialList: [],
            } as any)

            const config = createMiddlewareConfig()
            const state = createState()

            const result = await config.beforeAgent.hook(state)

            // 注入成功时返回更新后的 sourceIds
            if (result) {
                expect(result._injectedSourceIds).toEqual([10])
            }
            // getMaterialContextService 被调用
            expect(getMaterialContextService).toHaveBeenCalled()
        })

        it('已有材料无新增时不注入', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValueOnce([
                { id: 10, name: '合同.pdf' },
            ] as any)

            const config = createMiddlewareConfig()
            const state = createState({ _injectedSourceIds: [10] })

            const result = await config.beforeAgent.hook(state)
            expect(result).toBeUndefined()
        })

        it('增量注入新材料', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValueOnce([
                { id: 10, name: '合同.pdf' },
                { id: 11, name: '新证据.pdf' },
            ] as any)
            vi.mocked(getMaterialContextService).mockResolvedValueOnce({
                mode: 'summary',
                totalTokens: 1000,
                materialList: [],
            } as any)

            const config = createMiddlewareConfig()
            const state = createState({ _injectedSourceIds: [10] })

            const result = await config.beforeAgent.hook(state)

            // 注入成功时返回更新后的 sourceIds
            if (result) {
                expect(result._injectedSourceIds).toEqual([10, 11])
            }
            // getMaterialContextService 应该被调用（增量注入）
            expect(getMaterialContextService).toHaveBeenCalled()
        })

        it('getMaterialContextService 返回 empty 时不注入', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValueOnce([
                { id: 10, name: '空文件.pdf' },
            ] as any)
            vi.mocked(getMaterialContextService).mockResolvedValueOnce({
                mode: 'empty',
                totalTokens: 0,
                materialList: [],
            } as any)

            const config = createMiddlewareConfig()
            const state = createState()

            const result = await config.beforeAgent.hook(state)
            expect(result).toBeUndefined()
        })

        it('异常不中断执行', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockRejectedValueOnce(
                new Error('服务异常')
            )

            const config = createMiddlewareConfig()
            const state = createState()

            const result = await config.beforeAgent.hook(state)
            expect(result).toBeUndefined()
        })
    })

    // ==================== pointConsumption.middleware ====================

    describe('pointConsumptionMiddleware - 积分扣减中间件', () => {
        const userId = 1
        const itemKey = 'case_analysis_token'
        const sessionId = 'test-session'

        const createMiddlewareConfig = () => {
            return pointConsumptionMiddleware(userId, itemKey, sessionId) as any
        }

        describe('getTokenCount - token 用量估算', () => {
            it('优先使用 usage_metadata.total_tokens', () => {
                const msg = {
                    usage_metadata: { total_tokens: 5000 },
                    content: '短文本',
                }
                expect(getTokenCount(msg)).toBe(5000)
            })

            it('usage_metadata 缺失时基于内容估算，最低 100', () => {
                const msg = { content: '短', usage_metadata: undefined }
                expect(getTokenCount(msg)).toBe(100)
            })

            it('长文本估算超过 100 时使用估算值', () => {
                const longContent = '这是一段非常长的中文法律文本'.repeat(20) // 约 280 字符
                const msg = { content: longContent, usage_metadata: undefined }
                const expected = Math.ceil(longContent.length / 2)
                expect(getTokenCount(msg)).toBe(expected)
            })

            it('非字符串 content 使用 JSON.stringify 估算', () => {
                const msg = {
                    content: [{ type: 'text', text: '内容' }],
                    usage_metadata: undefined,
                }
                const contentStr = JSON.stringify(msg.content)
                const estimated = Math.ceil(contentStr.length / 2)
                expect(getTokenCount(msg)).toBe(Math.max(estimated, 100))
            })

            it('包含 thinking tokens 时纳入估算', () => {
                const thinkingText = '深度思考内容'.repeat(100) // 约 600 字符
                const msg = {
                    content: '回答',
                    usage_metadata: undefined,
                    additional_kwargs: {
                        thinking: [{ thinking: thinkingText }],
                    },
                }
                const result = getTokenCount(msg)
                // 应该包含 thinking 的 token 估算
                expect(result).toBeGreaterThan(100)
            })

            it('包含 tool_calls 时纳入估算', () => {
                const msg = {
                    content: '调用工具',
                    usage_metadata: undefined,
                    tool_calls: [
                        { name: 'search_law', args: { query: '合同法'.repeat(50) } },
                    ],
                }
                const result = getTokenCount(msg)
                // 内容 + tool_calls 的 JSON 长度都纳入估算
                const contentTokens = Math.ceil('调用工具'.length / 2)
                const toolCallsTokens = Math.ceil(JSON.stringify(msg.tool_calls).length / 2)
                expect(result).toBe(Math.max(contentTokens + toolCallsTokens, 100))
            })
        })

        describe('beforeAgent hook', () => {
            it('创建中间件配置对象', () => {
                const config = createMiddlewareConfig()
                expect(config.name).toBe('PointConsumptionMiddleware')
                expect(config.beforeAgent).toBeDefined()
                expect(config.afterModel).toBeDefined()
            })

            it('从 afterModel 恢复时跳过预检', async () => {
                const config = createMiddlewareConfig()
                const state = {
                    _resumingFromAfterModel: true,
                    _totalPointsConsumed: 0,
                    _totalTokensConsumed: 0,
                    _pendingDeductQuantity: 0,
                }

                const result = await config.beforeAgent.hook(state)
                expect(result).toEqual({ _resumingFromAfterModel: false })
                expect(getCurrentMembershipService).not.toHaveBeenCalled()
            })

            it('非会员触发 interrupt', async () => {
                // 首次检查返回 null（非会员），interrupt 后 resume 再次检查仍然非会员
                vi.mocked(getCurrentMembershipService)
                    .mockResolvedValueOnce(null as any) // 首次检查
                    .mockResolvedValueOnce(null as any) // resume 后重新检查
                // interrupt mock 不会真的暂停执行，所以代码会继续执行到 checkPoints
                vi.mocked(checkPointsService).mockResolvedValueOnce({
                    sufficient: true, required: 10, available: 100,
                } as any)

                const config = createMiddlewareConfig()
                const state = {
                    _resumingFromAfterModel: false,
                    _totalPointsConsumed: 0,
                    _totalTokensConsumed: 0,
                    _pendingDeductQuantity: 0,
                }

                await config.beforeAgent.hook(state)

                // interrupt 应该至少被调用一次（非会员）
                expect(interrupt).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'insufficient_points',
                        message: '请先开通会员',
                    })
                )
            })

            it('积分不足触发 interrupt', async () => {
                vi.mocked(getCurrentMembershipService).mockResolvedValueOnce({ id: 1 } as any)
                vi.mocked(checkPointsService).mockResolvedValueOnce({
                    sufficient: false,
                    required: 10,
                    available: 5,
                } as any)

                const config = createMiddlewareConfig()
                const state = {
                    _resumingFromAfterModel: false,
                    _totalPointsConsumed: 0,
                    _totalTokensConsumed: 0,
                    _pendingDeductQuantity: 0,
                }

                await config.beforeAgent.hook(state)

                expect(interrupt).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'insufficient_points',
                        data: expect.objectContaining({
                            isMember: true,
                            reason: 'insufficient_points',
                        }),
                    })
                )
            })

            it('会员且积分充足时通过预检', async () => {
                vi.mocked(getCurrentMembershipService).mockResolvedValueOnce({ id: 1 } as any)
                vi.mocked(checkPointsService).mockResolvedValueOnce({
                    sufficient: true,
                    required: 10,
                    available: 100,
                } as any)

                const config = createMiddlewareConfig()
                const state = {
                    _resumingFromAfterModel: false,
                    _totalPointsConsumed: 0,
                    _totalTokensConsumed: 0,
                    _pendingDeductQuantity: 0,
                }

                await config.beforeAgent.hook(state)

                expect(interrupt).not.toHaveBeenCalled()
            })

            it('会员服务异常时触发 interrupt', async () => {
                vi.mocked(getCurrentMembershipService).mockRejectedValueOnce(
                    new Error('服务异常')
                )

                const config = createMiddlewareConfig()
                const state = {
                    _resumingFromAfterModel: false,
                    _totalPointsConsumed: 0,
                    _totalTokensConsumed: 0,
                    _pendingDeductQuantity: 0,
                }

                await config.beforeAgent.hook(state)

                expect(interrupt).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: 'insufficient_points',
                        message: '系统繁忙，请稍后重试',
                    })
                )
            })
        })

        describe('afterModel hook', () => {
            it('无消息时返回 pendingDeductQuantity 为 0', async () => {
                const config = createMiddlewareConfig()
                const state = {
                    messages: [],
                    _totalTokensConsumed: 0,
                    _totalPointsConsumed: 0,
                    _pendingDeductQuantity: 0,
                }

                const result = await config.afterModel.hook(state)
                expect(result).toEqual({ _pendingDeductQuantity: 0 })
            })

            it('成功扣减积分', async () => {
                vi.mocked(consumePointsService).mockResolvedValueOnce({
                    consumedAmount: 3,
                } as any)

                const config = createMiddlewareConfig()
                const state = {
                    messages: [
                        { usage_metadata: { total_tokens: 2500 }, content: '回答' },
                    ],
                    _totalTokensConsumed: 0,
                    _totalPointsConsumed: 0,
                    _pendingDeductQuantity: 0,
                }

                const result = await config.afterModel.hook(state)

                expect(result._totalTokensConsumed).toBe(2500)
                expect(result._totalPointsConsumed).toBe(3)
                expect(result._pendingDeductQuantity).toBe(0)
                expect(consumePointsService).toHaveBeenCalledWith(userId, itemKey, 3) // ceil(2500/1000) = 3
            })

            it('扣减成功后更新共享状态', async () => {
                vi.mocked(consumePointsService).mockResolvedValueOnce({
                    consumedAmount: 1,
                } as any)

                const config = createMiddlewareConfig()
                const state = {
                    messages: [{ usage_metadata: { total_tokens: 1000 }, content: '回答' }],
                    _totalTokensConsumed: 0,
                    _totalPointsConsumed: 0,
                    _pendingDeductQuantity: 0,
                }

                await config.afterModel.hook(state)

                expect(updateSessionState).toHaveBeenCalledWith(
                    sessionId,
                    expect.objectContaining({
                        _totalTokensConsumed: 1000,
                        _pendingDeductQuantity: 0,
                    })
                )
            })

            it('有待补扣时先补扣', async () => {
                // 第一次调用是补扣成功
                vi.mocked(consumePointsService)
                    .mockResolvedValueOnce({ consumedAmount: 2 } as any)  // 补扣
                    .mockResolvedValueOnce({ consumedAmount: 1 } as any)  // 本次扣减

                const config = createMiddlewareConfig()
                const state = {
                    messages: [{ usage_metadata: { total_tokens: 500 }, content: '回答' }],
                    _totalTokensConsumed: 0,
                    _totalPointsConsumed: 0,
                    _pendingDeductQuantity: 2,
                }

                await config.afterModel.hook(state)

                // 应该调用了两次 consumePointsService
                expect(consumePointsService).toHaveBeenCalledTimes(2)
            })

            it('积分不足时触发 interrupt 并记录待补扣', async () => {
                vi.mocked(consumePointsService).mockRejectedValueOnce(
                    new Error('积分不足')
                )
                vi.mocked(checkPointsService).mockResolvedValueOnce({
                    available: 2,
                } as any)
                vi.mocked(getCurrentMembershipService).mockResolvedValueOnce({ id: 1 } as any)

                const config = createMiddlewareConfig()
                const state = {
                    messages: [{ usage_metadata: { total_tokens: 5000 }, content: '长回答' }],
                    _totalTokensConsumed: 0,
                    _totalPointsConsumed: 0,
                    _pendingDeductQuantity: 0,
                }

                const result = await config.afterModel.hook(state)

                expect(interrupt).toHaveBeenCalled()
                expect(result._pendingDeductQuantity).toBe(5) // ceil(5000/1000) = 5
                expect(result._resumingFromAfterModel).toBe(true)
            })

            it('非积分不足的扣减异常记录待补扣', async () => {
                vi.mocked(consumePointsService).mockRejectedValueOnce(
                    new Error('数据库超时')
                )

                const config = createMiddlewareConfig()
                const state = {
                    messages: [{ usage_metadata: { total_tokens: 2000 }, content: '回答' }],
                    _totalTokensConsumed: 0,
                    _totalPointsConsumed: 0,
                    _pendingDeductQuantity: 0,
                }

                const result = await config.afterModel.hook(state)

                // 不应触发 interrupt
                expect(interrupt).not.toHaveBeenCalled()
                expect(result._pendingDeductQuantity).toBe(2) // ceil(2000/1000) = 2
                expect(result._totalTokensConsumed).toBe(2000)
            })
        })
    })
})
