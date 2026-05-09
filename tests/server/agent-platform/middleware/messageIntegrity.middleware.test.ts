/**
 * messageIntegrity middleware 单测
 *
 * 验证：
 * - afterModel 抢救 LLM 输出的 invalid_tool_calls(args malformed JSON)
 *   - 转换为合成 tool_calls + 错误反馈 ToolMessage
 *   - jumpTo='model' 让 LLM retry
 *   - 超过最大 retry 次数时停止 jumpTo
 * - beforeModel 同时处理 historical invalid_tool_calls(从 checkpoint 恢复)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }))
vi.mock('#shared/utils/logger', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: warnSpy, debug: vi.fn() },
}))
;(globalThis as any).logger = { info: vi.fn(), error: vi.fn(), warn: warnSpy, debug: vi.fn() }

import { createMessageIntegrityMiddleware } from '~~/server/services/agent-platform/middleware/messageIntegrity.middleware'
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'

beforeEach(() => {
    vi.clearAllMocks()
})

/** 构造一个 LLM 输出 invalid_tool_calls 的 AIMessage(模拟 args malformed JSON) */
function makeInvalidToolCallMessage(toolName = 'save_document_draft', id = 'call_abc'): AIMessage {
    const msg = new AIMessage({
        content: '现在创建草稿。',
        tool_calls: [],
    })
    ;(msg as any).invalid_tool_calls = [{
        name: toolName,
        args: '{"templateId": 1, "fieldValues": {"证据": "合同约定"不缴社保"的内容"}}',
        id,
        error: 'Malformed args.',
        type: 'invalid_tool_call',
    }]
    return msg
}

async function runAfterModel(state: { messages: any[], _invalidToolCallRetries?: number }) {
    const mw = createMessageIntegrityMiddleware()
    const hookConfig = (mw as any).afterModel
    const hook = typeof hookConfig === 'function' ? hookConfig : hookConfig.hook
    return hook(state, { context: {} } as any)
}

async function runBeforeModel(state: { messages: any[] }) {
    const mw = createMessageIntegrityMiddleware()
    const hookConfig = (mw as any).beforeModel
    const hook = typeof hookConfig === 'function' ? hookConfig : hookConfig.hook
    return hook(state, { context: {} } as any)
}

describe('afterModel: 抢救 invalid_tool_calls', () => {
    it('LLM 输出 malformed args 时,把 invalid 提升为合成 tool_calls + 追加错误 ToolMessage + jumpTo=model', async () => {
        const invalidMsg = makeInvalidToolCallMessage('save_document_draft', 'call_abc')
        const state = {
            messages: [
                new HumanMessage('生成起诉状'),
                invalidMsg,
            ],
        }

        const result = await runAfterModel(state)

        expect(result?.jumpTo).toBe('model')
        expect(result?._invalidToolCallRetries).toBe(1)

        // state.messages 应该被原地修改:invalid AIMessage 替换为合成 + 追加 ToolMessage
        expect(state.messages.length).toBe(3) // human + fixedAI + errorTool

        const fixedAI = state.messages[1]
        expect(fixedAI).toBeInstanceOf(AIMessage)
        expect((fixedAI as AIMessage).tool_calls).toHaveLength(1)
        expect((fixedAI as AIMessage).tool_calls?.[0]).toMatchObject({
            name: 'save_document_draft',
            id: 'call_abc',
            args: {},
        })
        // invalid_tool_calls 应该被清空
        expect(((fixedAI as AIMessage) as any).invalid_tool_calls).toEqual([])

        const errorTool = state.messages[2]
        expect(errorTool).toBeInstanceOf(ToolMessage)
        expect((errorTool as ToolMessage).tool_call_id).toBe('call_abc')
        expect((errorTool as ToolMessage).status).toBe('error')
        expect((errorTool as ToolMessage).content).toContain('save_document_draft')
        expect((errorTool as ToolMessage).content).toContain('Malformed args')
        expect((errorTool as ToolMessage).content).toContain('禁用半角双引号')
    })

    it('lastMessage 已有合法 tool_calls 时不抢救', async () => {
        const validMsg = new AIMessage({
            content: '',
            tool_calls: [{ name: 'search_law', args: { query: '社保' }, id: 'tc_1', type: 'tool_call' }],
        })
        const state = { messages: [new HumanMessage('q'), validMsg] }
        const before = JSON.stringify(state.messages)

        const result = await runAfterModel(state)
        expect(result).toBeUndefined()
        expect(JSON.stringify(state.messages)).toBe(before)
    })

    it('lastMessage 不是 AIMessage(纯 ToolMessage)时不抢救', async () => {
        const state = {
            messages: [
                new HumanMessage('q'),
                new ToolMessage({ tool_call_id: 'x', content: 'r' }),
            ],
        }
        const result = await runAfterModel(state)
        expect(result).toBeUndefined()
    })

    it('达到 MAX_INVALID_TOOL_CALL_RETRIES=3 时仍然抢救但不再 jumpTo(防死循环)', async () => {
        const state = {
            messages: [new HumanMessage('q'), makeInvalidToolCallMessage()],
            _invalidToolCallRetries: 3,
        }

        const result = await runAfterModel(state)

        // 抢救还是做了(消息序列保持一致),但不 jumpTo
        expect(result?.jumpTo).toBeUndefined()
        expect(result?._invalidToolCallRetries).toBe(4)
        expect(state.messages.length).toBe(3)
    })

    it('多个 invalid_tool_calls 同时存在时,各自合成 + 追加', async () => {
        const msg = new AIMessage({ content: '', tool_calls: [] })
        ;(msg as any).invalid_tool_calls = [
            { name: 'save_document_draft', args: '{bad}', id: 'a', error: 'e1', type: 'invalid_tool_call' },
            { name: 'update_document_draft', args: '{bad}', id: 'b', error: 'e2', type: 'invalid_tool_call' },
        ]
        const state = { messages: [new HumanMessage('q'), msg] }

        await runAfterModel(state)

        expect(state.messages.length).toBe(4) // human + fixedAI + 2 errorTool
        const fixedAI = state.messages[1] as AIMessage
        expect(fixedAI.tool_calls).toHaveLength(2)
        expect(state.messages[2]).toBeInstanceOf(ToolMessage)
        expect(state.messages[3]).toBeInstanceOf(ToolMessage)
        expect((state.messages[2] as ToolMessage).tool_call_id).toBe('a')
        expect((state.messages[3] as ToolMessage).tool_call_id).toBe('b')
    })

    it('invalid_tool_call 没有 id 时合成一个 synthetic id 并保持配对', async () => {
        const msg = new AIMessage({ content: '', tool_calls: [] })
        ;(msg as any).invalid_tool_calls = [
            { name: 'save_document_draft', args: '{bad}', error: 'e', type: 'invalid_tool_call' },
        ]
        const state = { messages: [new HumanMessage('q'), msg] }

        await runAfterModel(state)

        const fixedAI = state.messages[1] as AIMessage
        const errorTool = state.messages[2] as ToolMessage
        expect(fixedAI.tool_calls?.[0]?.id).toBeTruthy()
        expect(fixedAI.tool_calls?.[0]?.id?.startsWith('synthetic_')).toBe(true)
        expect(errorTool.tool_call_id).toBe(fixedAI.tool_calls?.[0]?.id)
    })
})

describe('beforeModel: 兼容现有 orphan tool_use 修复 + 历史 invalid_tool_calls 抢救', () => {
    it('完整序列(无 orphan、无 invalid)时不修改', async () => {
        const state = {
            messages: [
                new HumanMessage('q'),
                new AIMessage({
                    content: '',
                    tool_calls: [{ name: 'foo', args: {}, id: 't1', type: 'tool_call' }],
                }),
                new ToolMessage({ tool_call_id: 't1', content: 'ok' }),
            ],
        }
        const before = state.messages.length
        const result = await runBeforeModel(state)
        expect(result).toBeUndefined()
        expect(state.messages.length).toBe(before)
    })

    it('从 checkpoint 恢复时,中间出现 historical invalid_tool_calls 也会被抢救', async () => {
        const invalidHistory = makeInvalidToolCallMessage('save_document_draft', 'old_call_xyz')
        const state = {
            messages: [
                new HumanMessage('生成起诉状'),
                invalidHistory,
                new HumanMessage('继续'), // 用户重新输入
            ],
        }

        const result = await runBeforeModel(state)

        // 应记录为已修复
        expect(result?._messageIntegrityFixedTotal).toBeGreaterThan(0)

        // history 中的 invalid AIMessage 应该被替换+追加错误 ToolMessage
        expect(state.messages.length).toBe(4) // human + fixedAI + errorTool + human2
        const fixedAI = state.messages[1] as AIMessage
        expect(fixedAI.tool_calls?.[0]?.id).toBe('old_call_xyz')
        expect((state.messages[2] as ToolMessage).tool_call_id).toBe('old_call_xyz')
        expect(state.messages[3]).toBeInstanceOf(HumanMessage)
    })

    it('已污染的 checkpoint(同 tool_call_id 有重复 ToolMessage)被去重保留第一条', async () => {
        // 模拟旧 bug 期间持久化的状态:同 id 有两条 ToolMessage(revive + repair)。
        // beforeModel 必须把后者去掉,否则 Anthropic API 返回 'each tool_use must have a single result'。
        const aiMsg = new AIMessage({
            content: '',
            tool_calls: [{ name: 'save_document_draft', args: {}, id: 'call_dup', type: 'tool_call' }],
        })
        const state = {
            messages: [
                new HumanMessage('q'),
                aiMsg,
                new ToolMessage({ tool_call_id: 'call_dup', content: 'Error: Malformed args.', status: 'error' }), // revive
                new ToolMessage({ tool_call_id: 'call_dup', content: '工具执行被中断：xxx', status: 'error' }), // repair 重复
                new HumanMessage('继续'),
            ],
        }
        const result = await runBeforeModel(state)

        expect(result?._messageIntegrityFixedTotal).toBeGreaterThan(0)
        // 同 id 的 ToolMessage 只剩 1 条
        const tools = state.messages.filter(m => m instanceof ToolMessage && (m as ToolMessage).tool_call_id === 'call_dup')
        expect(tools).toHaveLength(1)
        // 保留的是第一条(revive 加的详细错误)
        expect((tools[0] as ToolMessage).content).toContain('Malformed args')
    })

    it('回归: invalid AIMessage 的 content 还包含 tool_use block,不能被 repair 重复加 ToolMessage(同 id)', async () => {
        // 模拟真实场景:LangChain 从 LLM 流收到 tool_use block,JSON.parse(args) 失败,
        // 把 tool_call 移到 invalid_tool_calls,但 content 数组里仍然保留了 raw tool_use block。
        // repairRuntimeMessages 通过 content[*].type==='tool_use' 也会扫到这个 tool_call,
        // 如果 revive 没有先消化,repair 会再加一条同 id 的合成 ToolMessage,
        // 触发 Anthropic API 'each tool_use must have a single result' 400。
        const msg = new AIMessage({
            content: [
                { type: 'text', text: '现在创建草稿。' },
                {
                    type: 'tool_use',
                    id: 'call_dup_xyz',
                    name: 'save_document_draft',
                    input: '{bad json}', // 故意 malformed
                },
            ] as any,
            tool_calls: [],
        })
        ;(msg as any).invalid_tool_calls = [{
            name: 'save_document_draft',
            args: '{bad json}',
            id: 'call_dup_xyz',
            error: 'Malformed args.',
            type: 'invalid_tool_call',
        }]

        const state = {
            messages: [
                new HumanMessage('q'),
                msg,
                new HumanMessage('继续'),
            ],
        }

        await runBeforeModel(state)

        // 关键断言: 同 id 的 ToolMessage **只能有一条**(revive 加的那条),
        // repair 不应该再加重复的——否则 Anthropic API 会 400
        const matchingTools = state.messages.filter(
            m => m instanceof ToolMessage && (m as ToolMessage).tool_call_id === 'call_dup_xyz',
        )
        expect(matchingTools).toHaveLength(1)
        // 该唯一 ToolMessage 应该是 revive 加的(包含 'Malformed args' 详细描述),
        // 而不是 repair 加的粗糙'工具执行被中断'
        expect((matchingTools[0] as ToolMessage).content).toContain('Malformed args')
        expect((matchingTools[0] as ToolMessage).content).not.toContain('工具执行被中断')
    })
})
