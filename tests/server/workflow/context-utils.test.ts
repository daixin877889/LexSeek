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
    estimateMessagesTokens,
    getContextBudget,
    safetyTrimMessages,
} from '~~/server/services/workflow/context/messageCompressor'

import {
    truncateToolResults,
} from '~~/server/services/workflow/context/toolResultTruncator'

import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'

// ==================== messageCompressor ====================

describe('getContextBudget', () => {
    it('默认上下文预算为 100K tokens', () => {
        const { budget, compressThreshold } = getContextBudget()
        expect(budget).toBe(80000) // 100K * 0.8
        expect(compressThreshold).toBe(48000) // 80K * 0.6
    })

    it('自定义上下文窗口', () => {
        const { budget, compressThreshold } = getContextBudget(50000)
        expect(budget).toBe(40000) // 50K * 0.8
        expect(compressThreshold).toBe(24000) // 40K * 0.6
    })

    it('undefined 上下文使用默认值', () => {
        const { budget } = getContextBudget(undefined)
        expect(budget).toBe(80000)
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
