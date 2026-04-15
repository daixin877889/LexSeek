/**
 * orphan tool_use 修复的纯函数单元测试
 *
 * **Feature: agent-error-recovery**
 * **Validates: repairSerializedMessages 检测并修复 LangGraph checkpoint 中
 * 工具节点中断留下的 orphan AIMessage(tool_use)**
 */
import { describe, it, expect } from 'vitest'
import type { SerializedMessage } from '../../../server/services/workflow/repairOrphanToolUse'
import { repairSerializedMessages } from '../../../server/services/workflow/repairOrphanToolUse'

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
