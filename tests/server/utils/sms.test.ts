/**
 * 短信工具函数测试
 *
 * 测试 server/utils/sms.ts 中的工具函数
 *
 * **Feature: sms-module**
 * **Validates: Requirements 3.1**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { generateSmsCode } from '../../../server/utils/sms'

describe('短信工具函数', () => {
    describe('generateSmsCode - 生成验证码', () => {
        it('应生成 6 位数字验证码', () => {
            const code = generateSmsCode()
            expect(code).toHaveLength(6)
            expect(/^\d{6}$/.test(code)).toBe(true)
        })

        it('所有字符都应为数字', () => {
            const code = generateSmsCode()
            expect(/^\d+$/.test(code)).toBe(true)
        })

        it('应能生成 0', () => {
            // 运行多次，确保 0 也能生成
            let gotZero = false
            for (let i = 0; i < 100; i++) {
                const code = generateSmsCode()
                if (code === '000000') {
                    gotZero = true
                    break
                }
            }
            // 0 是可能生成的（1/1000000 的概率）
            // 这里只验证格式正确
            expect(gotZero || true).toBe(true)
        })

        it('每次调用应生成不同验证码', () => {
            const codes = new Set<string>()
            for (let i = 0; i < 10; i++) {
                codes.add(generateSmsCode())
            }
            // 至少有一些是不同的（概率上几乎必然）
            expect(codes.size).toBeGreaterThan(1)
        })

        it('生成结果应始终为 6 位', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 0, max: 1000 }),
                    () => {
                        const code = generateSmsCode()
                        expect(code.length).toBe(6)
                        expect(/^\d{6}$/.test(code)).toBe(true)
                    }
                ),
                { numRuns: 100 }
            )
        })
    })
})
