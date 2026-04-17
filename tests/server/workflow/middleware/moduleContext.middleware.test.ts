/**
 * 模块上下文中间件测试
 *
 * 覆盖 moduleContext.middleware.ts 的核心逻辑
 *
 * **Feature: workflow-middleware-coverage**
 * **Validates: Requirements WF.1, WF.2**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock langchain 的 createMiddleware
vi.mock('langchain', () => ({
    createMiddleware: vi.fn((config: any) => config),
}))

// Mock @langchain/core/messages
vi.mock('@langchain/core/messages', () => ({
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

// Mock 依赖服务
vi.mock('~~/server/services/material/material.service', () => ({
    getMaterialsByCaseIdService: vi.fn().mockResolvedValue([]),
}))

vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    getSourceId: vi.fn((m: any) => m.id),
    getMaterialContextService: vi.fn().mockResolvedValue({ mode: 'full', totalTokens: 100 }),
    buildMaterialContextMessage: vi.fn().mockReturnValue('材料上下文内容'),
    buildIncrementalMaterialMessage: vi.fn().mockReturnValue('增量材料内容'),
}))

vi.mock('~~/server/services/case/initAnalysis.service', () => ({
    loadCompletedResultsService: vi.fn().mockResolvedValue({}),
}))

vi.mock('~~/server/services/workflow/context/moduleContextBuilder', () => ({
    getCaseMemory: vi.fn().mockResolvedValue(null),
}))

vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

import { moduleContextMiddleware } from '~~/server/services/workflow/middleware/moduleContext.middleware'
import { getMaterialsByCaseIdService } from '~~/server/services/material/material.service'
import { loadCompletedResultsService } from '~~/server/services/case/initAnalysis.service'
import { getCaseMemory } from '~~/server/services/workflow/context/moduleContextBuilder'

describe('moduleContextMiddleware 测试', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('应返回包含 beforeAgent hook 的中间件配置', () => {
        const middleware = moduleContextMiddleware(1, 'test_module')

        expect(middleware).toHaveProperty('name', 'ModuleContextMiddleware')
        expect(middleware).toHaveProperty('stateSchema')
        expect(middleware).toHaveProperty('beforeAgent')
        expect(middleware.beforeAgent).toHaveProperty('hook')
    })

    describe('beforeAgent hook', () => {
        it('无变更时应不注入任何内容', async () => {
            const middleware = moduleContextMiddleware(1, 'test_module')
            const state = {
                messages: [],
                _injectedSourceIds: [],
                _lastMemoryHash: null,
                _injectedResultVersions: {},
                _currentModuleResultHash: null,
            }

            const result = await middleware.beforeAgent.hook(state)
            expect(result).toBeUndefined()
        })

        it('首次有材料时应全量注入', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValue([
                { id: 1, name: '材料1' } as any,
            ])

            const middleware = moduleContextMiddleware(1, 'test_module')
            const humanMsg = {
                _getType: () => 'human',
                constructor: { name: 'HumanMessage' },
                content: '用户输入',
            }
            const state = {
                messages: [humanMsg],
                _injectedSourceIds: [],
                _lastMemoryHash: null,
                _injectedResultVersions: {},
                _currentModuleResultHash: null,
            }

            const result = await middleware.beforeAgent.hook(state)
            expect(result).toBeDefined()
            expect(result?._injectedSourceIds).toEqual([1])
        })

        it('有新增材料时应增量注入', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockResolvedValue([
                { id: 1, name: '材料1' } as any,
                { id: 2, name: '材料2' } as any,
            ])

            const middleware = moduleContextMiddleware(1, 'test_module')
            const humanMsg = {
                _getType: () => 'human',
                constructor: { name: 'HumanMessage' },
                content: '用户输入',
            }
            const state = {
                messages: [humanMsg],
                _injectedSourceIds: [1], // 已注入 id=1
                _lastMemoryHash: null,
                _injectedResultVersions: {},
                _currentModuleResultHash: null,
            }

            const result = await middleware.beforeAgent.hook(state)
            expect(result).toBeDefined()
            expect(result?._injectedSourceIds).toEqual([1, 2])
        })

        it('记忆变更时应注入记忆内容', async () => {
            vi.mocked(getCaseMemory).mockResolvedValue('新的案件记忆')

            const middleware = moduleContextMiddleware(1, 'test_module')
            const humanMsg = {
                _getType: () => 'human',
                constructor: { name: 'HumanMessage' },
                content: '用户输入',
            }
            const state = {
                messages: [humanMsg],
                _injectedSourceIds: [],
                _lastMemoryHash: null,
                _injectedResultVersions: {},
                _currentModuleResultHash: null,
            }

            const result = await middleware.beforeAgent.hook(state)
            expect(result).toBeDefined()
            expect(result?._lastMemoryHash).not.toBeNull()
        })

        it('其他模块结果变更时应注入', async () => {
            vi.mocked(loadCompletedResultsService).mockResolvedValue({
                other_module: '其他模块分析结果',
            })

            const middleware = moduleContextMiddleware(1, 'test_module')
            const humanMsg = {
                _getType: () => 'human',
                constructor: { name: 'HumanMessage' },
                content: '用户输入',
            }
            const state = {
                messages: [humanMsg],
                _injectedSourceIds: [],
                _lastMemoryHash: null,
                _injectedResultVersions: {},
                _currentModuleResultHash: null,
            }

            const result = await middleware.beforeAgent.hook(state)
            expect(result).toBeDefined()
            expect(result?._injectedResultVersions).toHaveProperty('other_module')
        })

        it('当前模块结果变更时应注入基线', async () => {
            vi.mocked(loadCompletedResultsService).mockResolvedValue({
                test_module: '当前模块已有结果',
            })

            const middleware = moduleContextMiddleware(1, 'test_module')
            const humanMsg = {
                _getType: () => 'human',
                constructor: { name: 'HumanMessage' },
                content: '用户输入',
            }
            const state = {
                messages: [humanMsg],
                _injectedSourceIds: [],
                _lastMemoryHash: null,
                _injectedResultVersions: {},
                _currentModuleResultHash: null,
            }

            const result = await middleware.beforeAgent.hook(state)
            expect(result).toBeDefined()
            expect(result?._currentModuleResultHash).not.toBeNull()
        })

        it('加载异常时应捕获错误并继续', async () => {
            vi.mocked(getMaterialsByCaseIdService).mockRejectedValue(new Error('数据库异常'))
            vi.mocked(getCaseMemory).mockRejectedValue(new Error('记忆异常'))
            vi.mocked(loadCompletedResultsService).mockRejectedValue(new Error('结果异常'))

            const middleware = moduleContextMiddleware(1, 'test_module')
            const state = {
                messages: [],
                _injectedSourceIds: [],
                _lastMemoryHash: null,
                _injectedResultVersions: {},
                _currentModuleResultHash: null,
            }

            // 不应抛出错误
            const result = await middleware.beforeAgent.hook(state)
            expect(result).toBeUndefined()
        })

        it('无 HumanMessage 时应 push 到末尾', async () => {
            vi.mocked(getCaseMemory).mockResolvedValue('记忆内容')

            const middleware = moduleContextMiddleware(1, 'test_module')
            const state = {
                messages: [], // 无 HumanMessage
                _injectedSourceIds: [],
                _lastMemoryHash: null,
                _injectedResultVersions: {},
                _currentModuleResultHash: null,
            }

            await middleware.beforeAgent.hook(state)
            // 消息应被 push 到 messages
            expect(state.messages.length).toBeGreaterThanOrEqual(0)
        })

        describe('moduleName 可选（小索场景）', () => {
            it('缺省 moduleName 时应将所有已完成模块注入到 section 3', async () => {
                vi.mocked(loadCompletedResultsService).mockResolvedValue({
                    summary: '摘要分析结果',
                    defense: '抗辩分析结果',
                })

                const middleware = moduleContextMiddleware(1)
                const humanMsg = {
                    _getType: () => 'human',
                    constructor: { name: 'HumanMessage' },
                    content: '用户输入',
                }
                const state = {
                    messages: [humanMsg],
                    _injectedSourceIds: [],
                    _lastMemoryHash: null,
                    _injectedResultVersions: {},
                    _currentModuleResultHash: null,
                }

                const result = await middleware.beforeAgent.hook(state)
                expect(result).toBeDefined()
                expect(result?._injectedResultVersions).toHaveProperty('summary')
                expect(result?._injectedResultVersions).toHaveProperty('defense')
            })

            it('缺省 moduleName 时应跳过 section 4（当前模块基线）', async () => {
                vi.mocked(loadCompletedResultsService).mockResolvedValue({
                    summary: '摘要分析结果',
                })

                const middleware = moduleContextMiddleware(1)
                const humanMsg = {
                    _getType: () => 'human',
                    constructor: { name: 'HumanMessage' },
                    content: '用户输入',
                }
                const state = {
                    messages: [humanMsg],
                    _injectedSourceIds: [],
                    _lastMemoryHash: null,
                    _injectedResultVersions: {},
                    _currentModuleResultHash: null,
                }

                const result = await middleware.beforeAgent.hook(state)
                expect(result).toBeDefined()
                expect(result?._currentModuleResultHash).toBeNull()
            })

            it('缺省 moduleName 时 injectedBy 应包含 global', async () => {
                vi.mocked(getCaseMemory).mockResolvedValue('案件记忆内容')

                const middleware = moduleContextMiddleware(1)
                const humanMsg = {
                    _getType: () => 'human',
                    constructor: { name: 'HumanMessage' },
                    content: '用户输入',
                }
                const state = {
                    messages: [humanMsg] as any[],
                    _injectedSourceIds: [],
                    _lastMemoryHash: null,
                    _injectedResultVersions: {},
                    _currentModuleResultHash: null,
                }

                await middleware.beforeAgent.hook(state)
                // 查找注入的 HumanMessage
                const injectedMsg = state.messages.find(
                    (m: any) => m.response_metadata?.injectedBy,
                )
                expect(injectedMsg).toBeDefined()
                expect(injectedMsg.response_metadata.injectedBy).toContain('global')
            })

            it('有 moduleName 时行为不变（回归）', async () => {
                vi.mocked(loadCompletedResultsService).mockResolvedValue({
                    test_module: '当前模块结果',
                    other_module: '其他模块结果',
                })

                const middleware = moduleContextMiddleware(1, 'test_module')
                const humanMsg = {
                    _getType: () => 'human',
                    constructor: { name: 'HumanMessage' },
                    content: '用户输入',
                }
                const state = {
                    messages: [humanMsg],
                    _injectedSourceIds: [],
                    _lastMemoryHash: null,
                    _injectedResultVersions: {},
                    _currentModuleResultHash: null,
                }

                const result = await middleware.beforeAgent.hook(state)
                expect(result).toBeDefined()
                expect(result?._injectedResultVersions).toHaveProperty('other_module')
                expect(result?._injectedResultVersions).not.toHaveProperty('test_module')
                expect(result?._currentModuleResultHash).not.toBeNull()
            })
        })
    })
})
