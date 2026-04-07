import { describe, it, expect } from 'vitest'

describe('countTokens', () => {
    it('应返回正整数', async () => {
        const { countTokens } = await import('~~/server/utils/tokenCounter')
        const result = await countTokens('你好世界')
        expect(result).toBeGreaterThan(0)
    })

    it('中英文混合文本应正确计数', async () => {
        const { countTokens } = await import('~~/server/utils/tokenCounter')
        const result = await countTokens('Hello 你好 world 世界')
        expect(result).toBeGreaterThan(0)
    })

    it('空字符串应返回 0', async () => {
        const { countTokens } = await import('~~/server/utils/tokenCounter')
        const result = await countTokens('')
        expect(result).toBe(0)
    })
})

describe('countTokensSync (fallback)', () => {
    it('编码已初始化时应返回与 async 一致的正整数', async () => {
        const { countTokens, countTokensSync } = await import('~~/server/utils/tokenCounter')
        // 先初始化 async 版本
        await countTokens('init')
        const syncResult = countTokensSync('测试文本')
        expect(syncResult).toBeGreaterThan(0)
    })

    it('未初始化时应使用字符估算 fallback', async () => {
        const { countTokensSync } = await import('~~/server/utils/tokenCounter')
        const result = countTokensSync('hello world')
        expect(typeof result).toBe('number')
        expect(result).toBeGreaterThan(0)
        expect(Number.isNaN(result)).toBe(false)
    })
})
