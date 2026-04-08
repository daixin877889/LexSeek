/**
 * Agent ThreadState 服务测试
 *
 * 测试 messageToFlatDict 将 LangChain checkpointer 消息转换为前端 useStream 期望的平坦字典格式
 *
 * **Feature: agent-thread-state**
 * **Validates: threadState.ts 核心函数**
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @langchain/core/messages（避免导入 LangChain 模块的复杂性）
vi.mock('@langchain/core/messages', () => ({
    mapStoredMessageToChatMessage: vi.fn(),
}))

// 顶层设置 logger mock（server/services/workflow/checkpointer 依赖 logger）
vi.stubGlobal('logger', {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
})

import { messageToFlatDict } from '../../../server/services/workflow/agents/threadState'
import { mapStoredMessageToChatMessage } from '@langchain/core/messages'

const mockedMapStoredMessage = mapStoredMessageToChatMessage as ReturnType<typeof vi.fn>

beforeEach(() => {
    vi.clearAllMocks()
})

describe('messageToFlatDict - BaseMessage 实例路径', () => {
    it('应正确转换 human 消息', () => {
        const humanMsg = {
            _getType: () => 'human',
            content: '请分析这个案件',
            id: 'msg-001',
        }

        const result = messageToFlatDict(humanMsg)

        expect(result).toEqual({
            type: 'human',
            content: '请分析这个案件',
            id: 'msg-001',
        })
    })

    it('应正确转换 ai 消息', () => {
        const aiMsg = {
            _getType: () => 'ai',
            content: '好的，我来帮你分析',
            id: 'msg-002',
        }

        const result = messageToFlatDict(aiMsg)

        expect(result).toEqual({
            type: 'ai',
            content: '好的，我来帮你分析',
            id: 'msg-002',
        })
    })

    it('应正确转换带 tool_calls 的 ai 消息', () => {
        const aiMsgWithTools = {
            _getType: () => 'ai',
            content: '我将查询相关法律条文',
            id: 'msg-003',
            tool_calls: [
                {
                    name: 'legalSearch',
                    args: { query: '劳动合同法第三十七条' },
                },
            ],
        }

        const result = messageToFlatDict(aiMsgWithTools)

        expect(result).toEqual({
            type: 'ai',
            content: '我将查询相关法律条文',
            id: 'msg-003',
            tool_calls: aiMsgWithTools.tool_calls,
        })
    })

    it('应正确转换带 tool_call_id 的 tool 消息', () => {
        const toolMsg = {
            _getType: () => 'tool',
            content: '{"law": "劳动合同法", "article": 37}',
            id: 'msg-004',
            tool_call_id: 'call-abc-123',
        }

        const result = messageToFlatDict(toolMsg)

        expect(result).toEqual({
            type: 'tool',
            content: '{"law": "劳动合同法", "article": 37}',
            id: 'msg-004',
            tool_call_id: 'call-abc-123',
        })
    })

    it('应正确转换带 additional_kwargs 的消息', () => {
        const aiMsgWithKwargs = {
            _getType: () => 'ai',
            content: '根据相关法律规定',
            id: 'msg-005',
            additional_kwargs: {
                author: 'system',
                version: '2.0',
            },
        }

        const result = messageToFlatDict(aiMsgWithKwargs)

        expect(result).toEqual({
            type: 'ai',
            content: '根据相关法律规定',
            id: 'msg-005',
            additional_kwargs: { author: 'system', version: '2.0' },
        })
    })

    it('不应包含空 additional_kwargs', () => {
        const aiMsg = {
            _getType: () => 'ai',
            content: '测试内容',
            id: 'msg-006',
            additional_kwargs: {},
        }

        const result = messageToFlatDict(aiMsg)

        expect(result).not.toHaveProperty('additional_kwargs')
    })

    it('不应包含空 tool_calls 数组', () => {
        const aiMsg = {
            _getType: () => 'ai',
            content: '测试内容',
            id: 'msg-007',
            tool_calls: [],
        }

        const result = messageToFlatDict(aiMsg)

        expect(result).not.toHaveProperty('tool_calls')
    })

    it('应正确组合 tool_calls 和 additional_kwargs', () => {
        const aiMsg = {
            _getType: () => 'ai',
            content: '查询结果',
            id: 'msg-008',
            tool_calls: [{ name: 'search', args: {} }],
            additional_kwargs: { source: 'legal_db' },
        }

        const result = messageToFlatDict(aiMsg)

        expect(result).toEqual({
            type: 'ai',
            content: '查询结果',
            id: 'msg-008',
            tool_calls: [{ name: 'search', args: {} }],
            additional_kwargs: { source: 'legal_db' },
        })
    })
})

describe('messageToFlatDict - stored message 格式路径', () => {
    it('应将 stored message 格式转换为 BaseMessage 后提取字段', () => {
        // stored message 格式：{ type, data: { type, content, ... } }
        const storedMsg = {
            type: 'human',
            data: {
                type: 'human',
                content: '请帮我分析案件',
                id: 'stored-msg-001',
            },
        }

        // 模拟 mapStoredMessageToChatMessage 返回 BaseMessage 实例
        const mockBaseMessage = {
            _getType: () => 'human',
            content: '请帮我分析案件',
            id: 'stored-msg-001',
        }
        mockedMapStoredMessage.mockReturnValue(mockBaseMessage)

        const result = messageToFlatDict(storedMsg)

        expect(mockedMapStoredMessage).toHaveBeenCalledWith(storedMsg)
        expect(result).toEqual({
            type: 'human',
            content: '请帮我分析案件',
            id: 'stored-msg-001',
        })
    })

    it('stored message 转换失败时应返回原始消息', () => {
        const storedMsg = {
            type: 'unknown',
            data: {
                type: 'unknown',
                content: 'some content',
            },
        }

        mockedMapStoredMessage.mockImplementation(() => {
            throw new Error('Unknown message type')
        })

        const result = messageToFlatDict(storedMsg)

        expect(result).toBe(storedMsg)
    })

    it('应支持 stored message 格式中的 tool 消息', () => {
        const storedToolMsg = {
            type: 'tool',
            data: {
                type: 'tool',
                content: '{"result": "查询成功"}',
                id: 'stored-tool-001',
                tool_call_id: 'call-xyz-789',
            },
        }

        const mockBaseMessage = {
            _getType: () => 'tool',
            content: '{"result": "查询成功"}',
            id: 'stored-tool-001',
            tool_call_id: 'call-xyz-789',
        }
        mockedMapStoredMessage.mockReturnValue(mockBaseMessage)

        const result = messageToFlatDict(storedToolMsg)

        expect(result).toEqual({
            type: 'tool',
            content: '{"result": "查询成功"}',
            id: 'stored-tool-001',
            tool_call_id: 'call-xyz-789',
        })
    })
})

describe('messageToFlatDict - 已是字典格式路径', () => {
    it('应直接返回已是平坦字典格式的消息', () => {
        const flatMsg = {
            type: 'ai',
            content: '已是字典格式',
            id: 'flat-001',
            custom_field: '自定义字段',
        }

        const result = messageToFlatDict(flatMsg)

        expect(result).toBe(flatMsg)
        expect(result).toEqual({
            type: 'ai',
            content: '已是字典格式',
            id: 'flat-001',
            custom_field: '自定义字段',
        })
    })

    it('应直接返回无 _getType 的普通对象', () => {
        const plainObj = {
            role: 'assistant',
            text: '普通对象消息',
        }

        const result = messageToFlatDict(plainObj)

        expect(result).toBe(plainObj)
    })
})

describe('messageToFlatDict - 边界情况', () => {
    it('应处理 content 为空字符串的情况', () => {
        const msg = {
            _getType: () => 'ai',
            content: '',
            id: 'empty-content-001',
        }

        const result = messageToFlatDict(msg)

        expect(result).toEqual({
            type: 'ai',
            content: '',
            id: 'empty-content-001',
        })
    })

    it('应处理 id 为 undefined 的情况', () => {
        const msg = {
            _getType: () => 'human',
            content: '无 id 消息',
        }

        const result = messageToFlatDict(msg)

        expect(result).toEqual({
            type: 'human',
            content: '无 id 消息',
            id: undefined,
        })
    })

    it('应处理 content 为多行字符串的情况', () => {
        const msg = {
            _getType: () => 'ai',
            content: '第一行\n第二行\n第三行',
            id: 'multiline-001',
        }

        const result = messageToFlatDict(msg)

        expect(result).toEqual({
            type: 'ai',
            content: '第一行\n第二行\n第三行',
            id: 'multiline-001',
        })
    })

    it('应处理 content 为复杂对象的情况', () => {
        const complexContent = [
            { text: '条款一' },
            { text: '条款二' },
        ]
        const msg = {
            _getType: () => 'ai',
            content: complexContent,
            id: 'complex-content-001',
        }

        const result = messageToFlatDict(msg)

        expect(result.content).toEqual(complexContent)
    })

    it('应处理 additional_kwargs 只有单个有效键的情况', () => {
        const msg = {
            _getType: () => 'ai',
            content: '测试',
            id: 'single-kwargs-001',
            additional_kwargs: { only_one: 'value' },
        }

        const result = messageToFlatDict(msg)

        expect(result).toEqual({
            type: 'ai',
            content: '测试',
            id: 'single-kwargs-001',
            additional_kwargs: { only_one: 'value' },
        })
    })

    it('应处理 tool_calls 有多个元素的情况', () => {
        const msg = {
            _getType: () => 'ai',
            content: '调用多个工具',
            id: 'multi-tool-001',
            tool_calls: [
                { name: 'toolA', args: { a: 1 } },
                { name: 'toolB', args: { b: 2 } },
            ],
        }

        const result = messageToFlatDict(msg)

        expect(result).toEqual({
            type: 'ai',
            content: '调用多个工具',
            id: 'multi-tool-001',
            tool_calls: [
                { name: 'toolA', args: { a: 1 } },
                { name: 'toolB', args: { b: 2 } },
            ],
        })
    })

    it('stored message 中 data 为空时应走字典路径', () => {
        // msg.data 存在但 msg.type 不存在 → 走字典路径
        const msg = {
            data: { content: 'some content' },
        }

        const result = messageToFlatDict(msg)

        // 既没有 _getType 也没有 type 字段，走字典路径
        expect(result).toBe(msg)
    })

    it('msg.type 存在但 msg.data 不存在时应走字典路径', () => {
        const msg = {
            type: 'human',
            content: '有 type 无 data',
        }

        const result = messageToFlatDict(msg)

        expect(result).toBe(msg)
    })
})
