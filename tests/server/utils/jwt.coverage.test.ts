/**
 * JWT 工具补充覆盖率测试
 *
 * 覆盖 verifyToken 的 else 分支（未知错误类型）
 *
 * **Feature: auth-system**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { JwtPayload as JwtPayloadType } from '../../../server/utils/jwt'

vi.stubGlobal('logger', {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
})

describe('JWT 补充覆盖率', () => {
    describe('verifyToken 未知错误类型', () => {
        it('非标准 JWT 错误应抛出认证失败', async () => {
            // 通过 mock jsonwebtoken.verify 让它抛出非标准错误
            vi.resetModules()

            vi.doMock('jsonwebtoken', () => ({
                default: {
                    sign: vi.fn().mockReturnValue('mock.token.value'),
                    verify: vi.fn().mockImplementation(() => {
                        throw new TypeError('unexpected error')
                    }),
                    TokenExpiredError: class TokenExpiredError extends Error {},
                    JsonWebTokenError: class JsonWebTokenError extends Error {},
                },
            }))

            const { JwtUtil } = await import('../../../server/utils/jwt')
            expect(() => JwtUtil.verifyToken('some.token.value')).toThrow('认证失败')
        })
    })

    describe('generateToken 异常处理', () => {
        it('空 roles 数组应能生成令牌', async () => {
            vi.resetModules()
            vi.doUnmock('jsonwebtoken')

            const { JwtUtil } = await import('../../../server/utils/jwt')
            const payload: JwtPayloadType = { id: 1, phone: '13800138000', roles: [] }
            const token = JwtUtil.generateToken(payload)
            expect(token).toBeDefined()
            expect(token.split('.').length).toBe(3)
        })

        it('undefined status 不应阻止令牌生成', async () => {
            vi.resetModules()
            vi.doUnmock('jsonwebtoken')

            const { JwtUtil } = await import('../../../server/utils/jwt')
            const payload: JwtPayloadType = {
                id: 999,
                phone: '13900139000',
                roles: [1],
                status: undefined,
            }
            const token = JwtUtil.generateToken(payload)
            expect(token).toBeDefined()

            const decoded = JwtUtil.verifyToken(token)
            expect(decoded.id).toBe(999)
        })
    })
})
