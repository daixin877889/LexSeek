/**
 * orphan tool_use 修复的纯函数单元测试
 *
 * **Feature: agent-error-recovery**
 * **Validates: repairSerializedMessages 检测并修复 LangGraph checkpoint 中
 * 工具节点中断留下的 orphan AIMessage(tool_use)**
 */
import { describe, it, expect } from 'vitest'
import { AIMessage, AIMessageChunk, HumanMessage, ToolMessage } from '@langchain/core/messages'
import type { SerializedMessage } from '../../../server/services/workflow/repairOrphanToolUse'
import { repairRuntimeMessages, repairSerializedMessages } from '../../../server/services/workflow/repairOrphanToolUse'

function aiMsg(toolCalls: Array<{ id: string; name?: string }>, cls: 'AIMessage' | 'AIMessageChunk' = 'AIMessage'): SerializedMessage {
    return {
        lc: 1,
        type: 'constructor',
        id: ['langchain_core', 'messages', cls],
        kwargs: {
            content: '',
            tool_calls: toolCalls.map(tc => ({ id: tc.id, name: tc.name ?? 'test_tool', args: {}, type: 'tool_call' })),
        },
    }
}

function toolMsg(toolCallId: string, content = 'ok'): SerializedMessage {
    return {
        lc: 1,
        type: 'constructor',
        id: ['langchain_core', 'messages', 'ToolMessage'],
        kwargs: { tool_call_id: toolCallId, content, name: 'test_tool' },
    }
}

function humanMsg(content: string): SerializedMessage {
    return {
        lc: 1,
        type: 'constructor',
        id: ['langchain_core', 'messages', 'HumanMessage'],
        kwargs: { content },
    }
}

describe('repairSerializedMessages 检测并修复 orphan tool_use', () => {
    it('无 orphan 时返回 count=0 且不修改数组', () => {
        const messages: SerializedMessage[] = [
            humanMsg('你好'),
            aiMsg([{ id: 'call_1' }]),
            toolMsg('call_1', 'result'),
            aiMsg([]),
        ]
        const { patched, count } = repairSerializedMessages(messages, '无所谓')
        expect(count).toBe(0)
        expect(patched).toBe(messages)
    })

    it('orphan 位于数组末尾时在末尾追加合成 ToolMessage', () => {
        const messages: SerializedMessage[] = [
            humanMsg('开始'),
            aiMsg([{ id: 'call_X', name: 'my_tool' }]),
        ]
        const { patched, count } = repairSerializedMessages(messages, '执行超时')
        expect(count).toBe(1)
        expect(patched).toHaveLength(3)
        expect(patched[2].id[2]).toBe('ToolMessage')
        expect(patched[2].kwargs.tool_call_id).toBe('call_X')
        expect(patched[2].kwargs.content).toBe('工具执行被中断：执行超时')
        expect(patched[2].kwargs.name).toBe('my_tool')
        expect(patched[2].kwargs.status).toBe('error')
    })

    it('orphan 后面有 HumanMessage（用户继续输入）时在 HumanMessage 之前插入', () => {
        const messages: SerializedMessage[] = [
            aiMsg([{ id: 'call_Y' }]),
            humanMsg('继续'),
        ]
        const { patched, count } = repairSerializedMessages(messages, 'cancelled')
        expect(count).toBe(1)
        expect(patched).toHaveLength(3)
        expect(patched[0].id[2]).toBe('AIMessage')
        expect(patched[1].id[2]).toBe('ToolMessage')
        expect(patched[1].kwargs.tool_call_id).toBe('call_Y')
        expect(patched[2].id[2]).toBe('HumanMessage')
        expect(patched[2].kwargs.content).toBe('继续')
    })

    it('AIMessageChunk 同样被识别为需要检查的 AI 类消息', () => {
        const messages: SerializedMessage[] = [
            aiMsg([{ id: 'call_Z' }], 'AIMessageChunk'),
            humanMsg('修'),
            humanMsg('继续'),
        ]
        const { patched, count } = repairSerializedMessages(messages, '中断')
        expect(count).toBe(1)
        expect(patched).toHaveLength(4)
        expect(patched[1].id[2]).toBe('ToolMessage')
        expect(patched[1].kwargs.tool_call_id).toBe('call_Z')
    })

    it('一条 AIMessage 多个 tool_calls 全部 orphan 时全部补齐', () => {
        const messages: SerializedMessage[] = [
            aiMsg([{ id: 'call_A' }, { id: 'call_B' }, { id: 'call_C' }]),
            humanMsg('继续'),
        ]
        const { patched, count } = repairSerializedMessages(messages, '崩溃')
        expect(count).toBe(3)
        expect(patched).toHaveLength(5)
        const insertedIds = new Set([
            patched[1].kwargs.tool_call_id,
            patched[2].kwargs.tool_call_id,
            patched[3].kwargs.tool_call_id,
        ])
        expect(insertedIds).toEqual(new Set(['call_A', 'call_B', 'call_C']))
        expect(patched[4].id[2]).toBe('HumanMessage')
    })

    it('一条 AIMessage 多个 tool_calls 部分已完成时只补未完成的', () => {
        const messages: SerializedMessage[] = [
            aiMsg([{ id: 'call_A' }, { id: 'call_B' }, { id: 'call_C' }]),
            toolMsg('call_A'),
            toolMsg('call_B'),
            humanMsg('继续'),
        ]
        const { patched, count } = repairSerializedMessages(messages, '中断')
        expect(count).toBe(1)
        expect(patched).toHaveLength(5)
        // 合成的 call_C ToolMessage 应插在 call_B 之后、HumanMessage 之前
        expect(patched[3].id[2]).toBe('ToolMessage')
        expect(patched[3].kwargs.tool_call_id).toBe('call_C')
        expect(patched[4].id[2]).toBe('HumanMessage')
    })

    it('空数组时返回 count=0', () => {
        const { patched, count } = repairSerializedMessages([], '无')
        expect(count).toBe(0)
        expect(patched).toEqual([])
    })

    it('修复后再次运行是幂等的（零新增）', () => {
        const messages: SerializedMessage[] = [
            aiMsg([{ id: 'call_Once' }]),
            humanMsg('继续'),
        ]
        const first = repairSerializedMessages(messages, '中断')
        expect(first.count).toBe(1)
        const second = repairSerializedMessages(first.patched, '中断')
        expect(second.count).toBe(0)
        expect(second.patched).toHaveLength(3)
    })
})

describe('repairRuntimeMessages 运行时 BaseMessage 修复', () => {
    it('无 orphan 时 fixed=0 且返回原数组引用', () => {
        const messages = [
            new HumanMessage('你好'),
            new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 't', args: {} }] }),
            new ToolMessage({ tool_call_id: 'call_1', content: 'ok' }),
        ]
        const { patched, fixed } = repairRuntimeMessages(messages, '无')
        expect(fixed).toBe(0)
        expect(patched).toBe(messages)
    })

    it('AIMessage + tool_calls 后紧跟 HumanMessage → 检测出 orphan 并插入 ToolMessage', () => {
        const messages = [
            new HumanMessage('第一次问'),
            new AIMessage({ content: '', tool_calls: [{ id: 'call_orphan', name: 'search', args: {} }] }),
            new HumanMessage('用户重新问了一次'),
        ]
        const { patched, fixed } = repairRuntimeMessages(messages, '上一轮中断')
        expect(fixed).toBe(1)
        expect(patched).toHaveLength(4)
        const injected = patched[2] as ToolMessage
        expect(injected).toBeInstanceOf(ToolMessage)
        expect(injected.tool_call_id).toBe('call_orphan')
        expect(String(injected.content)).toContain('工具执行被中断')
        expect(injected.name).toBe('search')
    })

    it('AIMessageChunk 同样识别为 AI 类消息', () => {
        const messages = [
            new AIMessageChunk({ content: '', tool_calls: [{ id: 'call_chunk', name: 't', args: {} }] }),
            new HumanMessage('继续'),
        ]
        const { fixed } = repairRuntimeMessages(messages, '中断')
        expect(fixed).toBe(1)
    })

    it('末尾 orphan 追加合成 ToolMessage（无后续消息）', () => {
        const messages = [
            new AIMessage({ content: '', tool_calls: [{ id: 'call_tail', name: 't', args: {} }] }),
        ]
        const { patched, fixed } = repairRuntimeMessages(messages, '中断')
        expect(fixed).toBe(1)
        expect(patched).toHaveLength(2)
        expect((patched[1] as ToolMessage).tool_call_id).toBe('call_tail')
    })

    it('多 tool_calls 部分已配对时只补缺失的', () => {
        const messages = [
            new AIMessage({ content: '', tool_calls: [
                { id: 'call_a', name: 't', args: {} },
                { id: 'call_b', name: 't', args: {} },
            ] }),
            new ToolMessage({ tool_call_id: 'call_a', content: 'a-done' }),
            new HumanMessage('继续'),
        ]
        const { patched, fixed } = repairRuntimeMessages(messages, '中断')
        expect(fixed).toBe(1)
        // 插入位置：lastMatchedIndex=1（call_a 的 ToolMessage 位置），insertAt=2
        expect((patched[2] as ToolMessage).tool_call_id).toBe('call_b')
    })

    it('修复幂等：第二次运行不再新增', () => {
        const messages = [
            new AIMessage({ content: '', tool_calls: [{ id: 'call_once', name: 't', args: {} }] }),
            new HumanMessage('继续'),
        ]
        const first = repairRuntimeMessages(messages, '中断')
        expect(first.fixed).toBe(1)
        const second = repairRuntimeMessages(first.patched, '中断')
        expect(second.fixed).toBe(0)
        expect(second.patched).toHaveLength(3)
    })

    it('空数组返回 fixed=0', () => {
        const { patched, fixed } = repairRuntimeMessages([], '无')
        expect(fixed).toBe(0)
        expect(patched).toEqual([])
    })
})

// ────────────────────────────────────────────────────────────────
// thinking + tool_use 混合 content 场景（@langchain/anthropic 1.x streaming bug）
// 现象：AIMessageChunk 顶层 tool_calls=[] 但 content 数组里有 {type:'tool_use'} 块
// 不修就会让 anthropic 兼容协议报 messages.N: tool_use without tool_result
// ────────────────────────────────────────────────────────────────

function aiMsgWithContentToolUse(
    blocks: Array<{ type: 'thinking', thinking: string } | { type: 'tool_use', id: string, name?: string, input?: unknown }>,
    cls: 'AIMessage' | 'AIMessageChunk' = 'AIMessageChunk',
    extraToolCalls: Array<{ id: string; name?: string }> = [],
): SerializedMessage {
    return {
        lc: 1,
        type: 'constructor',
        id: ['langchain_core', 'messages', cls],
        kwargs: {
            content: blocks,
            tool_calls: extraToolCalls.map(tc => ({ id: tc.id, name: tc.name ?? 'test_tool', args: {}, type: 'tool_call' })),
        },
    }
}

describe('repairSerializedMessages 兼容 content 数组里的 tool_use 块', () => {
    it('AIMessageChunk content 含 tool_use 但 tool_calls=[] 时仍检测为 orphan', () => {
        const messages: SerializedMessage[] = [
            humanMsg('起草起诉状'),
            aiMsgWithContentToolUse(
                [
                    { type: 'thinking', thinking: '思考中...' },
                    { type: 'tool_use', id: 'call_00_chunk', name: 'save_document_draft', input: { templateId: 1 } },
                ],
                'AIMessageChunk',
                [], // 顶层 tool_calls 缺失，模拟 @langchain/anthropic streaming reduce 漏同步
            ),
            humanMsg('卡住了？'),
        ]
        const { patched, count } = repairSerializedMessages(messages, '上一轮工具调用未产生 tool_result')
        expect(count).toBe(1)
        expect(patched).toHaveLength(4)
        expect(patched[2]!.id[2]).toBe('ToolMessage')
        expect(patched[2]!.kwargs.tool_call_id).toBe('call_00_chunk')
        expect(patched[2]!.kwargs.name).toBe('save_document_draft')
        expect(patched[2]!.kwargs.status).toBe('error')
    })

    it('content 同时存在 thinking + tool_use + text 块时仅 tool_use 被认作 orphan', () => {
        const messages: SerializedMessage[] = [
            aiMsgWithContentToolUse(
                [
                    { type: 'thinking', thinking: '...' },
                    { type: 'tool_use', id: 'call_a', name: 'tool_a' },
                ],
                'AIMessageChunk',
            ),
            humanMsg('继续'),
        ]
        const { patched, count } = repairSerializedMessages(messages, '中断')
        expect(count).toBe(1)
        expect(patched[1]!.id[2]).toBe('ToolMessage')
        expect(patched[1]!.kwargs.tool_call_id).toBe('call_a')
    })

    it('top-level tool_calls 与 content tool_use 都存在时按 id 去重不重复补', () => {
        // tool_calls 字段有 call_x，content 数组也有同 id 的 tool_use → 视为同一调用
        const messages: SerializedMessage[] = [
            aiMsgWithContentToolUse(
                [{ type: 'tool_use', id: 'call_x', name: 'tool_x' }],
                'AIMessageChunk',
                [{ id: 'call_x', name: 'tool_x' }],
            ),
            humanMsg('继续'),
        ]
        const { patched, count } = repairSerializedMessages(messages, '中断')
        expect(count).toBe(1) // 仅一条 orphan，不重复
        // 末尾插入位置在 AIMessageChunk(idx=0) 后、HumanMessage(idx=1) 前
        expect(patched[1]!.id[2]).toBe('ToolMessage')
        expect(patched[1]!.kwargs.tool_call_id).toBe('call_x')
    })

    it('content 中多条 tool_use 块全部 orphan 时全部补齐', () => {
        const messages: SerializedMessage[] = [
            aiMsgWithContentToolUse(
                [
                    { type: 'tool_use', id: 'call_p', name: 'tool_p' },
                    { type: 'tool_use', id: 'call_q', name: 'tool_q' },
                ],
                'AIMessageChunk',
            ),
            humanMsg('继续'),
        ]
        const { patched, count } = repairSerializedMessages(messages, '中断')
        expect(count).toBe(2)
        const ids = new Set([patched[1]!.kwargs.tool_call_id, patched[2]!.kwargs.tool_call_id])
        expect(ids).toEqual(new Set(['call_p', 'call_q']))
    })
})

describe('repairRuntimeMessages 兼容 content 数组里的 tool_use 块', () => {
    it('AIMessageChunk content 含 tool_use 但 tool_calls=[] 时仍检测为 orphan', () => {
        const ai = new AIMessageChunk({
            content: [
                { type: 'thinking', thinking: '思考中...' } as any,
                { type: 'tool_use', id: 'call_00_runtime', name: 'save_document_draft', input: { templateId: 1 } } as any,
            ],
            tool_calls: [],
        })
        const messages = [
            new HumanMessage('起草起诉状'),
            ai,
            new HumanMessage('卡住了？'),
        ]
        const { patched, fixed } = repairRuntimeMessages(messages, '上一轮工具调用未产生 tool_result')
        expect(fixed).toBe(1)
        expect(patched).toHaveLength(4)
        const injected = patched[2] as ToolMessage
        expect(injected).toBeInstanceOf(ToolMessage)
        expect(injected.tool_call_id).toBe('call_00_runtime')
        expect(injected.name).toBe('save_document_draft')
        expect(String(injected.content)).toContain('工具执行被中断')
    })

    it('AIMessage 同样支持 content tool_use 块兜底', () => {
        const ai = new AIMessage({
            content: [
                { type: 'tool_use', id: 'call_msg', name: 'foo', input: {} } as any,
            ],
            tool_calls: [],
        })
        const { fixed } = repairRuntimeMessages([ai, new HumanMessage('继续')], '中断')
        expect(fixed).toBe(1)
    })

    it('top-level tool_calls 与 content tool_use 同 id 时去重不重复补', () => {
        const ai = new AIMessageChunk({
            content: [
                { type: 'tool_use', id: 'call_dup', name: 'tool_d', input: {} } as any,
            ],
            tool_calls: [{ id: 'call_dup', name: 'tool_d', args: {} }],
        })
        const { patched, fixed } = repairRuntimeMessages([ai, new HumanMessage('继续')], '中断')
        expect(fixed).toBe(1)
        expect(patched).toHaveLength(3)
        expect((patched[1] as ToolMessage).tool_call_id).toBe('call_dup')
    })
})
