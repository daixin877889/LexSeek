/**
 * sha256 SHA256 哈希工具测试
 *
 * 测试 SHA256 文本哈希功能
 *
 * **Feature: crypto-utils**
 * **Validates: SHA256 哈希功能**
 */

import { describe, it, expect } from 'vitest'
import { sha256Text } from '~/utils/sha256'

describe('sha256Text SHA256 哈希', () => {
    it('应生成正确的 SHA256 哈希值', async () => {
        // SHA256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
        const result = await sha256Text('hello')
        expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    })

    it('空字符串应生成正确的哈希值', async () => {
        const result = await sha256Text('')
        expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    })

    it('不同输入应生成不同哈希值', async () => {
        const result1 = await sha256Text('hello')
        const result2 = await sha256Text('world')
        expect(result1).not.toBe(result2)
    })

    it('相同输入应生成相同哈希值', async () => {
        const result1 = await sha256Text('test')
        const result2 = await sha256Text('test')
        expect(result1).toBe(result2)
    })

    it('应返回 64 位十六进制字符串（小写）', async () => {
        const result = await sha256Text('hello')
        expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('中文字符应正确处理', async () => {
        const result = await sha256Text('你好')
        expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('特殊字符应正确处理', async () => {
        const result = await sha256Text('!@#$%^&*()_+-=[]{}|;:,.<>?')
        expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('长字符串应正确处理', async () => {
        const longStr = 'a'.repeat(10000)
        const result = await sha256Text(longStr)
        expect(result).toMatch(/^[0-9a-f]{64}$/)
    })
})
