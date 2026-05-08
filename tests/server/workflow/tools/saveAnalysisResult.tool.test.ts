/**
 * save_analysis_result 工具测试
 *
 * **Feature: save-analysis-result-tool**
 * **Validates: 模块对话 Agent 保存分析结果的工具实现**
 *
 * 覆盖：
 * - 工具不再接收 input.analysisResult，从 runtime.state.messages 倒序提取最近一条 AI 文本
 * - content 形态兼容：string / Array<text+thinking>
 * - 最后一条 AI content 为空时倒序往前找
 * - 没有 AI 消息时返回 success:false
 * - 保存成功后同步 emit ANALYSIS_RESULT_SAVED + ANALYSIS_SUMMARY(start)
 * - await completeAnalysisWithRAG 成功 → emit ANALYSIS_SUMMARY(end, success:true, summary)
 * - completeAnalysisWithRAG 失败 → emit ANALYSIS_SUMMARY(end, success:false, error)，tool 仍 return success
 * - DB 落库失败 → 不发任何 SUMMARY 事件
 * - getState / state.runtime fallback 读取 _totalTokensConsumed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger（Nuxt 自动导入的全局变量）
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// Mock crypto.randomUUID 让 toolCallId 可预测
vi.stubGlobal('crypto', {
    ...globalThis.crypto,
    randomUUID: () => 'summary-tool-call-id-fixed',
})

// Mock analysis.service 中的 saveAndActivateAnalysisService
const mockSaveAndActivate = vi.fn()
vi.mock('~~/server/services/case/analysis.service', () => ({
    saveAndActivateAnalysisService: (...args: any[]) => mockSaveAndActivate(...args),
}))

// Mock initAnalysis.service 中的 completeAnalysisWithRAG
const mockCompleteAnalysisWithRAG = vi.fn()
vi.mock('~~/server/services/case/initAnalysis.service', () => ({
    completeAnalysisWithRAG: (...args: any[]) => mockCompleteAnalysisWithRAG(...args),
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
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'

/** 构造最小 ModuleToolContext */
const mockModel = {} as any
const createContext = (overrides: Partial<ModuleToolContext> = {}): ModuleToolContext => ({
    userId: 1,
    caseId: 100,
    sessionId: 'session-abc',
    runId: 'run-xyz',
    moduleName: 'analysis_summary',
    nodeId: 10,
    model: mockModel,
    ...overrides,
})

/** 构造一条带 id 的 AIMessage（让 parentMessageId 可断言） */
function makeAi(content: any, id = 'ai-msg-1'): BaseMessage {
    const m = new AIMessage({ content })
    ;(m as any).id = id
    return m
}

/** 构造一条 HumanMessage */
function makeHuman(content: string, id = 'human-1'): BaseMessage {
    const m = new HumanMessage({ content })
    ;(m as any).id = id
    return m
}

/**
 * langchain v1 的 ToolNode 调 tool.invoke 时把 state/toolCallId 等塞进 config 第二参。
 * 测试里直接传第二参（runtime）模拟这种行为。
 */
function callTool(
    tool: any,
    state: { messages: BaseMessage[]; _totalTokensConsumed?: number } | null,
    extras: Record<string, any> = {},
): Promise<string> {
    return tool.invoke({}, {
        toolCallId: 'save-tool-call-id',
        state,
        ...extras,
    })
}

describe('save_analysis_result 工具', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 默认 completeAnalysisWithRAG 返回真摘要
        mockCompleteAnalysisWithRAG.mockResolvedValue('真实生成的 200-400 字摘要内容')
        mockPublishCustomEvent.mockResolvedValue(undefined)
    })

    describe('工具定义', () => {
        it('toolDefinition 应包含正确的名称与描述', () => {
            expect(toolDefinition.name).toBe('save_analysis_result')
            expect(toolDefinition.description).toContain('保存')
        })

        it('toolDefinition.schema 应是空对象（不收任何参数）', () => {
            const good = toolDefinition.schema.safeParse({})
            expect(good.success).toBe(true)
            // schema 是 z.object({})，多余字段 zod 默认 strip
            const withExtra = toolDefinition.schema.safeParse({ analysisResult: 'xx' })
            expect(withExtra.success).toBe(true)
        })

        it('createTool 返回的工具名称与定义一致', () => {
            const tool = createTool(createContext())
            expect(tool.name).toBe('save_analysis_result')
            expect(tool.description).toContain('保存')
        })
    })

    describe('从 state.messages 提取分析报告正文', () => {
        it('最后一条 AIMessage content 为 string 时直接使用', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 11, version: 3 })
            const tool = createTool(createContext())

            const messages = [
                makeHuman('请生成分析报告'),
                makeAi('# 分析结论\n\n这是完整的分析报告正文。', 'ai-1'),
            ]
            const result = JSON.parse(await callTool(tool, { messages }))

            expect(result.success).toBe(true)
            expect(result.version).toBe(3)

            // saveAndActivate 收到的 analysisResult 应是 AIMessage.content
            const saveArgs = mockSaveAndActivate.mock.calls[0][0]
            expect(saveArgs.analysisResult).toBe('# 分析结论\n\n这是完整的分析报告正文。')
        })

        it('content 是 Array<text+thinking>时，仅拼接 type=text 的部分', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 12, version: 1 })
            const tool = createTool(createContext())

            const messages = [
                makeHuman('请生成分析报告'),
                makeAi(
                    [
                        { type: 'thinking', thinking: '内部思考不应进入正文' },
                        { type: 'text', text: '## 第一段' },
                        { type: 'text', text: '\n\n## 第二段' },
                    ],
                    'ai-2',
                ),
            ]
            await callTool(tool, { messages })

            const saveArgs = mockSaveAndActivate.mock.calls[0][0]
            expect(saveArgs.analysisResult).toBe('## 第一段\n\n## 第二段')
            expect(saveArgs.analysisResult).not.toContain('内部思考')
        })

        it('最后一条 AI content 空时，倒序回退到前一条带文本的 AI', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 13, version: 1 })
            const tool = createTool(createContext())

            const messages = [
                makeHuman('生成报告'),
                makeAi('完整的报告正文', 'ai-with-text'),
                // LLM 在第二条 AIMessage 中只调工具不输出文本（content 空）
                makeAi('', 'ai-empty-tool-call'),
            ]
            await callTool(tool, { messages })

            const saveArgs = mockSaveAndActivate.mock.calls[0][0]
            expect(saveArgs.analysisResult).toBe('完整的报告正文')
        })

        it('没有任何带文本的 AI 消息时返回 success:false', async () => {
            const tool = createTool(createContext())

            const messages = [
                makeHuman('生成报告'),
                makeAi('', 'ai-empty'),
            ]
            const result = JSON.parse(await callTool(tool, { messages }))

            expect(result.success).toBe(false)
            expect(result.error).toContain('未找到带文本')
            expect(mockSaveAndActivate).not.toHaveBeenCalled()
            expect(mockPublishCustomEvent).not.toHaveBeenCalled()
        })

        it('state 为 null 时返回 success:false', async () => {
            const tool = createTool(createContext())
            const result = JSON.parse(await callTool(tool, null))

            expect(result.success).toBe(false)
            expect(result.error).toContain('未找到带文本')
            expect(mockSaveAndActivate).not.toHaveBeenCalled()
        })
    })

    describe('保存成功 + 摘要事件', () => {
        const baseMessages = (): BaseMessage[] => [
            makeHuman('请分析'),
            makeAi('# 完整分析报告', 'ai-anchor-id'),
        ]

        it('落库后依次发出 RESULT_SAVED → SUMMARY(start) → SUMMARY(end success:true)', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 99, version: 1 })
            mockCompleteAnalysisWithRAG.mockResolvedValueOnce('200-400 字真摘要')
            const tool = createTool(createContext())

            const result = JSON.parse(await callTool(tool, { messages: baseMessages() }))

            expect(result.success).toBe(true)
            expect(result.version).toBe(1)

            // emit 事件顺序与 payload 校验
            expect(mockPublishCustomEvent).toHaveBeenCalledTimes(3)

            const [savedCall, startCall, endCall] = mockPublishCustomEvent.mock.calls
            // 1. ANALYSIS_RESULT_SAVED
            expect(savedCall[0].name).toBe('analysis_result_saved')
            expect(savedCall[0].data.analysisId).toBe(99)
            expect(savedCall[0].data.version).toBe(1)
            expect(savedCall[0].data.moduleName).toBe('analysis_summary')

            // 2. ANALYSIS_SUMMARY start
            expect(startCall[0].name).toBe('analysis_summary')
            expect(startCall[0].data.phase).toBe('start')
            expect(startCall[0].data.toolCallId).toBe('summary-tool-call-id-fixed')
            expect(startCall[0].data.parentMessageId).toBe('ai-anchor-id')
            expect(startCall[0].data.analysisId).toBe(99)

            // 3. ANALYSIS_SUMMARY end success:true with summary
            expect(endCall[0].name).toBe('analysis_summary')
            expect(endCall[0].data.phase).toBe('end')
            expect(endCall[0].data.success).toBe(true)
            expect(endCall[0].data.summary).toBe('200-400 字真摘要')
            expect(endCall[0].data.toolCallId).toBe('summary-tool-call-id-fixed')
            expect(endCall[0].data.parentMessageId).toBe('ai-anchor-id')
        })

        it('completeAnalysisWithRAG 失败时仍 return success（save 已落库），end 事件 success:false', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 100, version: 2 })
            mockCompleteAnalysisWithRAG.mockRejectedValueOnce(new Error('LLM 摘要超时'))
            const tool = createTool(createContext())

            const result = JSON.parse(await callTool(tool, { messages: baseMessages() }))

            // save 已落库，工具整体仍返回 success
            expect(result.success).toBe(true)
            expect(result.version).toBe(2)

            // 仍发了 3 条事件，但 end 是 success:false
            expect(mockPublishCustomEvent).toHaveBeenCalledTimes(3)
            const endCall = mockPublishCustomEvent.mock.calls[2][0]
            expect(endCall.data.phase).toBe('end')
            expect(endCall.data.success).toBe(false)
            expect(endCall.data.error).toBe('LLM 摘要超时')
        })

        it('saveAndActivate 失败时不发任何 SUMMARY 事件', async () => {
            mockSaveAndActivate.mockRejectedValueOnce(new Error('数据库写入失败'))
            const tool = createTool(createContext())

            const result = JSON.parse(await callTool(tool, { messages: baseMessages() }))

            expect(result.success).toBe(false)
            expect(result.error).toBe('数据库写入失败')
            expect(mockPublishCustomEvent).not.toHaveBeenCalled()
            expect(mockCompleteAnalysisWithRAG).not.toHaveBeenCalled()
        })
    })

    describe('token 消耗读取', () => {
        const baseMessages = (extra: Record<string, any> = {}): { messages: BaseMessage[] } & Record<string, any> => ({
            messages: [makeHuman('q'), makeAi('# r', 'ai-1')],
            ...extra,
        })

        it('从 getState() 读取 _totalTokensConsumed 并计算 tokenCount', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 1, version: 1 })
            const getState = vi.fn(async () => ({ _totalTokensConsumed: 3500 }))
            const tool = createTool(createContext({ getState }))

            const result = JSON.parse(await callTool(tool, baseMessages()))

            expect(result.tokens).toBe(3500)
            expect(result.tokenCount).toBe(4)
            const saveArgs = mockSaveAndActivate.mock.calls[0][0]
            expect(saveArgs.tokens).toBe(3500)
            expect(saveArgs.tokenCount).toBe(4)
        })

        it('getState 没拿到时 fallback 到 runtime.state._totalTokensConsumed', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 2, version: 1 })
            const tool = createTool(createContext())

            const state = baseMessages({ _totalTokensConsumed: 2001 })
            const result = JSON.parse(await callTool(tool, state))

            expect(result.tokens).toBe(2001)
            expect(result.tokenCount).toBe(3)
        })

        it('两条路径都没有 token 时 tokens/tokenCount 为 null', async () => {
            mockSaveAndActivate.mockResolvedValueOnce({ id: 3, version: 1 })
            const tool = createTool(createContext())

            const result = JSON.parse(await callTool(tool, baseMessages()))

            expect(result.tokens).toBeNull()
            expect(result.tokenCount).toBeNull()
        })
    })

    describe('上下文异常', () => {
        it('caseId 缺失时返回 success:false', async () => {
            const tool = createTool(createContext({ caseId: undefined }))
            const result = JSON.parse(
                await callTool(tool, { messages: [makeAi('# r', 'ai-1')] }),
            )
            expect(result.success).toBe(false)
            expect(result.error).toContain('caseId')
            expect(mockSaveAndActivate).not.toHaveBeenCalled()
        })
    })
})
