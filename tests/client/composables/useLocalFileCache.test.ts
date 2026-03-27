/**
 * useLocalFileCache 本地文件缓存 Composable 测试
 *
 * 测试 IndexedDB 文件缓存功能的纯逻辑
 *
 * **Feature: local-file-cache**
 * **Validates: 本地文件缓存功能**
 */

import { describe, it, expect } from 'vitest'
import { isCacheExpired } from '~/composables/useLocalFileCache'

describe('isCacheExpired 缓存过期判断', () => {
    it('当前缓存未过期应返回 false', () => {
        const now = Date.now()
        const record = { cachedAt: now, expiresIn: 24 * 60 * 60 * 1000, ossFileId: 1, fileName: 'test.pdf', content: new ArrayBuffer(1024) }
        expect(isCacheExpired(record)).toBe(false)
    })

    it('刚缓存的记录应返回 false', () => {
        const record = { cachedAt: Date.now() - 1000, expiresIn: 24 * 60 * 60 * 1000, ossFileId: 1, fileName: 'test.pdf', content: new ArrayBuffer(1024) }
        expect(isCacheExpired(record)).toBe(false)
    })

    it('超过过期时间的缓存应返回 true', () => {
        const expiredTime = Date.now() - (24 * 60 * 60 * 1000 + 1000)
        const record = { cachedAt: expiredTime, expiresIn: 24 * 60 * 60 * 1000, ossFileId: 1, fileName: 'test.pdf', content: new ArrayBuffer(1024) }
        expect(isCacheExpired(record)).toBe(true)
    })

    it('刚好到期的缓存应返回 true', () => {
        const justExpired = Date.now() - (24 * 60 * 60 * 1000) - 1
        const record = { cachedAt: justExpired, expiresIn: 24 * 60 * 60 * 1000, ossFileId: 1, fileName: 'test.pdf', content: new ArrayBuffer(1024) }
        expect(isCacheExpired(record)).toBe(true)
    })

    it('即将到期的缓存应返回 false', () => {
        const almostExpired = Date.now() - (24 * 60 * 60 * 1000 - 1)
        const record = { cachedAt: almostExpired, expiresIn: 24 * 60 * 60 * 1000, ossFileId: 1, fileName: 'test.pdf', content: new ArrayBuffer(1024) }
        expect(isCacheExpired(record)).toBe(false)
    })

    it('短过期时间的缓存应正确判断', () => {
        const record = { cachedAt: Date.now() - 60000, expiresIn: 30000, ossFileId: 1, fileName: 'test.pdf', content: new ArrayBuffer(1024) }
        expect(isCacheExpired(record)).toBe(true)
    })

    it('零过期时间且已过缓存时刻应返回 true', () => {
        // expiresIn: 0 意味着立即过期，只要 now > cachedAt 就是过期的
        const record = { cachedAt: Date.now() - 1, expiresIn: 0, ossFileId: 1, fileName: 'test.pdf', content: new ArrayBuffer(1024) }
        expect(isCacheExpired(record)).toBe(true)
    })

    it('负过期时间应视为立即过期', () => {
        const record = { cachedAt: Date.now(), expiresIn: -1000, ossFileId: 1, fileName: 'test.pdf', content: new ArrayBuffer(1024) }
        expect(isCacheExpired(record)).toBe(true)
    })

    it('很长的过期时间应视为有效', () => {
        const farFuture = Date.now() - 1000
        const record = { cachedAt: farFuture, expiresIn: 365 * 24 * 60 * 60 * 1000, ossFileId: 1, fileName: 'test.pdf', content: new ArrayBuffer(1024) }
        expect(isCacheExpired(record)).toBe(false)
    })

    it('很久之前的缓存在短过期时间下应过期', () => {
        const record = { cachedAt: Date.now() - 7 * 24 * 60 * 60 * 1000, expiresIn: 24 * 60 * 60 * 1000, ossFileId: 1, fileName: 'test.pdf', content: new ArrayBuffer(1024) }
        expect(isCacheExpired(record)).toBe(true)
    })

    it('自定义过期时间应正确判断', () => {
        const oneHour = 60 * 60 * 1000
        const record = { cachedAt: Date.now() - (oneHour + 1000), expiresIn: oneHour, ossFileId: 1, fileName: 'test.pdf', content: new ArrayBuffer(1024) }
        expect(isCacheExpired(record)).toBe(true)
    })

    it('自定义过期时间边界内应返回 false', () => {
        const oneHour = 60 * 60 * 1000
        const record = { cachedAt: Date.now() - (oneHour - 1000), expiresIn: oneHour, ossFileId: 1, fileName: 'test.pdf', content: new ArrayBuffer(1024) }
        expect(isCacheExpired(record)).toBe(false)
    })
})
