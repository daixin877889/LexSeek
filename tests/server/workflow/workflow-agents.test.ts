/**
 * 工作流 Agents 测试
 *
 * **Feature: workflow-agents-coverage**
 * **Validates: Requirements 12.3, 12.4**
 *
 * 覆盖：
 * - threadState.ts - messageToFlatDict、getThreadValuesService、loadSubAgentThreads
 * - subAgentToolFactory.ts - sanitizeName、createSubAgentTools（已有部分测试，此处补充）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock logger
vi.stubGlobal('logger', {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
})

// Mock checkpointer
vi.mock('~~/server/services/workflow/checkpointer', () => ({
    getCheckpointer: vi.fn(),
    getStore: vi.fn(async () => ({})),
}))

// Mock mapStoredMessageToChatMessage
vi.mock('@langchain/core/messages', () => ({
    mapStoredMessageToChatMessage: vi.fn((msg: any) => {
        // 模拟转换为 BaseMessage 实例
        return {
            _getType: () => msg.type,
            content: msg.data?.content ?? '',
            id: msg.data?.id ?? 'test-id',
            tool_calls: msg.data?.tool_calls,
            tool_call_id: msg.data?.tool_call_id,
            additional_kwargs: msg.data?.additional_kwargs ?? {},
            response_metadata: msg.data?.response_metadata ?? {},
        }
    }),
}))

// Mock subAgentToolFactory（仅 sanitizeName 需要真实导入）
vi.mock('~~/server/services/workflow/agents/subAgentToolFactory', async () => {
    const actual = await vi.importActual('~~/server/services/workflow/agents/subAgentToolFactory')
    return {
        ...actual,
    }
})

import {
    messageToFlatDict,
    getThreadValuesService,
    loadSubAgentThreads,
} from '~~/server/services/workflow/agents/threadState'
import { getCheckpointer } from '~~/server/services/workflow/checkpointer'

describe('工作流 Agents', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // ==================== messageToFlatDict ====================

    describe('messageToFlatDict - 消息转平坦字典', () => {
        it('BaseMessage 实例转为平坦字典', () => {
            const msg = {
                _getType: () => 'human',
                content: '帮我分析案件',
                id: 'msg-001',
                tool_calls: undefined,
                tool_call_id: undefined,
                additional_kwargs: {},
                response_metadata: {},
            }

            const result = messageToFlatDict(msg)

            expect(result.type).toBe('human')
            expect(result.content).toBe('帮我分析案件')
            expect(result.id).toBe('msg-001')
            // 空对象不应出现
            expect(result.additional_kwargs).toBeUndefined()
            expect(result.response_metadata).toBeUndefined()
        })

        it('AI 消息带 tool_calls', () => {
            const msg = {
                _getType: () => 'ai',
                content: '我来调用工具',
                id: 'msg-002',
                tool_calls: [
                    { name: 'search_law', id: 'call-1', args: { query: '合同法' } },
                ],
                tool_call_id: undefined,
                additional_kwargs: {},
                response_metadata: {},
            }

            const result = messageToFlatDict(msg)

            expect(result.type).toBe('ai')
            expect(result.tool_calls).toHaveLength(1)
            expect((result.tool_calls as any)[0].name).toBe('search_law')
        })

        it('Tool 消息带 tool_call_id', () => {
            const msg = {
                _getType: () => 'tool',
                content: '{"result": "找到 5 条法律"}',
                id: 'msg-003',
                tool_calls: undefined,
                tool_call_id: 'call-1',
                additional_kwargs: {},
                response_metadata: {},
            }

            const result = messageToFlatDict(msg)

            expect(result.type).toBe('tool')
            expect(result.tool_call_id).toBe('call-1')
        })

        it('保留 additional_kwargs（非空时）', () => {
            const msg = {
                _getType: () => 'ai',
                content: '回答',
                id: 'msg-004',
                additional_kwargs: { thinking: '深度思考...' },
                response_metadata: {},
            }

            const result = messageToFlatDict(msg)

            expect(result.additional_kwargs).toEqual({ thinking: '深度思考...' })
        })

        it('保留 response_metadata（非空时）', () => {
            const msg = {
                _getType: () => 'human',
                content: '注入内容',
                id: 'msg-005',
                additional_kwargs: {},
                response_metadata: {
                    injectedBy: 'ModuleContextMiddleware:summary',
                    injectedAt: '2026-04-10T00:00:00Z',
                },
            }

            const result = messageToFlatDict(msg)

            expect(result.response_metadata).toBeDefined()
            expect((result.response_metadata as any).injectedBy).toContain('ModuleContext')
        })

        it('stored message 格式（{ type, data }）转换', () => {
            const msg = {
                type: 'human',
                data: {
                    content: '你好',
                    id: 'msg-stored',
                },
            }

            const result = messageToFlatDict(msg)

            expect(result.type).toBe('human')
            expect(result.content).toBe('你好')
        })

        it('stored message 转换失败时返回原始对象', () => {
            // 测试当 stored message 格式但没有有效 data 时的降级行为
            // 传入一个已是平坦字典格式的对象（没有 _getType 方法，没有合法 stored 格式）
            const msg = {
                type: 'unknown',
                content: '未知格式的数据',
                customField: true,
            }

            // 由于没有 _getType 且没有 data 属性，属于"已是平坦字典"分支
            const result = messageToFlatDict(msg)
            expect(result).toBe(msg)
        })

        it('已是平坦字典格式直接返回', () => {
            const msg = {
                type: 'human',
                content: '已经是平坦格式',
                id: 'msg-flat',
            }

            const result = messageToFlatDict(msg)
            expect(result).toBe(msg)
        })
    })

    // ==================== getThreadValuesService ====================

    describe('getThreadValuesService - 获取线程状态', () => {
        it('线程不存在时返回 null', async () => {
            vi.mocked(getCheckpointer).mockResolvedValueOnce({
                getTuple: vi.fn().mockResolvedValueOnce(null),
            } as any)

            const result = await getThreadValuesService('nonexistent-thread')
            expect(result).toBeNull()
        })

        it('返回过滤后的消息列表（排除 system 和注入消息）', async () => {
            const mockMessages = [
                { _getType: () => 'system', content: '系统提示', id: 's1', additional_kwargs: {}, response_metadata: {} },
                {
                    _getType: () => 'human',
                    content: '注入的上下文',
                    id: 'h1',
                    additional_kwargs: {},
                    response_metadata: { injectedBy: 'ModuleContextMiddleware:summary' },
                },
                { _getType: () => 'human', content: '用户问题', id: 'h2', additional_kwargs: {}, response_metadata: {} },
                { _getType: () => 'ai', content: 'AI 回答', id: 'a1', additional_kwargs: {}, response_metadata: {} },
            ]

            vi.mocked(getCheckpointer).mockResolvedValueOnce({
                getTuple: vi.fn().mockResolvedValueOnce({
                    checkpoint: {
                        channel_values: {
                            messages: mockMessages,
                            someOtherState: 'value',
                        },
                    },
                }),
            } as any)

            const result = await getThreadValuesService('thread-001')

            expect(result).not.toBeNull()
            const messages = result!.messages as any[]
            // 应该过滤掉 system 和注入的 human 消息
            expect(messages).toHaveLength(2)
            expect(messages[0].type).toBe('human')
            expect(messages[0].content).toBe('用户问题')
            expect(messages[1].type).toBe('ai')
        })

        it('过滤 CaseMaterial 注入的消息', async () => {
            const mockMessages = [
                {
                    _getType: () => 'human',
                    content: '材料上下文',
                    id: 'h1',
                    additional_kwargs: {},
                    response_metadata: { injectedBy: 'CaseMaterialContextMiddleware' },
                },
                { _getType: () => 'human', content: '真实问题', id: 'h2', additional_kwargs: {}, response_metadata: {} },
            ]

            vi.mocked(getCheckpointer).mockResolvedValueOnce({
                getTuple: vi.fn().mockResolvedValueOnce({
                    checkpoint: {
                        channel_values: { messages: mockMessages },
                    },
                }),
            } as any)

            const result = await getThreadValuesService('thread-002')

            const messages = result!.messages as any[]
            expect(messages).toHaveLength(1)
            expect(messages[0].content).toBe('真实问题')
        })

        it('无消息时返回原始 channelValues', async () => {
            vi.mocked(getCheckpointer).mockResolvedValueOnce({
                getTuple: vi.fn().mockResolvedValueOnce({
                    checkpoint: {
                        channel_values: {
                            messages: [],
                            userId: 1,
                        },
                    },
                }),
            } as any)

            const result = await getThreadValuesService('thread-003')

            expect(result).toEqual({ messages: [], userId: 1 })
        })

        it('保留 channelValues 中其他状态字段', async () => {
            const mockMessages = [
                { _getType: () => 'human', content: '问题', id: 'h1', additional_kwargs: {}, response_metadata: {} },
            ]

            vi.mocked(getCheckpointer).mockResolvedValueOnce({
                getTuple: vi.fn().mockResolvedValueOnce({
                    checkpoint: {
                        channel_values: {
                            messages: mockMessages,
                            userId: 1,
                            caseId: 100,
                            phase: 'analysis',
                        },
                    },
                }),
            } as any)

            const result = await getThreadValuesService('thread-004')

            expect(result!.userId).toBe(1)
            expect(result!.caseId).toBe(100)
            expect(result!.phase).toBe('analysis')
        })
    })

    // ==================== loadSubAgentThreads ====================

    describe('loadSubAgentThreads - 加载子代理线程', () => {
        it('无 AI 消息时返回空数组', async () => {
            vi.mocked(getCheckpointer).mockResolvedValueOnce({
                getTuple: vi.fn(),
            } as any)

            const messages = [
                { type: 'human', content: '用户问题' },
            ]

            const result = await loadSubAgentThreads('session-001', messages)
            expect(result).toEqual([])
        })

        it('AI 消息无 tool_calls 时返回空数组', async () => {
            vi.mocked(getCheckpointer).mockResolvedValueOnce({
                getTuple: vi.fn(),
            } as any)

            const messages = [
                { type: 'ai', content: '直接回答，无工具调用' },
            ]

            const result = await loadSubAgentThreads('session-002', messages)
            expect(result).toEqual([])
        })

        it('非子代理工具调用被忽略', async () => {
            vi.mocked(getCheckpointer).mockResolvedValueOnce({
                getTuple: vi.fn(),
            } as any)

            const messages = [
                {
                    type: 'ai',
                    content: '',
                    tool_calls: [
                        { name: 'search_law', id: 'call-1', args: {} },
                    ],
                },
            ]

            const result = await loadSubAgentThreads('session-003', messages)
            expect(result).toEqual([])
        })

        it('加载子代理线程消息', async () => {
            const subMessages = [
                { _getType: () => 'human', content: '子代理问题', id: 's-h1', additional_kwargs: {}, response_metadata: {} },
                { _getType: () => 'ai', content: '子代理回答', id: 's-a1', additional_kwargs: {}, response_metadata: {} },
            ]

            const mockGetTuple = vi.fn().mockResolvedValueOnce({
                checkpoint: {
                    channel_values: { messages: subMessages },
                },
            })

            vi.mocked(getCheckpointer).mockResolvedValueOnce({
                getTuple: mockGetTuple,
            } as any)

            const messages = [
                {
                    type: 'ai',
                    content: '',
                    tool_calls: [
                        { name: 'ask_legal_analysis_expert', id: 'call-sub-1', args: {} },
                    ],
                },
            ]

            const result = await loadSubAgentThreads('session-004', messages)

            expect(result).toHaveLength(1)
            expect(result[0].toolCallId).toBe('call-sub-1')
            expect(result[0].agentName).toBe('legal_analysis')
            // threadId 后缀加 toolCallId，避免同 expert 多次调用复用 checkpoint（详见 threadState.ts:248-254 注释）
            expect(result[0].threadId).toBe('session-004_sub_legal_analysis_call-sub-1')
            expect(result[0].messages).toHaveLength(2)
        })

        it('子代理线程不存在时跳过', async () => {
            const mockGetTuple = vi.fn().mockResolvedValueOnce(null)

            vi.mocked(getCheckpointer).mockResolvedValueOnce({
                getTuple: mockGetTuple,
            } as any)

            const messages = [
                {
                    type: 'ai',
                    content: '',
                    tool_calls: [
                        { name: 'ask_defense_expert', id: 'call-sub-2', args: {} },
                    ],
                },
            ]

            const result = await loadSubAgentThreads('session-005', messages)
            expect(result).toEqual([])
        })

        it('子代理线程加载失败时跳过', async () => {
            const mockGetTuple = vi.fn().mockRejectedValueOnce(new Error('数据库错误'))

            vi.mocked(getCheckpointer).mockResolvedValueOnce({
                getTuple: mockGetTuple,
            } as any)

            const messages = [
                {
                    type: 'ai',
                    content: '',
                    tool_calls: [
                        { name: 'ask_summary_expert', id: 'call-sub-3', args: {} },
                    ],
                },
            ]

            const result = await loadSubAgentThreads('session-006', messages)
            expect(result).toEqual([])
        })

        it('多个子代理工具调用', async () => {
            const subMessages1 = [
                { _getType: () => 'ai', content: '分析1', id: 's1', additional_kwargs: {}, response_metadata: {} },
            ]
            const subMessages2 = [
                { _getType: () => 'ai', content: '分析2', id: 's2', additional_kwargs: {}, response_metadata: {} },
            ]

            const mockGetTuple = vi.fn()
                .mockResolvedValueOnce({
                    checkpoint: { channel_values: { messages: subMessages1 } },
                })
                .mockResolvedValueOnce({
                    checkpoint: { channel_values: { messages: subMessages2 } },
                })

            vi.mocked(getCheckpointer).mockResolvedValueOnce({
                getTuple: mockGetTuple,
            } as any)

            const messages = [
                {
                    type: 'ai',
                    content: '',
                    tool_calls: [
                        { name: 'ask_summary_expert', id: 'call-1', args: {} },
                        { name: 'ask_defense_expert', id: 'call-2', args: {} },
                    ],
                },
            ]

            const result = await loadSubAgentThreads('session-007', messages)

            expect(result).toHaveLength(2)
            expect(result[0].agentName).toBe('summary')
            expect(result[1].agentName).toBe('defense')
        })
    })
})
