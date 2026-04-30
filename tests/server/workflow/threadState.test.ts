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

    // 真实 bug 修复：用户在 template_select interrupt 卡片暂停时刷新页面，
    // 卡片消失。前端 useStreamChat.interruptData 从 initialValues.__interrupt__
    // 读取——后端必须在恢复 thread 时附带 pending interrupts。
    // 直接从 PostgresSaver.getTuple().pendingWrites 抽 __interrupt__ channel，
    // 不依赖 dummy graph 的 getState().tasks（那条路径 schema 不一致拿不到数据）。
    it('pendingWrites 含 __interrupt__ channel → 附加到返回值', async () => {
        const interruptValue = {
            id: 'f4e2538d',
            value: {
                type: 'template_select',
                toolCallId: 'call_x',
                recommendations: [{ id: 1, name: '民事起诉状' }],
            },
        }
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: {
                    channel_values: {
                        messages: [
                            { type: 'human', content: '起草起诉状', id: 'h1' },
                            { type: 'ai', content: '调用工具', id: 'a1' },
                        ],
                    },
                },
                // pendingWrites: Array<[task_id, channel, value]>
                pendingWrites: [
                    ['task-1', '__interrupt__', interruptValue],
                    ['task-2', 'messages', { type: 'ai', content: 'something else' }],
                ],
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getThreadValuesService('test-thread')

        expect(result).not.toBeNull()
        expect(result).toHaveProperty('__interrupt__')
        expect((result as any).__interrupt__).toHaveLength(1)
        expect((result as any).__interrupt__[0]).toEqual(interruptValue)
    })

    it('pendingWrites 无 __interrupt__ channel → 不附加 __interrupt__ 字段', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: {
                    channel_values: {
                        messages: [{ type: 'human', content: 'hi', id: '1' }],
                    },
                },
                pendingWrites: [
                    ['task-1', '__resume__', { value: 'resumed' }],
                ],
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getThreadValuesService('test-thread')
        expect(result).not.toHaveProperty('__interrupt__')
    })

    it('多个 task 含 __interrupt__ 时合并到 __interrupt__ 数组', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: {
                    channel_values: {
                        messages: [{ type: 'human', content: 'q', id: '1' }],
                    },
                },
                pendingWrites: [
                    ['task-a', '__interrupt__', { value: { type: 'a' } }],
                    ['task-b', '__interrupt__', { value: { type: 'b' } }],
                ],
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getThreadValuesService('test-thread')
        expect((result as any).__interrupt__).toHaveLength(2)
    })

    // Bug 修复：用户点"使用此模板"resume 后 graph 在跑下一步时刷新，head
    // checkpoint pendingWrites 同时含 __interrupt__ 和 __resume__（同 task_id），
    // 旧逻辑把已 resume 的 interrupt 误认 active 重渲卡片
    it('同 task_id 同时有 __interrupt__ 和 __resume__ → 视为已 resolved 不返回', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: {
                    channel_values: {
                        messages: [{ type: 'human', content: 'q', id: '1' }],
                    },
                },
                pendingWrites: [
                    ['task-x', '__interrupt__', { value: { type: 'template_select' } }],
                    ['task-x', '__resume__', { templateId: 1 }],  // 已 resume 同一个 task
                ],
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getThreadValuesService('test-thread')
        expect(result).not.toHaveProperty('__interrupt__')
    })

    it('多 task：只过滤掉已 resume 的，未 resume 的仍返回', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: {
                    channel_values: {
                        messages: [{ type: 'human', content: 'q', id: '1' }],
                    },
                },
                pendingWrites: [
                    ['task-old', '__interrupt__', { value: { type: 'old', resolved: true } }],
                    ['task-old', '__resume__', { ok: true }],
                    ['task-new', '__interrupt__', { value: { type: 'new', active: true } }],  // 未 resume
                ],
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getThreadValuesService('test-thread')
        expect((result as any).__interrupt__).toHaveLength(1)
        expect((result as any).__interrupt__[0]).toEqual({ value: { type: 'new', active: true } })
    })

    it('pendingWrites 是空数组或非数组时不附加 __interrupt__（不影响 messages 返回）', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: {
                    channel_values: {
                        messages: [{ type: 'human', content: 'q', id: '1' }],
                    },
                },
                pendingWrites: [],  // 没有 pending writes
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getThreadValuesService('test-thread')
        expect(result).not.toBeNull()
        expect(result).not.toHaveProperty('__interrupt__')
        expect((result as any).messages).toHaveLength(1)
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
