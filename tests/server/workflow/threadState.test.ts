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

// Task 12: mock prisma（DB-first fallback 用 contractReviews.findFirst）
vi.mock('~~/server/utils/db', () => ({
    prisma: {
        contractReviews: {
            findFirst: vi.fn(),
        },
    },
}))

import { messageToFlatDict, getThreadValuesService, getPendingInterruptsService, loadSubAgentThreads } from '~~/server/services/workflow/agents/threadState'
import { getCheckpointer } from '~~/server/services/workflow/checkpointer'
import { mapStoredMessageToChatMessage } from '@langchain/core/messages'
import { prisma } from '~~/server/utils/db'

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

describe('getPendingInterruptsService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    // 真实 bug 修复（继承自 commit 17510fe0 同款根因）：
    // agentWorker 用 dummy createAgent + getState() 检测 interrupt 时,
    // caseMain 等真实 agent 拓扑跟 dummy 不一致 → tasks.interrupts 永远空 →
    // run 错标 COMPLETED → 刷新页面后 SSE 把 pendingWrites 中残留的 __interrupt__
    // 当 stale 剥掉 → 模板卡片永久 loading。
    // 本服务直接读 PostgresSaver pendingWrites,与 graph schema 解耦。
    it('线程不存在时返回空数组', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue(null),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getPendingInterruptsService('non-existent-thread')
        expect(result).toEqual([])
    })

    it('pendingWrites 含 __interrupt__ → 返回 Interrupt 对象数组', async () => {
        const interruptValue = {
            id: 'i-1',
            value: { type: 'template_select', toolCallId: 'tc-1' },
        }
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: { channel_values: { messages: [] } },
                pendingWrites: [
                    ['task-1', '__interrupt__', interruptValue],
                ],
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getPendingInterruptsService('test-thread')
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual(interruptValue)
    })

    it('pendingWrites 无 __interrupt__ → 返回空数组', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: { channel_values: { messages: [] } },
                pendingWrites: [
                    ['task-1', '__resume__', { ok: true }],
                    ['task-2', 'messages', { type: 'ai', content: 'x' }],
                ],
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getPendingInterruptsService('test-thread')
        expect(result).toEqual([])
    })

    // 与 getThreadValuesService 保持同口径：同一 task 已被 __resume__ 抵消的
    // interrupt 不能再返回（用户已点完模板,graph 跑下一步时刷新的过渡态）
    it('同 task __interrupt__ 已被 __resume__ 抵消 → 不返回', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: { channel_values: { messages: [] } },
                pendingWrites: [
                    ['task-resolved', '__interrupt__', { id: 'i-x', value: { type: 'template_select' } }],
                    ['task-resolved', '__resume__', { templateId: 1 }],
                ],
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getPendingInterruptsService('test-thread')
        expect(result).toEqual([])
    })

    it('pendingWrites 为空数组时返回空数组', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: { channel_values: { messages: [] } },
                pendingWrites: [],
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const result = await getPendingInterruptsService('test-thread')
        expect(result).toEqual([])
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

    // @langchain/anthropic 1.x streaming + thinking 模式下 AIMessageChunk reduce
    // 把 tool_use 块只塞进 content 数组,顶层 tool_calls 字段为空——loadSubAgentThreads
    // 必须从 content 数组里也读取 tool_use,否则刷新历史会话时子代理 CoT 卡片整个丢失
    it('content 数组含 tool_use 但顶层 tool_calls=[] 时仍识别子代理调用', async () => {
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
                content: [
                    { type: 'thinking', thinking: '让我请教法理分析专家' },
                    { type: 'tool_use', id: 'tc-content-1', name: 'ask_legal_analyzer_expert', input: {} },
                ],
                tool_calls: [],
            },
        ]
        const result = await loadSubAgentThreads('session-1', messages)
        expect(result).toHaveLength(1)
        expect(result[0]!.agentName).toBe('legal_analyzer')
        expect(result[0]!.toolCallId).toBe('tc-content-1')
        expect(result[0]!.threadId).toBe('session-1_sub_legal_analyzer_tc-content-1')
    })

    it('顶层 tool_calls 与 content tool_use 同 id 时去重不重复加载', async () => {
        const mockCheckpointer = {
            getTuple: vi.fn().mockResolvedValue({
                checkpoint: {
                    channel_values: {
                        messages: [{ type: 'ai', content: '子回答', id: 'sub-1' }],
                    },
                },
            }),
        }
        vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

        const messages = [
            {
                type: 'ai',
                content: [
                    { type: 'tool_use', id: 'tc-dup', name: 'ask_test_expert', input: {} },
                ],
                tool_calls: [{ id: 'tc-dup', name: 'ask_test_expert', args: {} }],
            },
        ]
        const result = await loadSubAgentThreads('session-1', messages)
        expect(result).toHaveLength(1)
        expect(mockCheckpointer.getTuple).toHaveBeenCalledTimes(1)
    })

    describe('draft_document / review_contract 历史恢复', () => {
        it('draft_document tool_call + 配对 ToolMessage JSON 含 subSessionId → 加载子 thread', async () => {
            const subTuple = {
                checkpoint: {
                    channel_values: {
                        messages: [
                            { type: 'human', content: '起草起诉状', id: 'sub-h1' },
                            { type: 'ai', content: '已起草', id: 'sub-a1', tool_calls: [] },
                        ],
                    },
                },
            }
            const mockCheckpointer = {
                getTuple: vi.fn().mockResolvedValue(subTuple),
            }
            vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

            const messages = [
                {
                    type: 'ai',
                    tool_calls: [{ id: 'tc-draft-1', name: 'draft_document', args: {} }],
                },
                {
                    type: 'tool',
                    tool_call_id: 'tc-draft-1',
                    content: JSON.stringify({
                        success: true,
                        draftId: 101,
                        subSessionId: 'doc-sub-xyz',
                        href: '/dashboard/document/drafts/101?from=xiaosuo&sessionId=case-main-1',
                    }),
                },
            ]
            const result = await loadSubAgentThreads('case-main-1', messages)
            expect(result).toHaveLength(1)
            expect(result[0]!.toolCallId).toBe('tc-draft-1')
            expect(result[0]!.agentName).toBe('documentMain')
            expect(result[0]!.threadId).toBe('doc-sub-xyz')
            expect(mockCheckpointer.getTuple).toHaveBeenCalledWith({
                configurable: { thread_id: 'doc-sub-xyz' },
            })
        })

        it('review_contract tool_call → agentName=contractReviewMain', async () => {
            const subTuple = { checkpoint: { channel_values: { messages: [{ type: 'ai', content: '审完', id: 's1' }] } } }
            const mockCheckpointer = { getTuple: vi.fn().mockResolvedValue(subTuple) }
            vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

            const messages = [
                {
                    type: 'ai',
                    tool_calls: [{ id: 'tc-rev-1', name: 'review_contract', args: {} }],
                },
                {
                    type: 'tool',
                    tool_call_id: 'tc-rev-1',
                    content: JSON.stringify({ success: true, reviewId: 5, subSessionId: 'rev-sub-abc' }),
                },
            ]
            const result = await loadSubAgentThreads('case-main-1', messages)
            expect(result).toHaveLength(1)
            expect(result[0]!.agentName).toBe('contractReviewMain')
        })

        it('draft_document + ToolMessage 无 subSessionId（cancelled）→ 跳过', async () => {
            const mockCheckpointer = { getTuple: vi.fn() }
            vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

            const messages = [
                { type: 'ai', tool_calls: [{ id: 'tc-cancel', name: 'draft_document', args: {} }] },
                { type: 'tool', tool_call_id: 'tc-cancel', content: JSON.stringify({ success: false, cancelled: true }) },
            ]
            const result = await loadSubAgentThreads('s1', messages)
            expect(result).toEqual([])
            expect(mockCheckpointer.getTuple).not.toHaveBeenCalled()
        })

        it('draft_document tool_call 无配对 ToolMessage（interrupt 中）→ 跳过', async () => {
            const mockCheckpointer = { getTuple: vi.fn() }
            vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

            const messages = [
                { type: 'ai', tool_calls: [{ id: 'tc-interrupt', name: 'draft_document', args: {} }] },
            ]
            const result = await loadSubAgentThreads('s1', messages)
            expect(result).toEqual([])
            expect(mockCheckpointer.getTuple).not.toHaveBeenCalled()
        })

        it('subSessionId 存在但 checkpointer.getTuple 返回 null → 不报错跳过', async () => {
            const mockCheckpointer = { getTuple: vi.fn().mockResolvedValue(null) }
            vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

            const messages = [
                { type: 'ai', tool_calls: [{ id: 'tc-1', name: 'draft_document', args: {} }] },
                { type: 'tool', tool_call_id: 'tc-1', content: JSON.stringify({ success: true, subSessionId: 'gone' }) },
            ]
            const result = await loadSubAgentThreads('s1', messages)
            expect(result).toEqual([])
        })

        it('混合 ask_*_expert + draft_document → 两套规则并存', async () => {
            const subTuple = { checkpoint: { channel_values: { messages: [{ type: 'ai', content: 'x', id: 's' }] } } }
            const mockCheckpointer = { getTuple: vi.fn().mockResolvedValue(subTuple) }
            vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

            const messages = [
                {
                    type: 'ai', tool_calls: [
                        { id: 'tc-A', name: 'ask_evidence_expert', args: {} },
                        { id: 'tc-B', name: 'draft_document', args: {} },
                    ],
                },
                { type: 'tool', tool_call_id: 'tc-B', content: JSON.stringify({ success: true, subSessionId: 'sub-B' }) },
            ]
            const result = await loadSubAgentThreads('case-1', messages)
            expect(result).toHaveLength(2)
            const A = result.find(r => r.toolCallId === 'tc-A')!
            const B = result.find(r => r.toolCallId === 'tc-B')!
            expect(A.threadId).toBe('case-1_sub_evidence_tc-A')
            expect(A.agentName).toBe('evidence')
            expect(B.threadId).toBe('sub-B')
            expect(B.agentName).toBe('documentMain')
        })

        // ========== Task 12: review_contract DB 优先 fallback ==========
        describe('review_contract cotMessages DB 优先', () => {
            beforeEach(() => {
                vi.clearAllMocks()
            })

            it('cotMessages 非空 → 优先返回 DB 数据（不调 checkpointer.getTuple）', async () => {
                const cotMessages = [
                    { type: 'ai', id: 'cr-segment', content: '', tool_calls: [{ id: 'cr-segment', name: '切分合同条款', args: {} }] },
                    { type: 'tool', tool_call_id: 'cr-segment', content: '{"totalClauses":30}' },
                ]
                // mock prisma 返回 cotMessages
                ;(prisma.contractReviews.findFirst as any).mockResolvedValue({
                    cotMessages,
                })
                // mock checkpointer（不应被调用）
                const mockCheckpointer = { getTuple: vi.fn() }
                vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

                const messages = [
                    {
                        type: 'ai',
                        tool_calls: [{ id: 'tc-rev', name: 'review_contract', args: {} }],
                    },
                    {
                        type: 'tool',
                        tool_call_id: 'tc-rev',
                        content: JSON.stringify({ success: true, subSessionId: 'rev-sub' }),
                    },
                ]
                const result = await loadSubAgentThreads('main', messages)
                expect(result).toHaveLength(1)
                expect(result[0]!.threadId).toBe('rev-sub')
                expect(result[0]!.agentName).toBe('contractReviewMain')
                expect(result[0]!.messages).toEqual(cotMessages)
                // checkpointer.getTuple 不应被调用
                expect(mockCheckpointer.getTuple).not.toHaveBeenCalled()
            })

            it('cotMessages 为空 → fallback 到 checkpoint', async () => {
                ;(prisma.contractReviews.findFirst as any).mockResolvedValue({
                    cotMessages: [],
                })
                const subTuple = {
                    checkpoint: {
                        channel_values: {
                            messages: [{ type: 'ai', content: 'hello from checkpoint', id: 'a1' }],
                        },
                    },
                }
                const mockCheckpointer = { getTuple: vi.fn().mockResolvedValue(subTuple) }
                vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

                const messages = [
                    {
                        type: 'ai',
                        tool_calls: [{ id: 'tc', name: 'review_contract', args: {} }],
                    },
                    {
                        type: 'tool',
                        tool_call_id: 'tc',
                        content: JSON.stringify({ success: true, subSessionId: 's' }),
                    },
                ]
                const result = await loadSubAgentThreads('main', messages)
                expect(result).toHaveLength(1)
                expect(result[0]!.messages).toHaveLength(1)
                expect(result[0]!.messages[0]).toMatchObject({ content: 'hello from checkpoint', id: 'a1' })
                // checkpointer.getTuple 应被调用
                expect(mockCheckpointer.getTuple).toHaveBeenCalledWith({
                    configurable: { thread_id: 's' },
                })
            })

            it('cotMessages 读取失败 → fallback 到 checkpoint（不抛错）', async () => {
                ;(prisma.contractReviews.findFirst as any).mockRejectedValue(new Error('DB 连接断开'))
                const subTuple = {
                    checkpoint: {
                        channel_values: {
                            messages: [{ type: 'ai', content: 'fallback', id: 'fb' }],
                        },
                    },
                }
                const mockCheckpointer = { getTuple: vi.fn().mockResolvedValue(subTuple) }
                vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

                const messages = [
                    {
                        type: 'ai',
                        tool_calls: [{ id: 'tc', name: 'review_contract', args: {} }],
                    },
                    {
                        type: 'tool',
                        tool_call_id: 'tc',
                        content: JSON.stringify({ success: true, subSessionId: 's2' }),
                    },
                ]
                const result = await loadSubAgentThreads('main', messages)
                expect(result).toHaveLength(1)
                expect(result[0]!.messages[0]).toMatchObject({ content: 'fallback', id: 'fb' })
            })

            it('draft_document 不走 DB 路径（只有 review_contract 走）', async () => {
                // draft_document 不应该调用 prisma.contractReviews.findFirst
                const subTuple = {
                    checkpoint: {
                        channel_values: {
                            messages: [{ type: 'ai', content: 'draft result', id: 'd1' }],
                        },
                    },
                }
                const mockCheckpointer = { getTuple: vi.fn().mockResolvedValue(subTuple) }
                vi.mocked(getCheckpointer).mockResolvedValue(mockCheckpointer as any)

                const messages = [
                    {
                        type: 'ai',
                        tool_calls: [{ id: 'tc-draft', name: 'draft_document', args: {} }],
                    },
                    {
                        type: 'tool',
                        tool_call_id: 'tc-draft',
                        content: JSON.stringify({ success: true, subSessionId: 'draft-sub' }),
                    },
                ]
                const result = await loadSubAgentThreads('main', messages)
                expect(result).toHaveLength(1)
                // 验证 prisma.findFirst 未被调用（draft_document 不走 DB 优先）
                expect(prisma.contractReviews.findFirst).not.toHaveBeenCalled()
            })
        })
    })
})
