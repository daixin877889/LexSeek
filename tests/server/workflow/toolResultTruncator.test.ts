import { describe, it, expect, vi } from 'vitest'

// Mock tokenCounter：业务源码 toolResultTruncator.ts 在模块加载时调 `void countTokens('')`
// 预热 tiktoken。在 nuxt 测试 env 下 tiktoken cl100k_base BPE 词表加载会卡死整个测试套件。
// 用 char/3 作为 token 估算（仍能验证截断逻辑），精度由 tokenCounter 自己的测试覆盖。
vi.mock('~~/server/utils/tokenCounter', () => {
    const countTokensSync = (text: string) => Math.ceil(text.length / 3)
    return {
        countTokensSync,
        countTokens: async (text: string) => countTokensSync(text),
    }
})

import { truncateToolResults } from '~~/server/services/workflow/context/toolResultTruncator'
import { countTokensSync } from '~~/server/utils/tokenCounter'

describe('truncateToolResults', () => {
    it('短内容不截断', () => {
        const results = [{ content: '短文本', score: 1, metadata: {} }]
        const truncated = truncateToolResults(results)
        expect(truncated[0].content).toBe('短文本')
    })

    it('长内容截断到 token 上限', () => {
        const longText = '中华人民共和国民法典第一编总则'.repeat(2000)
        const results = [{ content: longText, score: 1, metadata: {} }]
        const truncated = truncateToolResults(results, { maxTokensPerItem: 1000 })
        const tokens = countTokensSync(truncated[0].content)
        // 容忍 token 估算近似上界（含截断提示语自身的 token）
        expect(tokens).toBeLessThanOrEqual(1100)
        expect(truncated[0].content).toContain('[内容过长已截断')
    })

    it('英文长内容截断', () => {
        const longText = 'The court held that the defendant was liable for damages. '.repeat(1000)
        const results = [{ content: longText, score: 1, metadata: {} }]
        const truncated = truncateToolResults(results, { maxTokensPerItem: 1000 })
        const tokens = countTokensSync(truncated[0].content)
        expect(tokens).toBeLessThanOrEqual(1100)
    })

    it('保留非 content 字段不变', () => {
        const results = [{ content: '长'.repeat(50000), score: 0.95, metadata: { legal_name: '民法典' } }]
        const truncated = truncateToolResults(results, { maxTokensPerItem: 100 })
        expect(truncated[0].score).toBe(0.95)
        expect(truncated[0].metadata).toEqual({ legal_name: '民法典' })
    })

    it('多条结果各自独立截断', () => {
        const results = [
            { content: '短', score: 1, metadata: {} },
            { content: '长'.repeat(50000), score: 0.5, metadata: {} },
        ]
        const truncated = truncateToolResults(results, { maxTokensPerItem: 100 })
        expect(truncated[0].content).toBe('短')
        expect(truncated[1].content).toContain('[内容过长已截断')
    })
})
