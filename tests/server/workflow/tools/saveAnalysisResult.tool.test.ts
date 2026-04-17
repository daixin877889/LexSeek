/**
 * save_analysis_result 工具测试
 *
 * **Feature: save-analysis-result-tool**
 * **Validates: 模块对话 Agent 保存分析结果的工具实现**
 *
 * 覆盖：
 * - 从 ctx.getState() 读取 _totalTokensConsumed，成功保存并发布事件
 * - 从 config.configurable.state 读取 _totalTokensConsumed（getState 回退分支）
 * - 无 getState、无 state 时（tokens 保持 null）
 * - saveAndActivateAnalysisService 抛错时走 catch 分支
 * - 工具定义字段 name/description/schema
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger（Nuxt 自动导入的全局变量）
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// Mock analysis.service 中的 saveAndActivateAnalysisService
const mockSaveAndActivate = vi.fn()
vi.mock('~~/server/services/case/analysis.service', () => ({
    saveAndActivateAnalysisService: (...args: any[]) => mockSaveAndActivate(...args),
}))

// Mock agentEventBridge 中的 publishCustomEvent
const mockPublishCustomEvent = vi.fn()
vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: (...args: any[]) => mockPublishCustomEvent(...args),
}))

// 动态导入以保证 vi.mock 生效
import {
    toolDefinition,
    createTool,
    type ModuleToolContext,
} from '~~/server/services/workflow/tools/saveAnalysisResult.tool'

/** 构造最小 ModuleToolContext */
const createContext = (overrides: Partial<ModuleToolContext> = {}): ModuleToolContext => ({
    userId: 1,
    caseId: 100,
    sessionId: 'session-abc',
    runId: 'run-xyz',
    moduleName: 'analysis_summary',
    nodeId: 10,
    ...overrides,
})

describe('save_analysis_result 工具', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('工具定义', () => {
        it('toolDefinition 应包含正确的名称与描述', () => {
            expect(toolDefinition.name).toBe('save_analysis_result')
            expect(toolDefinition.description).toContain('保存')
        })

        it('toolDefinition.schema 应校验 analysisResult 字段', () => {
            const good = toolDefinition.schema.safeParse({ analysisResult: '结果内容' })
            expect(good.success).toBe(true)

            const bad = toolDefinition.schema.safeParse({ analysisResult: 123 })
            expect(bad.success).toBe(false)
        })

        it('createTool 返回的工具名称与定义一致', () => {
            const tool = createTool(createContext())
            expect(tool.name).toBe('save_analysis_result')
            expect(tool.description).toContain('保存')
        })
    })

    describe('invoke - 成功路径', () => {
        it('从 getState() 读取 _totalTokensConsumed 并计算 tokenCount', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({
                id: 11,
                version: 3,
            })
            mockPublishCustomEvent.mockResolvedValueOnce(undefined)

            const getState = vi.fn(async () => ({ _totalTokensConsumed: 3500 }))
            const ctx = createContext({ getState })
            const tool = createTool(ctx)

            const resultStr = (await tool.invoke({ analysisResult: '# 分析结论\n\n正文' })) as string
            const parsed = JSON.parse(resultStr)

            expect(parsed.success).toBe(true)
            expect(parsed.version).toBe(3)
            expect(parsed.tokens).toBe(3500)
            // Math.ceil(3500/1000) = 4
            expect(parsed.tokenCount).toBe(4)
            expect(parsed.message).toContain('第3版')

            // 验证 saveAndActivate 入参
            expect(mockSaveAndActivate).toHaveBeenCalledTimes(1)
            const saveArgs = mockSaveAndActivate.mock.calls[0][0]
            expect(saveArgs.caseId).toBe(100)
            expect(saveArgs.sessionId).toBe('session-abc')
            expect(saveArgs.nodeId).toBe(10)
            expect(saveArgs.analysisType).toBe('analysis_summary')
            expect(saveArgs.analysisResult).toBe('# 分析结论\n\n正文')
            expect(saveArgs.tokens).toBe(3500)
            expect(saveArgs.tokenCount).toBe(4)

            // 验证事件发布
            expect(mockPublishCustomEvent).toHaveBeenCalledTimes(1)
            const eventArg = mockPublishCustomEvent.mock.calls[0][0]
            expect(eventArg.type).toBe('custom_event')
            expect(eventArg.runId).toBe('run-xyz')
            expect(eventArg.sessionId).toBe('session-abc')
            expect(eventArg.name).toBe('analysis_result_saved')
            expect(eventArg.data.version).toBe(3)
            expect(eventArg.data.moduleName).toBe('analysis_summary')
            expect(eventArg.data.analysisId).toBe(11)
            expect(eventArg.data.tokens).toBe(3500)
            expect(eventArg.data.tokenCount).toBe(4)
        })

        it('getState 返回 state 但 _totalTokensConsumed 为 0 时，从 config.configurable.state 回退读取', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 22, version: 1 })
            mockPublishCustomEvent.mockResolvedValueOnce(undefined)

            // getState 返回 0，必须触发 fallback 分支
            const getState = vi.fn(async () => ({ _totalTokensConsumed: 0 }))
            const ctx = createContext({ getState })
            const tool = createTool(ctx)

            // 通过 invoke 的第二个参数传入 config（langchain tool 会接收 RunnableConfig）
            const result = (await tool.invoke(
                { analysisResult: '结果' },
                {
                    configurable: {
                        state: { _totalTokensConsumed: 2001 },
                    },
                },
            )) as string
            const parsed = JSON.parse(result)

            expect(parsed.success).toBe(true)
            expect(parsed.tokens).toBe(2001)
            // Math.ceil(2001/1000) = 3
            expect(parsed.tokenCount).toBe(3)
        })

        it('getState 返回 null 时，fallback 到 config.configurable.state', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 33, version: 2 })
            mockPublishCustomEvent.mockResolvedValueOnce(undefined)

            const getState = vi.fn(async () => null)
            const ctx = createContext({ getState })
            const tool = createTool(ctx)

            const result = (await tool.invoke(
                { analysisResult: '结果' },
                {
                    configurable: {
                        state: { _totalTokensConsumed: 1000 },
                    },
                },
            )) as string
            const parsed = JSON.parse(result)

            expect(parsed.success).toBe(true)
            expect(parsed.tokens).toBe(1000)
            expect(parsed.tokenCount).toBe(1)
        })

        it('无 getState 且 config 无 state 时，tokens/tokenCount 为 null', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 44, version: 1 })
            mockPublishCustomEvent.mockResolvedValueOnce(undefined)

            const ctx = createContext() // 不提供 getState
            const tool = createTool(ctx)

            const result = (await tool.invoke({ analysisResult: '简单结果' })) as string
            const parsed = JSON.parse(result)

            expect(parsed.success).toBe(true)
            expect(parsed.tokens).toBeNull()
            expect(parsed.tokenCount).toBeNull()

            // saveAndActivate 也应收到 null
            const saveArgs = mockSaveAndActivate.mock.calls[0][0]
            expect(saveArgs.tokens).toBeNull()
            expect(saveArgs.tokenCount).toBeNull()
        })

        it('config.configurable.state 存在但 _totalTokensConsumed 为 0 时，保持 tokens 为 null', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 55, version: 1 })
            mockPublishCustomEvent.mockResolvedValueOnce(undefined)

            const ctx = createContext()
            const tool = createTool(ctx)

            const result = (await tool.invoke(
                { analysisResult: '结果' },
                {
                    configurable: {
                        state: { _totalTokensConsumed: 0 },
                    },
                },
            )) as string
            const parsed = JSON.parse(result)

            expect(parsed.success).toBe(true)
            expect(parsed.tokens).toBeNull()
            expect(parsed.tokenCount).toBeNull()
        })

        it('getState 返回空对象（_totalTokensConsumed 为 undefined）时走 ?? 0 分支', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 66, version: 1 })
            mockPublishCustomEvent.mockResolvedValueOnce(undefined)

            // 返回一个存在但字段缺失的 state，触发 `state._totalTokensConsumed ?? 0`
            const getState = vi.fn(async () => ({} as Record<string, any>))
            const ctx = createContext({ getState })
            const tool = createTool(ctx)

            const result = (await tool.invoke({ analysisResult: '结果' })) as string
            const parsed = JSON.parse(result)

            expect(parsed.success).toBe(true)
            expect(parsed.tokens).toBeNull()
            expect(parsed.tokenCount).toBeNull()
        })

        it('config.configurable.state 存在但 _totalTokensConsumed 为 undefined 时走 ?? 0 分支', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 67, version: 1 })
            mockPublishCustomEvent.mockResolvedValueOnce(undefined)

            const ctx = createContext()
            const tool = createTool(ctx)

            const result = (await tool.invoke(
                { analysisResult: '结果' },
                {
                    configurable: {
                        // state 存在但 _totalTokensConsumed 缺失
                        state: {},
                    },
                },
            )) as string
            const parsed = JSON.parse(result)

            expect(parsed.success).toBe(true)
            expect(parsed.tokens).toBeNull()
            expect(parsed.tokenCount).toBeNull()
        })
    })

    describe('invoke - 错误路径', () => {
        it('saveAndActivateAnalysisService 抛出 Error 时返回 success=false 并包含 error.message', async () => {
            mockSaveAndActivate.mockRejectedValueOnce(new Error('数据库写入失败'))

            const ctx = createContext()
            const tool = createTool(ctx)
            const result = (await tool.invoke({ analysisResult: '结果' })) as string
            const parsed = JSON.parse(result)

            expect(parsed.success).toBe(false)
            expect(parsed.error).toBe('数据库写入失败')
            // publishCustomEvent 不应被调用
            expect(mockPublishCustomEvent).not.toHaveBeenCalled()
        })

        it('saveAndActivate 抛出无 message 的错误时，返回默认提示', async () => {
            // 抛出一个没有 message 的 "空对象" 异常，触发 error.message || 默认值 分支
            mockSaveAndActivate.mockRejectedValueOnce({})

            const ctx = createContext()
            const tool = createTool(ctx)
            const result = (await tool.invoke({ analysisResult: '结果' })) as string
            const parsed = JSON.parse(result)

            expect(parsed.success).toBe(false)
            expect(parsed.error).toBe('保存分析结果失败')
        })

        it('publishCustomEvent 抛错时整个工具走 catch 分支', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 77, version: 1 })
            mockPublishCustomEvent.mockRejectedValueOnce(new Error('Redis 不可用'))

            const ctx = createContext()
            const tool = createTool(ctx)
            const result = (await tool.invoke({ analysisResult: '结果' })) as string
            const parsed = JSON.parse(result)

            expect(parsed.success).toBe(false)
            expect(parsed.error).toBe('Redis 不可用')
        })
    })
})
