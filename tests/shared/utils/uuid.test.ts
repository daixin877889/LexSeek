/**
 * uuid 工具函数测试
 *
 * 测试 UUID v7 生成功能
 *
 * **Feature: uuid-utils**
 * **Validates: UUID v7 生成功能**
 */

import { describe, it, expect } from 'vitest'
import { uuidv7 } from '../../../shared/utils/uuid'

describe('uuidv7 UUID v7 生成', () => {
    it('应生成有效的 UUID v7 格式', () => {
        const uuid = uuidv7()
        // UUID v7 格式: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('每次调用应生成不同的 UUID', () => {
        const uuid1 = uuidv7()
        const uuid2 = uuidv7()
        expect(uuid1).not.toBe(uuid2)
    })

    it('应生成 36 个字符的 UUID', () => {
        const uuid = uuidv7()
        expect(uuid.length).toBe(36)
    })

    it('UUID 的第 13 位应为 7（版本号）', () => {
        const uuid = uuidv7()
        // xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
        //             ^
        expect(uuid.charAt(14)).toBe('7')
    })

    it('UUID 的第 17 位应为 8/a/b（变体位）', () => {
        const uuid = uuidv7()
        // xxxxxxxx-xxxx-xxxx-8xxx-xxxxxxxxxxxx
        //                    ^
        const variantChar = uuid.charAt(19)
        expect(['8', '9', 'a', 'b']).toContain(variantChar)
    })

    it('多个 UUID 的时间戳部分应单调不递减（允许同毫秒内递增）', () => {
        const uuids = Array.from({ length: 100 }, () => uuidv7())
        // 提取时间戳部分（字节 0-5，十六进制）
        const timestamps = uuids.map(u => u.substring(0, 8) + u.substring(9, 13))
        // 时间戳应该单调不递减（允许相等或递增）
        for (let i = 1; i < timestamps.length; i++) {
            expect(timestamps[i] >= timestamps[i - 1]).toBe(true)
        }
    })

    it('UUID 应为小写', () => {
        const uuid = uuidv7()
        expect(uuid).toBe(uuid.toLowerCase())
    })
})
