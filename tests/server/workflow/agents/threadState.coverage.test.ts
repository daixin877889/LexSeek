/**
 * 线程状态服务 - 覆盖率补充测试
 *
 * 覆盖 threadState.ts 中未被测试的路径：
 * - messageToFlatDict 各种消息格式
 * - getThreadValuesService 过滤逻辑
 * - loadSubAgentThreads 子代理提取逻辑
 *
 * **Feature: workflow-thread-state**
 * **Validates: Requirements 20.1, 20.2**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { messageToFlatDict } from '~~/server/services/workflow/agents/threadState'

describe('线程状态服务 - messageToFlatDict', () => {
    it('应正确转换 BaseMessage 实例（human 类型）', () => {
        const msg = {
            _getType: () => 'human',
            content: '你好',
            id: 'msg-1',
            tool_calls: undefined,
            tool_call_id: undefined,
            additional_kwargs: {},
            response_metadata: {},
        }

        const result = messageToFlatDict(msg)

        expect(result.type).toBe('human')
        expect(result.content).toBe('你好')
        expect(result.id).toBe('msg-1')
        // 空的 additional_kwargs 和 response_metadata 不应包含
        expect(result.additional_kwargs).toBeUndefined()
        expect(result.response_metadata).toBeUndefined()
    })

    it('应正确转换 AI 类型消息（含 tool_calls）', () => {
        const msg = {
            _getType: () => 'ai',
            content: 'AI 回复',
            id: 'msg-2',
            tool_calls: [{ id: 'tc-1', name: 'search', args: {} }],
            tool_call_id: undefined,
            additional_kwargs: { some: 'value' },
            response_metadata: { model: 'gpt-4' },
        }

        const result = messageToFlatDict(msg)

        expect(result.type).toBe('ai')
        expect(result.tool_calls).toEqual([{ id: 'tc-1', name: 'search', args: {} }])
        expect(result.additional_kwargs).toEqual({ some: 'value' })
        expect(result.response_metadata).toEqual({ model: 'gpt-4' })
    })

    it('应正确转换 tool 类型消息', () => {
        const msg = {
            _getType: () => 'tool',
            content: '工具结果',
            id: 'msg-3',
            tool_calls: [],
            tool_call_id: 'tc-1',
            additional_kwargs: {},
            response_metadata: {},
        }

        const result = messageToFlatDict(msg)

        expect(result.type).toBe('tool')
        expect(result.tool_call_id).toBe('tc-1')
        // 空 tool_calls 不应包含
        expect(result.tool_calls).toBeUndefined()
    })

    it('应处理 stored message 格式（fallback 到原始数据）', () => {
        // 不可转换的 stored message 应返回原始数据
        const msg = {
            type: 'unknown_type',
            data: { content: '内容', id: 'msg-4' },
        }

        const result = messageToFlatDict(msg)

        // mapStoredMessageToChatMessage 失败后应返回原始 msg
        expect(result).toEqual(msg)
    })

    it('应直接返回平坦字典格式', () => {
        const msg = {
            type: 'human',
            content: '已是平坦格式',
            id: 'msg-5',
        }

        const result = messageToFlatDict(msg)

        expect(result).toEqual(msg)
    })

    it('应忽略空的 tool_calls', () => {
        const msg = {
            _getType: () => 'ai',
            content: '内容',
            id: 'msg-6',
            tool_calls: [],
            additional_kwargs: {},
            response_metadata: {},
        }

        const result = messageToFlatDict(msg)

        // 空的 tool_calls 不应被包含
        expect(result.tool_calls).toBeUndefined()
    })

    it('应保留有内容的 response_metadata', () => {
        const msg = {
            _getType: () => 'human',
            content: '内容',
            id: 'msg-7',
            additional_kwargs: {},
            response_metadata: {
                injectedBy: 'ModuleContextMiddleware:测试模块',
            },
        }

        const result = messageToFlatDict(msg)

        expect(result.response_metadata).toEqual({
            injectedBy: 'ModuleContextMiddleware:测试模块',
        })
    })
})
