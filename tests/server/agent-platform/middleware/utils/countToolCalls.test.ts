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
})
