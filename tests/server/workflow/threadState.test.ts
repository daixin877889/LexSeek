/**
 * 线程状态工具函数测试
 *
 * 测试 messageToFlatDict 纯函数和 getThreadValuesService/loadSubAgentThreads
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock checkpointer
vi.mock('~~/server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn(),
}))

// Mock langchain
vi.mock('@langchain/core/messages', () => ({
    mapStoredMessageToChatMessage: vi.fn(),
}))

// Mock subAgentToolFactory
vi.mock('~~/server/services/workflow/agents/subAgentToolFactory', () => ({
    sanitizeName: (name: string) => name.replace(/[^a-zA-Z0-9_]/g, '_'),
}))

vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })

import { messageToFlatDict, getThreadValuesService, loadSubAgentThreads } from '~~/server/services/workflow/agents/threadState'
import { getCheckpointer } from '~~/server/services/workflow/checkpointer'
import { mapStoredMessageToChatMessage } from '@langchain/core/messages'

describe('messageToFlatDict', () => {
    it('BaseMessage 实例转为平坦字典', () => {
        const msg = {
            _getType: () => 'human',
            content: '你好',
            id: 'msg-1',
            tool_calls: [],
            additional_kwargs: {},
            response_metadata: {},
        }
        const result = messageToFlatDict(msg)
        expect(result.type).toBe('human')
        expect(result.content).toBe('你好')
        expect(result.id).toBe('msg-1')
    })

    it('AI 消息保留 tool_calls', () => {
        const msg = {
            _getType: () => 'ai',
            content: '调用工具',
            id: 'msg-2',
            tool_calls: [{ id: 'tc-1', name: 'search', args: {} }],
            additional_kwargs: {},
            response_metadata: {},
        }
        const result = messageToFlatDict(msg)
        expect(result.tool_calls).toEqual([{ id: 'tc-1', name: 'search', args: {} }])
    })

    it('Tool 消息保留 tool_call_id', () => {
        const msg = {
            _getType: () => 'tool',
            content: '结果',
            id: 'msg-3',
            tool_call_id: 'tc-1',
            tool_calls: [],
            additional_kwargs: {},
            response_metadata: {},
        }
        const result = messageToFlatDict(msg)
        expect(result.tool_call_id).toBe('tc-1')
    })

    it('保留 additional_kwargs（非空时）', () => {
        const msg = {
            _getType: () => 'ai',
            content: '回复',
            id: 'msg-4',
            tool_calls: [],
            additional_kwargs: { key: 'value' },
            response_metadata: {},
        }
        const result = messageToFlatDict(msg)
        expect(result.additional_kwargs).toEqual({ key: 'value' })
    })

    it('空 additional_kwargs 不包含在结果中', () => {
        const msg = {
            _getType: () => 'ai',
            content: '回复',
            id: 'msg-5',
            tool_calls: [],
            additional_kwargs: {},
            response_metadata: {},
        }
        const result = messageToFlatDict(msg)
        expect(result).not.toHaveProperty('additional_kwargs')
    })

    it('保留 response_metadata（非空时）', () => {
        const msg = {
            _getType: () => 'human',
            content: '消息',
            id: 'msg-6',
            tool_calls: [],
            additional_kwargs: {},
            response_metadata: { injectedBy: 'ModuleContext' },
        }
        const result = messageToFlatDict(msg)
        expect(result.response_metadata).toEqual({ injectedBy: 'ModuleContext' })
    })

    it('stored message 格式转换', () => {
        const storedMsg = { type: 'human', data: { content: '存储消息' } }
        const mockInstance = {
            _getType: () => 'human',
            content: '存储消息',
            id: 'stored-1',
            tool_calls: [],
            additional_kwargs: {},
            response_metadata: {},
        }
        vi.mocked(mapStoredMessageToChatMessage).mockReturnValue(mockInstance as any)

        const result = messageToFlatDict(storedMsg)
        expect(result.type).toBe('human')
        expect(result.content).toBe('存储消息')
    })

    it('stored message 转换失败时返回原始对象', () => {
        const storedMsg = { type: 'unknown', data: { content: '错误' } }
        vi.mocked(mapStoredMessageToChatMessage).mockImplementation(() => {
            throw new Error('unsupported')
        })

        const result = messageToFlatDict(storedMsg)
        expect(result).toBe(storedMsg)
    })

    it('已是平坦字典格式直接返回', () => {
        const flatDict = { type: 'human', content: '已格式化', id: 'flat-1' }
        const result = messageToFlatDict(flatDict)
        expect(result).toBe(flatDict)
    })
})

describe('getThreadValuesService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('线程不存在时返回 null', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue(null),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getThreadValuesService('non-existent-thread')
        expect(result).toBeNull()
    })

    it('有消息时过滤 system 消息', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: {
                    channel_values: {
                        messages: [
                            { type: 'system', content: '系统提示' },
                            { type: 'human', content: '用户消息', id: '1' },
                        ],
                    },
                },
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getThreadValuesService('test-thread')
        expect(result).not.toBeNull()
        const messages = result!.messages as any[]
        expect(messages.every((m: any) => m.type !== 'system')).toBe(true)
    })

    it('过滤注入的上下文消息', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: {
                    channel_values: {
                        messages: [
                            { type: 'human', content: '注入消息', id: '1', response_metadata: { injectedBy: 'ModuleContext:test' } },
                            { type: 'human', content: '真实消息', id: '2' },
                        ],
                    },
                },
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getThreadValuesService('test-thread')
        const messages = result!.messages as any[]
        expect(messages).toHaveLength(1)
        expect(messages[0].content).toBe('真实消息')
    })

    it('无消息时返回 channelValues', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: {
                    channel_values: {
                        messages: [],
                        otherField: 'value',
                    },
                },
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getThreadValuesService('test-thread')
        expect(result).toHaveProperty('otherField', 'value')
    })
})

describe('loadSubAgentThreads', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('无子代理调用时返回空数组', async () => {
        const mockCheckpointer = { getTuple: vi.fn() }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const messages = [
            { type: 'human', content: '问题' },
            { type: 'ai', content: '回答' },
        ]
        const result = await loadSubAgentThreads('session-1', messages)
        expect(result).toEqual([])
    })

    it('识别子代理工具调用并加载消息', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: {
                    channel_values: {
                        messages: [
                            { type: 'ai', content: '子代理回答', id: 'sub-msg-1' },
                        ],
                    },
                },
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const messages = [
            {
                type: 'ai',
                content: '',
                tool_calls: [{ id: 'tc-1', name: 'ask_legal_analyzer_expert', args: {} }],
            },
        ]
        const result = await loadSubAgentThreads('session-1', messages)
        expect(result).toHaveLength(1)
        expect(result[0]!.agentName).toBe('legal_analyzer')
        expect(result[0]!.toolCallId).toBe('tc-1')
    })

    it('子代理 thread 不存在时跳过', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue(null),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const messages = [
            {
                type: 'ai',
                tool_calls: [{ id: 'tc-1', name: 'ask_test_expert', args: {} }],
            },
        ]
        const result = await loadSubAgentThreads('session-1', messages)
        expect(result).toEqual([])
    })

    it('加载子代理失败时记录警告并继续', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockRejectedValue(new Error('连接失败')),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const messages = [
            {
                type: 'ai',
                tool_calls: [{ id: 'tc-1', name: 'ask_test_expert', args: {} }],
            },
        ]
        const result = await loadSubAgentThreads('session-1', messages)
        expect(result).toEqual([])
    })

    it('非子代理工具调用被忽略', async () => {
        const mockCheckpointer = { getTuple: vi.fn() }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const messages = [
            {
                type: 'ai',
                tool_calls: [{ id: 'tc-1', name: 'search_law', args: {} }],
            },
        ]
        const result = await loadSubAgentThreads('session-1', messages)
        expect(result).toEqual([])
        expect(mockCheckpointer.getTuple).not.toHaveBeenCalled()
    })
})
