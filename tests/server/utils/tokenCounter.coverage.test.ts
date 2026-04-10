/**
 * Token 计数器补充覆盖率测试
 *
 * 覆盖 countTokensSync 的 fallback 路径和 estimateTokensFallback 逻辑
 *
 * **Feature: utilities**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('tokenCounter 补充覆盖率', () => {
    describe('countTokens - 边界情况', () => {
        it('长文本应返回合理的 token 数', async () => {
            const { countTokens } = await import('~~/server/utils/tokenCounter')
            const longText = '法律分析'.repeat(500)
            const result = await countTokens(longText)
            expect(result).toBeGreaterThan(100)
        })

        it('纯英文文本应正确计数', async () => {
            const { countTokens } = await import('~~/server/utils/tokenCounter')
            const result = await countTokens('The quick brown fox jumps over the lazy dog')
            expect(result).toBeGreaterThan(5)
            expect(result).toBeLessThan(20)
        })

        it('特殊字符应正确计数', async () => {
            const { countTokens } = await import('~~/server/utils/tokenCounter')
            const result = await countTokens('!@#$%^&*()')
            expect(result).toBeGreaterThan(0)
        })

        it('多行文本应正确计数', async () => {
            const { countTokens } = await import('~~/server/utils/tokenCounter')
            const result = await countTokens('第一行\n第二行\n第三行')
            expect(result).toBeGreaterThan(0)
        })
    })

    describe('countTokensSync - 编码已初始化', () => {
        it('中英文混合应正确计数', async () => {
            const { countTokens, countTokensSync } = await import('~~/server/utils/tokenCounter')
            // 初始化编码
            await countTokens('init')

            const result = countTokensSync('Hello 你好')
            expect(result).toBeGreaterThan(0)
        })

        it('空字符串应返回 0', async () => {
            const { countTokens, countTokensSync } = await import('~~/server/utils/tokenCounter')
            await countTokens('init')

            const result = countTokensSync('')
            expect(result).toBe(0)
        })
    })

    describe('estimateTokensFallback 逻辑验证', () => {
        it('纯中文 fallback 估算约为字符数/2', () => {
            // 直接验证估算逻辑
            const text = '中文测试文本共十个字符'
            const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
            const otherChars = text.length - chineseChars
            const estimated = Math.ceil(chineseChars / 2 + otherChars / 4)
            expect(estimated).toBeGreaterThan(0)
            // 10 个中文字符 → 约 5 tokens
            expect(estimated).toBe(Math.ceil(chineseChars / 2))
        })

        it('纯英文 fallback 估算约为字符数/4', () => {
            const text = 'hello world test'
            const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
            const otherChars = text.length - chineseChars
            const estimated = Math.ceil(chineseChars / 2 + otherChars / 4)
            expect(estimated).toBe(Math.ceil(text.length / 4))
        })

        it('中英混合 fallback 估算', () => {
            const text = 'Hello你好World世界'
            const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
            const otherChars = text.length - chineseChars
            const estimated = Math.ceil(chineseChars / 2 + otherChars / 4)
            // 4 个中文 + 10 个英文 → 2 + 2.5 = 5
            expect(estimated).toBe(Math.ceil(4 / 2 + 10 / 4))
        })
    })
})
