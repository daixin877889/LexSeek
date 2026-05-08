/**
 * buildSubAgentCallbacks 单测
 *
 * 验证 3 个 handler 行为（status_change 由调用方在 invoke 完成后显式发，不在 callback 内）：
 * - handleLLMNewToken → publishCustomEvent SUB_AGENT_TOKEN / SUB_AGENT_THINKING_TOKEN
 * - handleToolStart → publishCustomEvent SUB_AGENT_TOOL_START，data 含 innerToolCallId/input/cbRunId/toolName
 * - handleToolEnd → publishCustomEvent SUB_AGENT_TOOL_END，data 含 cbRunId/output
 * - publish 抛错时不向上传播（.catch 兜底）
 *
 * 注：handleChainEnd / handleChainError 已删除——LangGraph 多层 chain 包装下 cbParentRunId
 * === undefined 不止匹配最外层，子代理还在跑就会触发 completed → 前端 generatingModules
 * 提前清空、跨标签 module:generating 提前广播 modules=[]。所有调用方（subAgentToolFactory /
 * reviewContract / draftDocument）已经在 invoke / drainStream 完成后显式调
 * publishSubAgentStatus 兜底。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { publishCustomEventMock } = vi.hoisted(() => ({
    publishCustomEventMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('~~/server/services/agent/agentEventBridge', () => ({
    publishCustomEvent: publishCustomEventMock,
}))
vi.mock('#shared/utils/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { buildSubAgentCallbacks } from '~~/server/services/agent-platform/subAgent/buildSubAgentCallbacks'
import { SSECustomEventType } from '#shared/types/agentEvent'

const opts = {
    mainRunId: 'run-1',
    sessionId: 'sess-1',
    parentToolCallId: 'call-X',
    agentName: 'documentMain',
    subThreadId: 'sub-thread-1',
}
const expectedMeta = {
    agentName: 'documentMain',
    threadId: 'sub-thread-1',
    parentToolCallId: 'call-X',
}

describe('buildSubAgentCallbacks', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('返回单元素数组 + 仅含 3 个增量事件 handler（status_change 由调用方在 invoke 后显式发）', () => {
        const cbs = buildSubAgentCallbacks(opts)
        expect(cbs).toHaveLength(1)
        const h = cbs[0]!
        expect(typeof h.handleLLMNewToken).toBe('function')
        expect(typeof h.handleToolStart).toBe('function')
        expect(typeof h.handleToolEnd).toBe('function')
        // status_change 不再由 callback 发——避免 LangGraph 多层 chain 提前触发 completed
        expect(h.handleChainEnd).toBeUndefined()
        expect(h.handleChainError).toBeUndefined()
    })

    it('handleLLMNewToken → publishCustomEvent SUB_AGENT_TOKEN', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        await h.handleLLMNewToken!('hello', undefined as any, 'cb-1')
        expect(publishCustomEventMock).toHaveBeenCalledWith({
            type: 'custom_event',
            runId: 'run-1',
            sessionId: 'sess-1',
            name: SSECustomEventType.SUB_AGENT_TOKEN,
            data: undefined,
            metadata: { ...expectedMeta, messageId: 'cb-1', delta: 'hello' },
        })
    })

    it('handleLLMNewToken 空 token + 无 chunk → 不发事件', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        await h.handleLLMNewToken!('', undefined as any, 'cb-1')
        expect(publishCustomEventMock).not.toHaveBeenCalled()
    })

    it('handleLLMNewToken 从 fields.chunk 提取 Anthropic thinking block → 发 SUB_AGENT_THINKING_TOKEN', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        // Anthropic 的 thinking chunk：token 参数被 extractToken 返回 undefined（""），
        // 真实内容在 fields.chunk.message.content[0] = { type:'thinking', thinking:'...' }
        const fields: any = {
            chunk: {
                message: {
                    content: [{ type: 'thinking', thinking: '正在思考要件构成…' }],
                },
            },
        }
        await h.handleLLMNewToken!('', undefined as any, 'cb-1', undefined, undefined, fields)
        expect(publishCustomEventMock).toHaveBeenCalledWith({
            type: 'custom_event',
            runId: 'run-1',
            sessionId: 'sess-1',
            name: SSECustomEventType.SUB_AGENT_THINKING_TOKEN,
            data: undefined,
            metadata: { ...expectedMeta, messageId: 'cb-1', delta: '正在思考要件构成…' },
        })
    })

    it('handleLLMNewToken 从 fields.chunk 提取 DeepSeek/o1 reasoning_content → 发 SUB_AGENT_THINKING_TOKEN', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        const fields: any = {
            chunk: {
                message: {
                    content: '',
                    additional_kwargs: { reasoning_content: '让我推理下这一步…' },
                },
            },
        }
        await h.handleLLMNewToken!('', undefined as any, 'cb-1', undefined, undefined, fields)
        expect(publishCustomEventMock).toHaveBeenCalledWith({
            type: 'custom_event',
            runId: 'run-1',
            sessionId: 'sess-1',
            name: SSECustomEventType.SUB_AGENT_THINKING_TOKEN,
            data: undefined,
            metadata: { ...expectedMeta, messageId: 'cb-1', delta: '让我推理下这一步…' },
        })
    })

    it('handleLLMNewToken 同一 chunk 含 text token 又含 thinking → 两个事件都发', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        const fields: any = {
            chunk: {
                message: {
                    additional_kwargs: { reasoning_content: '思考' },
                },
            },
        }
        await h.handleLLMNewToken!('文本', undefined as any, 'cb-1', undefined, undefined, fields)
        expect(publishCustomEventMock).toHaveBeenCalledTimes(2)
        expect(publishCustomEventMock).toHaveBeenCalledWith(expect.objectContaining({
            name: SSECustomEventType.SUB_AGENT_TOKEN,
            metadata: expect.objectContaining({ delta: '文本' }),
        }))
        expect(publishCustomEventMock).toHaveBeenCalledWith(expect.objectContaining({
            name: SSECustomEventType.SUB_AGENT_THINKING_TOKEN,
            metadata: expect.objectContaining({ delta: '思考' }),
        }))
    })

    it('handleToolStart → publishCustomEvent SUB_AGENT_TOOL_START（含 toolName=runName）', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        await h.handleToolStart!(
            { id: ['langchain', 'tools', 'DynamicStructuredTool'] } as any,
            '{"q":"民间借贷"}', 'cb-2',
            undefined, undefined, undefined, 'search_law',
            'inner-tc-1',
        )
        expect(publishCustomEventMock).toHaveBeenCalledWith(expect.objectContaining({
            name: SSECustomEventType.SUB_AGENT_TOOL_START,
            data: { innerToolCallId: 'inner-tc-1', input: '{"q":"民间借贷"}', cbRunId: 'cb-2', toolName: 'search_law' },
            metadata: expectedMeta,
        }))
    })

    it('handleToolStart runName 未传时 → toolName="unknown_tool"（兜底，理论不发生）', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        await h.handleToolStart!(
            {} as any,
            'in', 'cb',
            undefined, undefined, undefined, undefined,
            'inner-2',
        )
        expect(publishCustomEventMock).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ toolName: 'unknown_tool' }),
        }))
    })

    it('handleToolEnd → publishCustomEvent SUB_AGENT_TOOL_END', async () => {
        const h = buildSubAgentCallbacks(opts)[0]!
        await h.handleToolEnd!('out-data', 'cb-3')
        expect(publishCustomEventMock).toHaveBeenCalledWith(expect.objectContaining({
            name: SSECustomEventType.SUB_AGENT_TOOL_END,
            data: { cbRunId: 'cb-3', output: 'out-data' },
            metadata: expectedMeta,
        }))
    })

    it('publishCustomEvent 抛错时不向上传播（.catch 兜底，handleLLMNewToken）', async () => {
        publishCustomEventMock.mockRejectedValueOnce(new Error('redis down'))
        const h = buildSubAgentCallbacks(opts)[0]!
        await expect(h.handleLLMNewToken!('x', undefined as any, 'cb')).resolves.toBeUndefined()
    })

    it('publishCustomEvent 抛错时不向上传播（.catch 兜底，handleToolStart）', async () => {
        publishCustomEventMock.mockRejectedValueOnce(new Error('redis down'))
        const h = buildSubAgentCallbacks(opts)[0]!
        await expect(h.handleToolStart!({} as any, 'in', 'cb', undefined, undefined, undefined, 't1', 'tc-1')).resolves.toBeUndefined()
    })

    it('publishCustomEvent 抛错时不向上传播（.catch 兜底，handleToolEnd）', async () => {
        publishCustomEventMock.mockRejectedValueOnce(new Error('redis down'))
        const h = buildSubAgentCallbacks(opts)[0]!
        await expect(h.handleToolEnd!('out', 'cb')).resolves.toBeUndefined()
    })
})
