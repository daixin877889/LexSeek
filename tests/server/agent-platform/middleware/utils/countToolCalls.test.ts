/**
 * countToolCalls 测试
 *
 * **Feature: case-memory-extension**
 * **Validates: spec §3.1 跳过阈值判断**
 */
import { describe, it, expect } from 'vitest'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { countToolCalls } from '~~/server/services/agent-platform/middleware/utils/countToolCalls'

describe('countToolCalls', () => {
    it('对 AIMessage.tool_calls 中的指定工具计数', () => {
        const messages = [
            new HumanMessage('hi'),
            new AIMessage({ content: '', tool_calls: [
                { id: '1', name: 'write_case_memory', args: {} },
                { id: '2', name: 'search_law', args: {} },
            ] }),
            new AIMessage({ content: '', tool_calls: [
                { id: '3', name: 'update_case_memory', args: {} },
                { id: '4', name: 'write_case_memory', args: {} },
            ] }),
        ]
        const count = countToolCalls(messages, ['write_case_memory', 'update_case_memory'])
        expect(count).toBe(3)
    })

    it('messages 为空返回 0', () => {
        expect(countToolCalls([], ['write_case_memory'])).toBe(0)
    })

    it('无匹配工具返回 0', () => {
        const messages = [new AIMessage({ content: '', tool_calls: [{ id: '1', name: 'search_law', args: {} }] })]
        expect(countToolCalls(messages, ['write_case_memory'])).toBe(0)
    })

    it('plain object 形式的 messages 也支持', () => {
        const messages = [
            { tool_calls: [{ name: 'write_case_memory' }] },
        ] as any
        expect(countToolCalls(messages, ['write_case_memory'])).toBe(1)
    })

    // @langchain/anthropic 1.x streaming + thinking 模式下 AIMessageChunk reduce
    // 把 tool_use 块只塞进 content 数组,顶层 tool_calls 字段为空——必须从 content
    // 数组里也读取 tool_use 块,否则会少计数 → afterAgentMemory 误判低于阈值多跑一次提取
    it('content 数组含 tool_use 块但顶层 tool_calls=[] 时仍能计数', () => {
        const messages = [
            new AIMessage({
                content: [
                    { type: 'thinking', thinking: '...' } as any,
                    { type: 'tool_use', id: 'call_w1', name: 'write_case_memory', input: {} } as any,
                ],
                tool_calls: [],
            }),
        ]
        expect(countToolCalls(messages, ['write_case_memory'])).toBe(1)
    })

    it('plain object content 数组兜底同样支持', () => {
        const messages = [
            {
                content: [
                    { type: 'tool_use', id: 'call_p1', name: 'update_case_memory' },
                ],
                tool_calls: [],
            },
        ] as any
        expect(countToolCalls(messages, ['update_case_memory'])).toBe(1)
    })

    it('顶层 tool_calls 与 content tool_use 同 id 时按 id 去重不重复计数', () => {
        const messages = [
            new AIMessage({
                content: [
                    { type: 'tool_use', id: 'call_dup', name: 'write_case_memory', input: {} } as any,
                ],
                tool_calls: [{ id: 'call_dup', name: 'write_case_memory', args: {} }],
            }),
        ]
        expect(countToolCalls(messages, ['write_case_memory'])).toBe(1)
    })
})
