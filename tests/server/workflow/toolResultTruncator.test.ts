import { describe, it, expect } from 'vitest'
import { truncateToolResults } from '~~/server/services/workflow/context/toolResultTruncator'
import { countTokensSync } from '~~/server/utils/tokenCounter'

describe('truncateToolResults', () => {
    it('短内容不截断', () => {
        const results = [{ content: '短文本', score: 1, metadata: {} }]
        const truncated = truncateToolResults(results)
        expect(truncated[0].content).toBe('短文本')
    })

    it('中文长内容精确截断到 token 上限', () => {
        const longText = '中华人民共和国民法典第一编总则'.repeat(2000)
        const results = [{ content: longText, score: 1, metadata: {} }]
        const truncated = truncateToolResults(results, { maxTokensPerItem: 1000 })
        const tokens = countTokensSync(truncated[0].content)
        expect(tokens).toBeLessThanOrEqual(1050)
        expect(truncated[0].content).toContain('[内容过长已截断')
    })

    it('英文长内容精确截断到 token 上限', () => {
        const longText = 'The court held that the defendant was liable for damages. '.repeat(1000)
        const results = [{ content: longText, score: 1, metadata: {} }]
        const truncated = truncateToolResults(results, { maxTokensPerItem: 1000 })
        const tokens = countTokensSync(truncated[0].content)
        expect(tokens).toBeLessThanOrEqual(1050)
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
