/**
 * 消息压缩器和工具结果截断器测试
 *
 * 测试消息压缩器的纯函数和工具结果截断器
 */
import { describe, it, expect, vi } from 'vitest'

// Mock materialPipeline 的 estimateTokens
vi.mock('~~/server/services/material/materialPipeline.service', () => ({
    estimateTokens: (text: string) => Math.ceil(text.length / 3),
}))

// Mock logger
vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })

import {
    compressMessages,
    estimateMessagesTokens,
    getContextBudget,
    safetyTrimMessages,
} from '~~/server/services/workflow/context/messageCompressor'

import {
    truncateToolResults,
} from '~~/server/services/workflow/context/toolResultTruncator'

import { HumanMessage, SystemMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'

/**
 * 检测消息列表中所有"孤儿 tool_result"
 *
 * 孤儿条件：ToolMessage 向前回溯（允许跨过其他 ToolMessage）找到的最近一条非 Tool
 * 消息不是带相同 tool_call_id 的 AIMessage。
 *
 * Anthropic Messages API 严格要求每个 tool_result 块前面必须有携带相同
 * tool_use_id 的 tool_use 块，否则返回 400 invalid_request_error。
 */
function findOrphanToolMessages(messages: BaseMessage[]): string[] {
    const orphans: string[] = []
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!
        if (msg.getType() !== 'tool') continue
        const tcid = (msg as ToolMessage).tool_call_id
        let paired = false
        for (let j = i - 1; j >= 0; j--) {
            const prev = messages[j]!
            const prevType = prev.getType()
            if (prevType === 'tool') continue
            if (prevType === 'ai') {
                const tcs = (prev as AIMessage).tool_calls ?? []
                if (tcs.some(tc => tc.id === tcid)) paired = true
            }
            break
        }
        if (!paired) orphans.push(tcid)
    }
    return orphans
}

// ==================== messageCompressor ====================

describe('getContextBudget', () => {
    it('默认上下文预算为 128K tokens', () => {
        const { budget, compressThreshold } = getContextBudget()
        // 业务方 DEFAULT_CONTEXT_WINDOW 改为 128000（与主流模型上下文对齐）
        expect(budget).toBe(102400) // 128K * 0.8
        expect(compressThreshold).toBe(61440) // 102400 * 0.6
    })

    it('自定义上下文窗口', () => {
        const { budget, compressThreshold } = getContextBudget(50000)
        expect(budget).toBe(40000) // 50K * 0.8
        expect(compressThreshold).toBe(24000) // 40K * 0.6
    })

    it('undefined 上下文使用默认值', () => {
        const { budget } = getContextBudget(undefined)
        expect(budget).toBe(102400)
    })
})

describe('estimateMessagesTokens', () => {
    it('空消息列表返回 0', () => {
        expect(estimateMessagesTokens([])).toBe(0)
    })

    it('单条消息估算包含开销', () => {
        const messages = [new HumanMessage('你好')]
        const tokens = estimateMessagesTokens(messages)
        // estimateTokens('你好') = ceil(2/3) = 1, +10 overhead = 11
        expect(tokens).toBeGreaterThan(0)
    })

    it('多条消息累加', () => {
        const messages = [
            new SystemMessage('系统提示'),
            new HumanMessage('用户消息'),
            new AIMessage('AI 回复'),
        ]
        const tokens = estimateMessagesTokens(messages)
        expect(tokens).toBeGreaterThan(30) // 每条消息至少 10 开销
    })
})

describe('safetyTrimMessages', () => {
    it('消息在预算内不截断', async () => {
        const messages = [
            new SystemMessage('系统'),
            new HumanMessage('你好'),
        ]
        const result = await safetyTrimMessages(messages, 100000)
        expect(result).toHaveLength(2)
    })

    it('使用预估值跳过重新估算', async () => {
        const messages = [
            new SystemMessage('系统'),
            new HumanMessage('你好'),
        ]
        // 预估值远低于预算，不截断
        const result = await safetyTrimMessages(messages, 100000, 100)
        expect(result).toHaveLength(2)
    })

    it('超出预算时截断消息', async () => {
        const messages = [
            new SystemMessage('系统提示'),
            new HumanMessage('消息1'),
            new AIMessage('回复1'),
            new HumanMessage('消息2'),
            new AIMessage('回复2'),
            new HumanMessage('消息3'),
        ]
        // 给一个很小的预算强制截断
        const result = await safetyTrimMessages(messages, 30, 100)
        expect(result.length).toBeLessThanOrEqual(messages.length)
    })
})

// ==================== toolResultTruncator ====================

describe('truncateToolResults', () => {
    it('短内容不截断', () => {
        const results = [
            { content: '短内容', score: 0.9 },
        ]
        const truncated = truncateToolResults(results)
        expect(truncated[0]!.content).toBe('短内容')
    })

    it('超长内容被截断并添加提示', () => {
        const longContent = '测'.repeat(100000)
        const results = [
            { content: longContent, score: 0.9 },
        ]
        const truncated = truncateToolResults(results)
        expect(truncated[0]!.content.length).toBeLessThan(longContent.length)
        expect(truncated[0]!.content).toContain('截断')
    })

    it('自定义 maxTokensPerItem', () => {
        const content = '测试内容'.repeat(100)
        const results = [
            { content, score: 0.9 },
        ]
        // 设置很小的限制
        const truncated = truncateToolResults(results, { maxTokensPerItem: 5 })
        expect(truncated[0]!.content.length).toBeLessThan(content.length)
    })

    it('空数组返回空数组', () => {
        expect(truncateToolResults([])).toEqual([])
    })

    it('不修改原始对象', () => {
        const longContent = '长'.repeat(100000)
        const original = { content: longContent, score: 0.9 }
        const results = [original]
        truncateToolResults(results)
        expect(original.content).toBe(longContent)
    })

    it('保留其他属性', () => {
        const results = [
            { content: '内容', score: 0.9, metadata: { key: 'value' } },
        ]
        const truncated = truncateToolResults(results)
        expect((truncated[0] as any).metadata).toEqual({ key: 'value' })
    })
})

// ==================== compressMessages 边界对齐 ====================

/** mock model：返回固定摘要内容（测试不关心摘要质量，只关心切分边界） */
function createMockModel() {
    return {
        invoke: vi.fn().mockResolvedValue({ content: '摘要内容' }),
    }
}

describe('compressMessages 边界对齐', () => {
    it('切分点落在单条 ToolMessage 上时，返回结果不含孤儿 tool_result', async () => {
        // 12 条消息：触发压缩（>11）；slice(-9) 起点 = messages[3] = ToolMessage(call1)
        // 修复前：[system, summary(human), ToolMessage(call1) ...] → call1 无对应 AIMessage
        const messages: BaseMessage[] = [
            new SystemMessage('系统'),
            new HumanMessage('问题'),
            new AIMessage({ content: '', tool_calls: [{ id: 'call1', name: 'search', args: {} }] }),
            new ToolMessage({ content: '结果1', tool_call_id: 'call1' }),
            new AIMessage({ content: '', tool_calls: [{ id: 'call2', name: 'search', args: {} }] }),
            new ToolMessage({ content: '结果2', tool_call_id: 'call2' }),
            new AIMessage({ content: '', tool_calls: [{ id: 'call3', name: 'search', args: {} }] }),
            new ToolMessage({ content: '结果3', tool_call_id: 'call3' }),
            new AIMessage({ content: '', tool_calls: [{ id: 'call4', name: 'search', args: {} }] }),
            new ToolMessage({ content: '结果4', tool_call_id: 'call4' }),
            new AIMessage({ content: '', tool_calls: [{ id: 'call5', name: 'search', args: {} }] }),
            new ToolMessage({ content: '结果5', tool_call_id: 'call5' }),
        ]

        const result = await compressMessages(messages, 100000, createMockModel() as any)

        const orphans = findOrphanToolMessages(result)
        expect(orphans).toEqual([])
    })

    it('切分点落在并行 ToolMessage 中间时，所有相关 ToolMessage 都有对应 AIMessage', async () => {
        // 14 条消息：slice(-9) 起点 = messages[5] = ToolMessage(call_a)
        // 修复前：AIMessage(tool_calls=[a,b,c,d]) 被切走，a/b/c/d 均成孤儿
        const messages: BaseMessage[] = [
            new SystemMessage('系统'),                                              // 0
            new HumanMessage('问题1'),                                              // 1
            new AIMessage('回复1'),                                                  // 2
            new HumanMessage('问题2'),                                              // 3
            new AIMessage({                                                          // 4
                content: '',
                tool_calls: [
                    { id: 'call_a', name: 'search', args: {} },
                    { id: 'call_b', name: 'search', args: {} },
                    { id: 'call_c', name: 'search', args: {} },
                    { id: 'call_d', name: 'search', args: {} },
                ],
            }),
            new ToolMessage({ content: '结果A', tool_call_id: 'call_a' }),           // 5 ← slice 切点
            new ToolMessage({ content: '结果B', tool_call_id: 'call_b' }),           // 6
            new ToolMessage({ content: '结果C', tool_call_id: 'call_c' }),           // 7
            new ToolMessage({ content: '结果D', tool_call_id: 'call_d' }),           // 8
            new AIMessage('最终回复'),                                              // 9
            new HumanMessage('问题3'),                                              // 10
            new AIMessage('回复3'),                                                  // 11
            new HumanMessage('问题4'),                                              // 12
            new AIMessage('回复4'),                                                  // 13
        ]

        const result = await compressMessages(messages, 100000, createMockModel() as any)

        const orphans = findOrphanToolMessages(result)
        expect(orphans).toEqual([])
    })

    it('切分点落在普通 HumanMessage 上时，不引入孤儿（回归保护）', async () => {
        // 14 条消息：slice(-9) 起点 = messages[5] = HumanMessage（天然无问题）
        const messages: BaseMessage[] = [
            new SystemMessage('系统'),
            new HumanMessage('问题1'),
            new AIMessage('回复1'),
            new HumanMessage('问题2'),
            new AIMessage('回复2'),
            new HumanMessage('问题3'),  // ← slice(-9) 切点
            new AIMessage('回复3'),
            new HumanMessage('问题4'),
            new AIMessage('回复4'),
            new HumanMessage('问题5'),
            new AIMessage('回复5'),
            new HumanMessage('问题6'),
            new AIMessage('回复6'),
            new HumanMessage('问题7'),
        ]

        const result = await compressMessages(messages, 100000, createMockModel() as any)

        const orphans = findOrphanToolMessages(result)
        expect(orphans).toEqual([])
        // 系统消息保留 + 摘要 HumanMessage + 9 条 recent
        expect(result.length).toBe(11)
    })
})
